import test from "node:test";
import assert from "node:assert/strict";

import { createDashboardController } from "../public/app/dashboard-controller.js";

test("dashboard controller applies partial results and refreshes the open machine modal", async () => {
  const calls = [];
  const controller = createDashboardController({
    getSelectedEarningsDate: () => "2026-03-23",
    getSelectedTrendHours: () => 168,
    getAdminApiToken: () => "token-123",
    fetchDashboardPayload: async () => ({
      payload: {
        status: { health: { liveOperationsOk: true }, machines: [{ machine_id: 49697 }] },
        dbHealth: { ok: true, database: { row_counts: { polls: 1 } } },
        fleetHistory: { history: [1] },
        earnings: { total: 42, hours: [], date: "2026-03-23" },
        alerts: { alerts: [{ id: 1 }] }
      },
      failures: [{ key: "gpuTypePrice", label: "GPU type pricing", critical: false }]
    }),
    renderDashboardNotice: (failures) => calls.push(["notice", failures.map((item) => item.label)]),
    applyStatusPayload: (payload) => calls.push(["status", payload.machines.length]),
    applyDbHealthPayload: (payload) => calls.push(["db-health", payload.database.row_counts.polls]),
    applyFleetHistoryPayload: (payload) => calls.push(["fleet", payload.history.length]),
    applyGpuTypePricePayload: () => calls.push(["gpu-price"]),
    applyHourlyEarningsPayload: (payload) => calls.push(["earnings", payload.total]),
    applyAlertsPayload: (payload) => calls.push(["alerts", payload.alerts.length]),
    renderFleetHistoryUnavailable: () => calls.push(["fleet-unavailable"]),
    renderGpuTypePriceUnavailable: () => calls.push(["gpu-price-unavailable"]),
    renderHourlyEarningsUnavailable: () => calls.push(["earnings-unavailable"]),
    renderAlertsUnavailable: () => calls.push(["alerts-unavailable"]),
    hasFleetHistoryPayload: () => false,
    hasGpuTypePricePayload: () => false,
    hasHourlyEarningsPayload: () => false,
    hasAlertsRendered: () => false,
    isMachineModalOpen: () => true,
    getCurrentMachineHistoryId: () => 49697,
    refreshCurrentMachineModal: (machineId) => calls.push(["refresh-modal", machineId]),
    handleRefreshFailure: (error) => calls.push(["failure", error.message]),
    setRefreshTimer: () => 1
  });

  await controller.refreshDashboard();

  assert.deepEqual(calls, [
    ["notice", ["GPU type pricing"]],
    ["status", 1],
    ["db-health", 1],
    ["fleet", 1],
    ["gpu-price-unavailable"],
    ["earnings", 42],
    ["alerts", 1],
    ["refresh-modal", 49697]
  ]);
});

test("dashboard controller falls back to unavailable renderers only when cached data is absent", async () => {
  const calls = [];
  const controller = createDashboardController({
    getSelectedEarningsDate: () => "2026-03-23",
    getSelectedTrendHours: () => 24,
    getAdminApiToken: () => "",
    fetchDashboardPayload: async () => ({
      payload: {},
      failures: [{ key: "status", label: "fleet status", critical: true }]
    }),
    renderDashboardNotice: () => calls.push("notice"),
    applyStatusPayload: () => calls.push("status"),
    applyDbHealthPayload: () => calls.push("db-health"),
    applyFleetHistoryPayload: () => calls.push("fleet"),
    applyGpuTypePricePayload: () => calls.push("gpu-price"),
    applyHourlyEarningsPayload: () => calls.push("earnings"),
    applyAlertsPayload: () => calls.push("alerts"),
    renderFleetHistoryUnavailable: () => calls.push("fleet-unavailable"),
    renderGpuTypePriceUnavailable: () => calls.push("gpu-price-unavailable"),
    renderHourlyEarningsUnavailable: () => calls.push("earnings-unavailable"),
    renderAlertsUnavailable: () => calls.push("alerts-unavailable"),
    hasFleetHistoryPayload: () => false,
    hasGpuTypePricePayload: () => true,
    hasHourlyEarningsPayload: () => false,
    hasAlertsRendered: () => true,
    isMachineModalOpen: () => false,
    getCurrentMachineHistoryId: () => null,
    refreshCurrentMachineModal: () => calls.push("refresh-modal"),
    handleRefreshFailure: (error) => calls.push(["failure", error.message]),
    setRefreshTimer: () => 1
  });

  await controller.refreshDashboard();

  assert.deepEqual(calls, [
    "notice",
    "fleet-unavailable",
    "earnings-unavailable"
  ]);
});

test("dashboard controller delegates thrown refresh errors to the failure handler", async () => {
  const calls = [];
  const controller = createDashboardController({
    getSelectedEarningsDate: () => "2026-03-23",
    getSelectedTrendHours: () => 24,
    getAdminApiToken: () => "",
    fetchDashboardPayload: async () => {
      throw new Error("boom");
    },
    renderDashboardNotice: () => calls.push("notice"),
    applyStatusPayload: () => calls.push("status"),
    applyDbHealthPayload: () => calls.push("db-health"),
    applyFleetHistoryPayload: () => calls.push("fleet"),
    applyGpuTypePricePayload: () => calls.push("gpu-price"),
    applyHourlyEarningsPayload: () => calls.push("earnings"),
    applyAlertsPayload: () => calls.push("alerts"),
    renderFleetHistoryUnavailable: () => calls.push("fleet-unavailable"),
    renderGpuTypePriceUnavailable: () => calls.push("gpu-price-unavailable"),
    renderHourlyEarningsUnavailable: () => calls.push("earnings-unavailable"),
    renderAlertsUnavailable: () => calls.push("alerts-unavailable"),
    hasFleetHistoryPayload: () => false,
    hasGpuTypePricePayload: () => false,
    hasHourlyEarningsPayload: () => false,
    hasAlertsRendered: () => false,
    isMachineModalOpen: () => false,
    getCurrentMachineHistoryId: () => null,
    refreshCurrentMachineModal: () => calls.push("refresh-modal"),
    handleRefreshFailure: (error) => calls.push(["failure", error.message]),
    setRefreshTimer: () => 1
  });

  await controller.refreshDashboard();

  assert.deepEqual(calls, [["failure", "boom"]]);
});

test("dashboard controller startAutoRefresh schedules periodic refreshes", () => {
  const calls = [];
  const controller = createDashboardController({
    getSelectedEarningsDate: () => "2026-03-23",
    getSelectedTrendHours: () => 24,
    getAdminApiToken: () => "",
    fetchDashboardPayload: async () => ({ payload: {}, failures: [] }),
    renderDashboardNotice: () => calls.push("notice"),
    applyStatusPayload: () => calls.push("status"),
    applyDbHealthPayload: () => calls.push("db-health"),
    applyFleetHistoryPayload: () => calls.push("fleet"),
    applyGpuTypePricePayload: () => calls.push("gpu-price"),
    applyHourlyEarningsPayload: () => calls.push("earnings"),
    applyAlertsPayload: () => calls.push("alerts"),
    renderFleetHistoryUnavailable: () => calls.push("fleet-unavailable"),
    renderGpuTypePriceUnavailable: () => calls.push("gpu-price-unavailable"),
    renderHourlyEarningsUnavailable: () => calls.push("earnings-unavailable"),
    renderAlertsUnavailable: () => calls.push("alerts-unavailable"),
    hasFleetHistoryPayload: () => true,
    hasGpuTypePricePayload: () => true,
    hasHourlyEarningsPayload: () => true,
    hasAlertsRendered: () => true,
    isMachineModalOpen: () => false,
    getCurrentMachineHistoryId: () => null,
    refreshCurrentMachineModal: () => calls.push("refresh-modal"),
    handleRefreshFailure: (error) => calls.push(["failure", error.message]),
    setRefreshTimer: (callback, delayMs) => {
      calls.push(["timer", delayMs]);
      callback();
      return 99;
    }
  });

  const timerId = controller.startAutoRefresh(300000);

  assert.equal(timerId, 99);
  assert.deepEqual(calls[0], ["timer", 300000]);
});
