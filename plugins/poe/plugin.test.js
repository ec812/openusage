import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePluginTestContext } from "../test-helpers.js";

var MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function makeBalanceResponse(overrides = {}) {
  return {
    current_point_balance: 1000000,
    plan_points_balance: 2000000,
    total_balance_usd: "30.30",
    next_daily_grant_amount: 3000,
    // real API returns microseconds
    next_monthly_grant_time: (Date.now() + 30 * 24 * 60 * 60 * 1000) * 1000,
    ...overrides,
  };
}

function setApiKey(ctx, key) {
  ctx.host.env.get.mockImplementation(function (name) {
    if (name === "POE_API_KEY") return key || "test-poe-api-key";
    return null;
  });
}

const loadPlugin = async () => {
  await import("./plugin.js");
  return globalThis.__openusage_plugin;
};

describe("poe plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ships plugin metadata with links and expected line layout", () => {
    var manifest = JSON.parse(
      readFileSync("plugins/poe/plugin.json", "utf8"),
    );

    expect(manifest.id).toBe("poe");
    expect(manifest.name).toBe("Poe");
    expect(manifest.brandColor).toBe("#6C47FF");
    expect(manifest.links).toEqual([
      { label: "Dashboard", url: "https://poe.com/settings?tab=subscription" },
    ]);
    expect(manifest.lines).toEqual([
      { type: "progress", label: "Monthly credits", scope: "overview", primaryOrder: 1 },
      { type: "text", label: "Credits", scope: "overview" },
      { type: "text", label: "Daily budget", scope: "overview" },
    ]);
  });

  it("throws when POE_API_KEY env var is missing", async () => {
    var ctx = makePluginTestContext();
    var plugin = await loadPlugin();
    expect(function () { plugin.probe(ctx); }).toThrow("Poe API key not configured");
  });

  it("throws when API is unreachable", async () => {
    var ctx = makePluginTestContext();
    setApiKey(ctx);
    ctx.host.http.request.mockImplementation(function () {
      throw new Error("network error");
    });
    var plugin = await loadPlugin();
    expect(function () { plugin.probe(ctx); }).toThrow("Poe API unreachable");
  });

  it("includes resetsAt on monthly credits progress line", async () => {
    var ctx = makePluginTestContext();
    setApiKey(ctx);
    var nextGrantMs = Date.now() + 5 * 24 * 60 * 60 * 1000;
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeBalanceResponse({ next_monthly_grant_time: nextGrantMs * 1000 }),
      ),
    });

    var plugin = await loadPlugin();
    var result = plugin.probe(ctx);

    var progressLine = result.lines.find(function (l) {
      return l.label === "Monthly credits";
    });
    expect(progressLine).toBeTruthy();
    expect(progressLine.resetsAt).toBe(new Date(nextGrantMs).toISOString());
    expect(progressLine.periodDurationMs).toBe(MONTH_MS);
  });

  it("shows daily budget from next_daily_grant_amount", async () => {
    var ctx = makePluginTestContext();
    setApiKey(ctx);
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeBalanceResponse({ next_daily_grant_amount: 3000 })),
    });

    var plugin = await loadPlugin();
    var result = plugin.probe(ctx);

    var budgetLine = result.lines.find(function (l) { return l.label === "Daily budget"; });
    expect(budgetLine).toBeTruthy();
    expect(budgetLine.value).toBe("36,333 pts/day");
  });

  it("includes Authorization header with bearer token", async () => {
    var ctx = makePluginTestContext();
    setApiKey(ctx, "my-secret-key");
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeBalanceResponse()),
    });

    var plugin = await loadPlugin();
    plugin.probe(ctx);

    var calls = ctx.host.http.request.mock.calls;
    expect(calls[0][0].headers.Authorization).toBe("Bearer my-secret-key");
  });

  it("handles missing usd field gracefully", async () => {
    var ctx = makePluginTestContext();
    setApiKey(ctx);
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeBalanceResponse({ total_balance_usd: undefined })),
    });

    var plugin = await loadPlugin();
    var result = plugin.probe(ctx);

    expect(result.plan).toContain("pts");
    expect(result.lines.find(function (l) { return l.label === "Monthly credits"; })).toBeTruthy();
  });

  it("handles empty API response gracefully", async () => {
    var ctx = makePluginTestContext();
    setApiKey(ctx);
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({}),
    });

    var plugin = await loadPlugin();
    var result = plugin.probe(ctx);

    // No data lines but shouldn't crash
    expect(result.lines.length).toBe(0);
    expect(typeof result.plan).toBe("string");
  });
});
