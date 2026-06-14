(function () {
  var API_BASE = "https://api.poe.com"
  var ERR_NOT_CONFIGURED = "Poe API key not configured. Set POE_API_KEY env var."
  var MONTH_MS = 30 * 24 * 60 * 60 * 1000

  function fmtNum(n) {
    // Manual thousand separators — QuickJS has no Intl.NumberFormat
    var parts = String(n).split(".")
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    return parts.join(".")
  }

  function loadApiKey(ctx) {
    // Prefer env var (matches the cron job pattern)
    try {
      var value = ctx.host.env.get("POE_API_KEY")
      if (typeof value === "string") {
        var trimmed = value.trim()
        if (trimmed) return trimmed
      }
    } catch (e) {
      ctx.host.log.warn("POE_API_KEY read failed: " + String(e))
    }

    // Fallback: read from shell config files (e.g. ~/.zshrc)
    var shellFiles = [".zshrc", ".zprofile", ".bashrc", ".bash_profile", ".profile"]
    for (var i = 0; i < shellFiles.length; i++) {
      var p = "~/" + shellFiles[i]
      try {
        if (!ctx.host.fs.exists(p)) continue
        var content = ctx.host.fs.readText(p)
        if (!content) continue
        var m = content.match(/^export\s+POE_API_KEY\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/m)
        if (m) {
          var apiKey = m[1] || m[2] || m[3]
          if (apiKey) return apiKey.trim() || null
        }
      } catch (e2) {
        ctx.host.log.warn("Failed reading " + p + ": " + String(e2))
      }
    }

    return null
  }

  function apiCall(ctx, method, path, apiKey) {
    try {
      var resp = ctx.host.http.request({
        method: method,
        url: API_BASE + path,
        headers: {
          Authorization: "Bearer " + apiKey,
          Accept: "application/json",
          "User-Agent": "OpenUsage",
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("Poe API call failed: " + path + " status=" + resp.status)
        return null
      }
      var parsed = ctx.util.tryParseJson(resp.bodyText)
      if (!parsed) {
        ctx.host.log.warn("Poe API response not valid JSON: " + path)
        return null
      }
      return parsed
    } catch (e) {
      ctx.host.log.error("Poe API call exception: " + path + " " + String(e))
      return null
    }
  }

  function probe(ctx) {
    var apiKey = loadApiKey(ctx)
    if (!apiKey) {
      ctx.host.log.error("probe failed: no POE_API_KEY env var")
      throw ERR_NOT_CONFIGURED
    }

    ctx.host.log.info("loaded poe api key")

    // Fetch balance
    var balanceResp = apiCall(ctx, "GET", "/usage/current_balance", apiKey)
    if (!balanceResp) {
      throw "Poe API unreachable. Check your connection."
    }

    var points = null
    var usd = null
    if (typeof balanceResp.current_point_balance === "number") {
      points = balanceResp.current_point_balance
    }
    // total_balance_usd comes as a string from Poe API
    if (typeof balanceResp.total_balance_usd === "string") {
      var parsed = parseFloat(balanceResp.total_balance_usd)
      if (!isNaN(parsed)) usd = parsed
    } else if (typeof balanceResp.total_balance_usd === "number") {
      usd = balanceResp.total_balance_usd
    }

    var lines = []
    var planLabel = null

    // -- Plan label: derive from monthly grant --
    var monthlyAmt = null
    var planPoints = null
    if (typeof balanceResp.plan_points_balance === "number") {
      planPoints = balanceResp.plan_points_balance
    }
    if (typeof balanceResp.next_monthly_grant_amount === "number") {
      monthlyAmt = balanceResp.next_monthly_grant_amount
    }
    if (monthlyAmt !== null) {
      planLabel = fmtNum(monthlyAmt) + " pts/mo"
      if (usd !== null) planLabel += " ($" + usd.toFixed(2) + ")"
    } else if (usd !== null) {
      planLabel = "$" + usd.toFixed(2)
    } else if (planPoints !== null) {
      planLabel = fmtNum(planPoints) + " pts"
    } else {
      planLabel = "Poe"
    }

    // -- Progress: monthly credit usage (drives tray icon % and overview bar) --
    // Use next_monthly_grant_amount as total plan points (more reliable).
    // plan_points_balance now returns remaining plan points, not the total
    // allowance, making (total - remaining) / total incorrect when using it
    // as both numerator and denominator at billing period boundaries.
    var nextGrantMs = null
    if (typeof balanceResp.next_monthly_grant_time === "number") {
      nextGrantMs = balanceResp.next_monthly_grant_time / 1000
    }
    var totalPlanPoints = null
    if (typeof balanceResp.next_monthly_grant_amount === "number" && balanceResp.next_monthly_grant_amount > 0) {
      totalPlanPoints = balanceResp.next_monthly_grant_amount
    } else if (planPoints !== null && planPoints > 0) {
      totalPlanPoints = planPoints
    }
    if (totalPlanPoints !== null && totalPlanPoints > 0 && points !== null) {
      var usedPoints = Math.max(0, totalPlanPoints - points)
      var pctUsed = (usedPoints / totalPlanPoints) * 100
      var progressOpts = {
        label: "Monthly credits",
        used: pctUsed,
        limit: 100,
        format: { kind: "percent" },
      }
      if (nextGrantMs !== null) {
        var resetsAtIso = ctx.util.toIso(nextGrantMs)
        if (resetsAtIso) {
          progressOpts.resetsAt = resetsAtIso
          progressOpts.periodDurationMs = MONTH_MS
        }
      }
      lines.push(ctx.line.progress(progressOpts))
    }

    // -- Text: Credits --
    // if (points !== null) {
    //   var creditsText = fmtNum(points) + " pts"
    //   if (usd !== null) {
    //     creditsText += " ($" + usd.toFixed(2) + ")"
    //   }
    //   lines.push(ctx.line.text({
    //     label: "Credits",
    //     value: creditsText,
    //   }))
    // }

    // -- Days left in cycle: use next_monthly_grant_time (microseconds) --
    var daysLeft = null
    if (nextGrantMs !== null) {
      var nowMs = Date.now()
      var msLeft = nextGrantMs - nowMs
      if (msLeft > 0) {
        daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
      } else {
        daysLeft = 1
      }
    }
    // -- Daily budget: remaining pts / days left + daily grant --
    var dailyAmt = null
    if (typeof balanceResp.next_daily_grant_amount === "number") {
      dailyAmt = balanceResp.next_daily_grant_amount
    }
    var dailyBudget = null
    if (dailyAmt !== null && daysLeft !== null && points !== null) {
      dailyBudget = Math.floor(points / daysLeft) + dailyAmt
    } else if (dailyAmt !== null) {
      dailyBudget = dailyAmt
    }
    if (dailyBudget !== null) {
      lines.push(ctx.line.text({
        label: "Daily budget",
        value: fmtNum(dailyBudget) + " pts/day",
      }))
    }

    return { plan: planLabel, lines: lines }
  }

  globalThis.__openusage_plugin = { id: "poe", probe: probe }
})()
