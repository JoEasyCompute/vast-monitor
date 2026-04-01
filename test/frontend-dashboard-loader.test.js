import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardNoticeMessage,
  fetchDashboardPayload
} from "../public/app/dashboard-loader.js";

test("fetchDashboardPayload returns all dashboard sections on success", async () => {
  const seen = [];
  const result = await fetchDashboardPayload({
    selectedEarningsDate: "2026-03-23",
    selectedTrendHours: 24,
    adminApiToken: "token-123",
    fetchImpl: async (path, init) => {
      seen.push([path, init?.headers?.Authorization || null]);
      return okResponse({ path });
    }
  });

  assert.deepEqual(seen, [
    ["/api/status", null],
    ["/api/alerts?limit=10", null],
    ["/api/earnings/hourly?date=2026-03-23", null],
    ["/api/fleet/history?hours=24", null],
    ["/api/gpu-type/price-history?hours=24&top=6", null],
    ["/api/admin/db-health", "Bearer token-123"]
  ]);
  assert.equal(result.hasCriticalFailure, false);
  assert.deepEqual(result.failures, []);
  assert.equal(result.payload.status.path, "/api/status");
  assert.equal(result.payload.alerts.path, "/api/alerts?limit=10");
  assert.equal(result.payload.dbHealth.path, "/api/admin/db-health");
});

test("fetchDashboardPayload preserves partial results and marks critical failures", async () => {
  const result = await fetchDashboardPayload({
    selectedEarningsDate: "2026-03-23",
    selectedTrendHours: 168,
    fetchImpl: async (path) => {
      if (path === "/api/status") {
        return { ok: false, status: 503, async json() { return {}; } };
      }
      if (path.startsWith("/api/fleet/history")) {
        throw new Error("network timeout");
      }
      return okResponse({ ok: true, path });
    }
  });

  assert.equal(result.hasCriticalFailure, true);
  assert.deepEqual(result.failures.map((item) => item.key), ["status", "fleetHistory"]);
  assert.equal(result.payload.alerts.ok, true);
  assert.equal(result.payload.earnings.ok, true);
  assert.equal(result.payload.gpuTypePrice.ok, true);
});

test("fetchDashboardPayload skips database health when no admin token is provided", async () => {
  const seen = [];
  await fetchDashboardPayload({
    selectedEarningsDate: "2026-03-23",
    selectedTrendHours: 24,
    adminApiToken: "",
    fetchImpl: async (path) => {
      seen.push(path);
      return okResponse({ path });
    }
  });

  assert.ok(!seen.includes("/api/admin/db-health"));
});

test("buildDashboardNoticeMessage summarizes unavailable sections", () => {
  assert.equal(buildDashboardNoticeMessage([]), "");
  assert.equal(
    buildDashboardNoticeMessage([
      { label: "alerts", critical: false }
    ]),
    "Some dashboard sections are temporarily unavailable. Unavailable: alerts."
  );
  assert.equal(
    buildDashboardNoticeMessage([
      { label: "fleet status", critical: true },
      { label: "fleet trends", critical: false },
      { label: "GPU type pricing", critical: false }
    ]),
    "Dashboard refresh incomplete. Unavailable: fleet status, fleet trends, and GPU type pricing."
  );
});

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}
