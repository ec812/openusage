(function () {
  const AUTH_FILE = "~/.commandcode/auth.json"
  const API_BASE = "https://api.commandcode.ai"
  const ERR_NOT_LOGGED_IN = "Not logged in. Run `cmd login` to authenticate."

  // Plan name mapping: planId -> human label
  var PLAN_LABELS = {
    "individual-go": "Individual Go",
    "individual": "Individual",
    "pro": "Pro",
    "team": "Team",
    "enterprise": "Enterprise",
  }

  // Monthly credit limits per plan (used instead of inferred total when available)
  var PLAN_CREDITS = {
    "individual-go": 10,
    "individual": 30,
    "pro": 100,
    "team": 500,
    "enterprise": 500,
  }

  function readNumber(value) {
    var n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function loadApiKeyFromEnv(ctx) {
    try {
      var value = ctx.host.env.get("COMMAND_CODE_API_KEY")
      if (typeof value !== "string") return null
      var trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.warn("COMMAND_CODE_API_KEY read failed: " + String(e))
      return null
    }
  }

  function loadApiKeyFromFile(ctx) {
    if (!ctx.host.fs.exists(AUTH_FILE)) return null
    try {
      var text = ctx.host.fs.readText(AUTH_FILE)
      var parsed = ctx.util.tryParseJson(text)
      if (!parsed || typeof parsed !== "object") return null
      var key = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : null
      return key || null
    } catch (e) {
      ctx.host.log.warn("auth file read failed: " + String(e))
      return null
    }
  }

  function loadApiKey(ctx) {
    return loadApiKeyFromEnv(ctx) || loadApiKeyFromFile(ctx)
  }

  function apiCall(ctx, method, url, apiKey) {
    try {
      var resp = ctx.host.http.request({
        method: method,
        url: url,
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "OpenUsage",
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("API call failed: " + url + " status=" + resp.status)
        return null
      }
      var parsed = ctx.util.tryParseJson(resp.bodyText)
      if (!parsed) {
        ctx.host.log.warn("API response not valid JSON: " + url)
        return null
      }
      return parsed
    } catch (e) {
      ctx.host.log.error("API call exception: " + url + " " + String(e))
      return null
    }
  }

  function probe(ctx) {
    var apiKey = loadApiKey(ctx)
    if (!apiKey) {
      ctx.host.log.error("probe failed: no api key in auth file or COMMAND_CODE_API_KEY env var")
      throw ERR_NOT_LOGGED_IN
    }

    ctx.host.log.info("loaded api key")

    // Fetch whoami (no orgId param needed for personal accounts)
    var whoami = apiCall(ctx, "GET", API_BASE + "/alpha/whoami", apiKey)
    if (!whoami) {
      throw "Command Code API unreachable. Check your connection."
    }

    // Fetch credits (plan limit) and usage summary in parallel
    var creditsResp = apiCall(ctx, "GET", API_BASE + "/alpha/billing/credits", apiKey)
    var usageResp = apiCall(ctx, "GET", API_BASE + "/alpha/usage/summary", apiKey)

    // Fetch subscription for plan info
    var subResp = apiCall(ctx, "GET", API_BASE + "/alpha/billing/subscriptions", apiKey)

    // -- Parse credits (remaining balance) --
    // credits.credits.monthlyCredits = remaining balance (e.g. $6.59)
    var creditsRemaining = null
    if (creditsResp && creditsResp.credits && typeof creditsResp.credits === "object") {
      creditsRemaining = readNumber(creditsResp.credits.monthlyCredits)
    }

    // -- Parse usage summary (monthly credits used this period) --
    var monthlyUsed = null
    if (usageResp && typeof usageResp === "object") {
      monthlyUsed = readNumber(usageResp.totalMonthlyCredits)
    }

    // -- Parse plan name and billing period from subscription --
    var planId = null
    var planLabel = null
    var billingPeriodEnd = null
    if (subResp && subResp.success && subResp.data && typeof subResp.data === "object") {
      if (typeof subResp.data.planId === "string") {
        planId = subResp.data.planId
        planLabel = PLAN_LABELS[planId] || ctx.fmt.planLabel(planId)
      }
      // Try to get billing period end date
      if (subResp.data.currentPeriodEnd && typeof subResp.data.currentPeriodEnd === "string") {
        billingPeriodEnd = new Date(subResp.data.currentPeriodEnd)
      }
    }

    var lines = []

    // -- Progress bar: Monthly credits used vs total plan --
    // Prefer known plan limit from subscription planId over inferred total.
    // The usage summary endpoint (totalMonthlyCredits) can return stale data
    // at billing period boundaries, while the credits endpoint (monthlyCredits)
    // reliably reflects the current period.
    var usedPercent = null
    var planLimit = planId ? PLAN_CREDITS[planId] : null

    if (planLimit !== null && creditsRemaining !== null) {
      // Known plan limit: calculate from remaining credits
      var used = Math.max(0, planLimit - creditsRemaining)
      usedPercent = (used / planLimit) * 100
    } else if (creditsRemaining !== null && monthlyUsed !== null) {
      // Fallback: infer total from used + remaining
      var totalPlan = monthlyUsed + Math.max(0, creditsRemaining)
      usedPercent = totalPlan > 0 ? (monthlyUsed / totalPlan) * 100 : 100
    }

    if (usedPercent !== null) {
      if (usedPercent > 100) usedPercent = 100
      if (usedPercent < 0) usedPercent = 0

      var progressOpts = {
        label: "Monthly credits",
        used: Math.round(usedPercent * 10) / 10,
        limit: 100,
        format: { kind: "percent" },
        periodDurationMs: 30 * 24 * 60 * 60 * 1000,
      }

      // Add resetsAt if billing period end is available
      if (billingPeriodEnd && !isNaN(billingPeriodEnd.getTime())) {
        progressOpts.resetsAt = billingPeriodEnd.toISOString()
      }

      lines.push(ctx.line.progress(progressOpts))
    }

    return { plan: planLabel, lines: lines }
  }

  globalThis.__openusage_plugin = { id: "command-code", probe: probe }
})()
