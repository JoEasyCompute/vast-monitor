import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { createDatabase } from "../src/db.js";
import { createServer } from "../src/server.js";
import { definePlugin } from "../src/plugins/index.js";
import { makeMachine, makeTempDbPath } from "../support-helpers.js";

test("server integration returns expected API payloads and dependency failures", async () => {
  const dbPath = makeTempDbPath("vast-monitor-server-");
  const db = createDatabase(dbPath);

  db.recordPoll({
    timestamp: new Date().toISOString(),
    machines: [
      makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 3, listed_gpu_cost: 1.25, earn_day: 25 }),
      makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 1, listed_gpu_cost: 2.5, earn_day: 30, hosting_type: 0, is_datacenter: 0, datacenter_id: null })
    ],
    offlineMachines: [],
    events: [],
    alerts: [
      {
        created_at: new Date().toISOString(),
        machine_id: 1,
        hostname: "alpha",
        alert_type: "new_reports",
        severity: "warning",
        message: "alpha has 1 new report",
        payload_json: "{}"
      }
    ]
  });

  const config = {
    projectRoot: path.resolve("."),
    pollIntervalMs: 5 * 60 * 1000,
    vastCliPath: "/definitely/missing/vast",
    vastApiKeyPath: "/definitely/missing/api_key",
    adminApiToken: "secret-admin-token"
  };
  const monitor = {
    getHealthSnapshot() {
      return {
        isPolling: false,
        lastPollSucceededAt: db.getCurrentFleetStatus().latestPollAt,
        lastPollDurationMs: 3200,
        lastFetchDurationMs: 1400,
        lastPersistDurationMs: 700,
        lastAlertDispatchDurationMs: 90,
        lastOnlineMachineCount: 2,
        lastOfflineMachineCount: 0,
        lastEventCount: 0,
        lastAlertCount: 1,
        lastHostnameCollisionCount: 0
      };
    }
  };
  const decoratedDbRefs = [];

  const app = createServer({
    config,
    db,
    monitor,
    platformMetricsClient: {
      async getSnapshot() {
        return {
          ok: true,
          stale: false,
          fetchedAt: "2026-04-08T10:47:00.000Z",
          source: "https://gpu-treemap.replit.app/api/gpu-data",
          rows: [
            {
              gpu_type: "h100 pcie",
              canonical_gpu_type: "h100pcie",
              market_utilisation_pct: 72,
              market_gpus_on_platform: 10,
              market_gpus_available: 2,
              market_gpus_rented: 8,
              market_machines_available: 5,
              market_median_price: 1.3,
              market_minimum_price: 1.1,
              market_p10_price: 1.2,
              market_p90_price: 1.5
            },
            {
              gpu_type: "h100 sxm",
              canonical_gpu_type: "h100sxm",
              market_utilisation_pct: 81,
              market_gpus_on_platform: 12,
              market_gpus_available: 3,
              market_gpus_rented: 9,
              market_machines_available: 6,
              market_median_price: 1.7,
              market_minimum_price: 1.5,
              market_p10_price: 1.55,
              market_p90_price: 1.95
            },
            {
              gpu_type: "a100 pcie",
              canonical_gpu_type: "a100pcie",
              market_utilisation_pct: 65,
              market_gpus_on_platform: 8,
              market_gpus_available: 3,
              market_gpus_rented: 5,
              market_machines_available: 4,
              market_median_price: 0.9,
              market_minimum_price: 0.8,
              market_p10_price: 0.82,
              market_p90_price: 1.05
            },
            {
              gpu_type: "a100 sxm4",
              canonical_gpu_type: "a100sxm4",
              market_utilisation_pct: 88,
              market_gpus_on_platform: 6,
              market_gpus_available: 1,
              market_gpus_rented: 5,
              market_machines_available: 2,
              market_median_price: 1.2,
              market_minimum_price: 1.1,
              market_p10_price: 1.12,
              market_p90_price: 1.35
            }
          ]
        };
      }
    },
    plugins: [definePlugin({
      name: "Assignment Plugin",
      async decorateStatusMachine({ machine, db: pluginDb }) {
        decoratedDbRefs.push(pluginDb);
        if (machine.machine_id !== 1) {
          return machine;
        }

        return {
          ...machine,
          owner_name: "Alice",
          team_name: "Inference"
        };
      }
    })]
  });

  try {
    const status = await invokeRoute(app, "/api/status");
    const health = await invokeRoute(app, "/api/health");
    const dbHealth = await invokeRoute(app, "/api/admin/db-health", {
      headers: {
        authorization: "Bearer secret-admin-token"
      }
    });
    const retentionPreview = await invokeRoute(app, "/api/admin/retention-preview", {
      headers: {
        authorization: "Bearer secret-admin-token"
      }
    });
    const analyze = await invokeRoute(app, "/api/admin/analyze", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-admin-token"
      }
    });
    const vacuum = await invokeRoute(app, "/api/admin/vacuum", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-admin-token"
      }
    });
    const rebuild = await invokeRoute(app, "/api/admin/rebuild-derived", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-admin-token"
      }
    });
    const fleet = await invokeRoute(app, "/api/fleet/history", { query: { hours: "24" } });
    const history = await invokeRoute(app, "/api/history", { query: { machine_id: "1", hours: "24" } });
    const reports = await invokeRoute(app, "/api/reports", { query: { machine_id: "1" } });
    const machineEarningsRange = await invokeRoute(app, "/api/earnings/machine", {
      query: {
        machine_id: "1",
        start: "2026-02-01T00:00:00.000Z",
        end: "2026-03-01T00:00:00.000Z"
      }
    });
    const machineMonthlySummary = await invokeRoute(app, "/api/earnings/machine/monthly-summary", {
      query: { machine_id: "1" }
    });

    assert.equal(status.statusCode, 200);
    assert.equal(status.body.summary.totalMachines, 2);
    assert.equal(status.body.summary.listedGpus, 6);
    assert.equal(status.body.gpuTypeBreakdown.length, 2);
    assert.equal(status.body.marketBenchmark.ok, true);
    assert.equal(status.body.marketBenchmark.stale, false);
    assert.equal(status.body.summary.marketUtilisationPct, null);
    assert.equal(status.body.summary.marketCoveragePct, 0);
    assert.equal(status.body.gpuTypeBreakdown.find((row) => row.gpu_type === "A100")?.market_match_status, "ambiguous");
    assert.equal(status.body.gpuTypeBreakdown.find((row) => row.gpu_type === "H100")?.market_match_status, "ambiguous");
    assert.equal(status.body.observability.lastPollDurationMs, 3200);
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 1)?.owner_name, "Alice");
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 1)?.team_name, "Inference");
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 1)?.has_new_report_72h, true);
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 2)?.has_new_report_72h, false);
    assert.equal(decoratedDbRefs.length, 2);
    assert.ok(decoratedDbRefs.every((value) => value === db));

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, "degraded");
    assert.equal(health.body.liveOperationsOk, false);
    assert.equal(health.body.liveDependencies.vastCli.ok, false);
    assert.equal(health.body.observability.lastFetchDurationMs, 1400);
    assert.equal(health.body.observability.lastAlertCount, 1);
    assert.equal(health.body.endpoint_timings.status.calls, 1);
    assert.equal(health.body.endpoint_timings.status.errors, 0);
    assert.ok(Number.isFinite(health.body.endpoint_timings.status.last_duration_ms));

    assert.equal(dbHealth.statusCode, 200);
    assert.equal(dbHealth.body.ok, true);
    assert.equal(dbHealth.body.database.row_counts.polls, 1);
    assert.equal(dbHealth.body.database.row_counts.machine_snapshots, 2);
    assert.equal(dbHealth.body.database.row_counts.fleet_snapshot_hourly_rollups, 0);
    assert.equal(dbHealth.body.database.row_counts.machine_snapshot_hourly_rollups, 0);
    assert.equal(dbHealth.body.database.row_counts.gpu_type_utilization_hourly_rollups, 0);
    assert.equal(dbHealth.body.database.row_counts.gpu_type_price_hourly_rollups, 0);
    assert.equal(dbHealth.body.database.row_counts.maintenance_runs, 0);
    assert.equal(dbHealth.body.database.row_counts.alerts, 1);
    assert.equal(dbHealth.body.database.derived_state.fleet_snapshot_state_version, "1");
    assert.equal(dbHealth.body.database.retention.snapshot_days, 0);
    assert.ok(typeof dbHealth.body.database.file_size_bytes === "number");
    assert.equal(dbHealth.body.route_metrics.health.calls, 1);
    assert.equal(dbHealth.body.route_metrics.status.calls, 1);
    assert.equal(retentionPreview.statusCode, 200);
    assert.equal(retentionPreview.body.ok, true);
    assert.equal(retentionPreview.body.preview.would_delete.polls, 0);
    assert.equal(retentionPreview.body.preview.would_upsert_rollups.machine_snapshot_hourly_rollups, 0);
    assert.equal(analyze.statusCode, 200);
    assert.equal(analyze.body.ok, true);
    assert.ok(Number.isFinite(analyze.body.analyze.duration_ms));
    assert.ok(typeof analyze.body.analyze.completed_at === "string");
    assert.equal(vacuum.statusCode, 200);
    assert.equal(vacuum.body.ok, true);
    assert.ok(Number.isFinite(vacuum.body.vacuum.duration_ms));
    assert.ok(typeof vacuum.body.vacuum.completed_at === "string");
    assert.ok(Number.isFinite(vacuum.body.vacuum.file_size_bytes));
    assert.equal(rebuild.statusCode, 200);
    assert.equal(rebuild.body.ok, true);
    assert.ok(Number.isFinite(rebuild.body.rebuild.duration_ms));
    assert.ok(typeof rebuild.body.rebuild.completed_at === "string");
    assert.ok(Number.isFinite(rebuild.body.rebuild.rebuilt.fleet_snapshots));
    const dbHealthAfterMaintenance = await invokeRoute(app, "/api/admin/db-health", {
      headers: {
        authorization: "Bearer secret-admin-token"
      }
    });
    assert.equal(dbHealthAfterMaintenance.body.database.row_counts.maintenance_runs, 3);
    assert.equal(dbHealthAfterMaintenance.body.database.maintenance.recent_runs[0].action, "rebuild_derived");

    assert.equal(fleet.statusCode, 200);
    assert.ok(Array.isArray(fleet.body.history));
    assert.ok(Array.isArray(fleet.body.gpu_type_utilization));

    assert.equal(history.statusCode, 200);
    assert.equal(history.body.history[0].num_gpus, 4);

    assert.equal(reports.statusCode, 502);
    assert.equal(reports.body.error, "failed to fetch reports");
    assert.equal(reports.body.dependency.ok, false);
    assert.match(reports.body.dependency.health.detail, /CLI binary not found|not executable/i);

    assert.equal(machineEarningsRange.statusCode, 502);
    assert.equal(machineEarningsRange.body.error, "failed to fetch machine earnings");
    assert.equal(machineEarningsRange.body.dependency.ok, false);

    assert.equal(machineMonthlySummary.statusCode, 502);
    assert.equal(machineMonthlySummary.body.error, "failed to fetch machine monthly earnings summary");
    assert.equal(machineMonthlySummary.body.dependency.ok, false);
  } finally {
    db.db.close();
  }
});

test("status includes current market utilization benchmarks for exact GPU matches", async () => {
  const dbPath = makeTempDbPath("vast-monitor-server-market-match-");
  const db = createDatabase(dbPath);

  db.recordPoll({
    timestamp: new Date().toISOString(),
    machines: [
      makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "RTX 4090", num_gpus: 3, occupied_gpus: 2, listed_gpu_cost: 0.35, earn_day: 25 }),
      makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "RTX 5090", num_gpus: 1, occupied_gpus: 1, listed_gpu_cost: 0.42, earn_day: 11 })
    ],
    offlineMachines: [],
    events: [],
    alerts: []
  });

  const app = createServer({
    config: {
      projectRoot: path.resolve("."),
      pollIntervalMs: 5 * 60 * 1000,
      vastCliPath: "/definitely/missing/vast",
      vastApiKeyPath: "/definitely/missing/api_key",
      adminApiToken: ""
    },
    db,
    monitor: {
      getHealthSnapshot() {
        return {
          isPolling: false,
          lastPollSucceededAt: db.getCurrentFleetStatus().latestPollAt
        };
      }
    },
    platformMetricsClient: {
      async getSnapshot() {
        return {
          ok: true,
          stale: false,
          fetchedAt: "2026-04-08T10:47:00.000Z",
          source: "https://gpu-treemap.replit.app/api/gpu-data",
          rows: [
            {
              gpu_type: "rtx 4090",
              canonical_gpu_type: "rtx4090",
              market_utilisation_pct: 87.38,
              market_gpus_on_platform: 3558,
              market_gpus_available: 449,
              market_gpus_rented: 3109,
              market_machines_available: 879,
              market_median_price: 0.35,
              market_minimum_price: 0.201,
              market_p10_price: 0.269,
              market_p90_price: 0.434
            },
            {
              gpu_type: "rtx 5090",
              canonical_gpu_type: "rtx5090",
              market_utilisation_pct: 80.13,
              market_gpus_on_platform: 4253,
              market_gpus_available: 845,
              market_gpus_rented: 3408,
              market_machines_available: 1068,
              market_median_price: 0.42,
              market_minimum_price: 0.242,
              market_p10_price: 0.334,
              market_p90_price: 0.653
            }
          ]
        };
      }
    }
  });

  try {
    const status = await invokeRoute(app, "/api/status");

    assert.equal(status.statusCode, 200);
    assert.equal(status.body.summary.marketMatchedListedGpus, 4);
    assert.equal(status.body.summary.marketTotalListedGpus, 4);
    assert.equal(status.body.summary.marketCoveragePct, 100);
    assert.equal(status.body.summary.marketUtilisationPct, 85.57);
    assert.equal(status.body.marketBenchmark.ok, true);

    const rtx4090 = status.body.gpuTypeBreakdown.find((row) => row.gpu_type === "RTX 4090");
    const rtx5090 = status.body.gpuTypeBreakdown.find((row) => row.gpu_type === "RTX 5090");
    assert.equal(rtx4090.market_match_status, "matched");
    assert.equal(rtx4090.market_utilisation_pct, 87.38);
    assert.equal(rtx4090.market_machines_available, 879);
    assert.equal(rtx4090.market_minimum_price, 0.201);
    assert.equal(rtx4090.market_price_position, "at_market");
    assert.equal(rtx4090.market_price_delta, 0);
    assert.equal(rtx5090.market_match_status, "matched");
    assert.equal(rtx5090.market_gpus_rented, 3408);
    assert.equal(rtx5090.market_p90_price, 0.653);
    assert.equal(rtx5090.market_price_position, "at_market");
    assert.equal(rtx5090.market_price_delta_pct, 0);
  } finally {
    db.db.close();
  }
});

test("status excludes machines offline for more than 24 hours from fleet summary but keeps them in the machine list", async () => {
  const dbPath = makeTempDbPath("vast-monitor-server-offline-");
  const db = createDatabase(dbPath);
  const now = new Date();
  const oldOfflineAt = new Date(now.getTime() - (30 * 60 * 60 * 1000)).toISOString();

  db.recordPoll({
    timestamp: now.toISOString(),
    machines: [
      makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 2, listed_gpu_cost: 1.25, earn_day: 25 })
    ],
    offlineMachines: [
      makeMachine({
        machine_id: 2,
        hostname: "beta",
        gpu_type: "H100",
        num_gpus: 2,
        listed: 0,
        occupied_gpus: 0,
        current_rentals_running: 0,
        listed_gpu_cost: null,
        earn_day: 0,
        status: "offline",
        last_online_at: oldOfflineAt,
        last_seen_at: oldOfflineAt
      })
    ],
    events: [],
    alerts: []
  });

  const app = createServer({
    config: {
      projectRoot: path.resolve("."),
      pollIntervalMs: 5 * 60 * 1000,
      vastCliPath: "/definitely/missing/vast",
      vastApiKeyPath: "/definitely/missing/api_key"
    },
    db,
    monitor: null
  });

  try {
    const status = await invokeRoute(app, "/api/status");

    assert.equal(status.statusCode, 200);
    assert.equal(status.body.summary.totalMachines, 1);
    assert.equal(status.body.summary.unlistedMachines, 0);
    assert.equal(status.body.summary.unlistedGpus, 0);
    assert.equal(status.body.machines.length, 2);
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 2)?.status, "offline");
  } finally {
    db.db.close();
  }
});

test("admin db-health route requires configured auth token", async () => {
  const dbPath = makeTempDbPath("vast-monitor-server-admin-auth-");
  const db = createDatabase(dbPath);

  const app = createServer({
    config: {
      projectRoot: path.resolve("."),
      pollIntervalMs: 5 * 60 * 1000,
      vastCliPath: "/definitely/missing/vast",
      vastApiKeyPath: "/definitely/missing/api_key",
      adminApiToken: "top-secret"
    },
    db,
    monitor: null
  });

  try {
    const missing = await invokeRoute(app, "/api/admin/db-health");
    const wrong = await invokeRoute(app, "/api/admin/db-health", {
      headers: { "x-admin-token": "wrong-token" }
    });
    const ok = await invokeRoute(app, "/api/admin/db-health", {
      headers: { "x-admin-token": "top-secret" }
    });
    const preview = await invokeRoute(app, "/api/admin/retention-preview", {
      headers: { authorization: "Bearer top-secret" }
    });
    const analyze = await invokeRoute(app, "/api/admin/analyze", {
      method: "POST",
      headers: { authorization: "Bearer top-secret" }
    });
    const vacuum = await invokeRoute(app, "/api/admin/vacuum", {
      method: "POST",
      headers: { authorization: "Bearer top-secret" }
    });
    const rebuild = await invokeRoute(app, "/api/admin/rebuild-derived", {
      method: "POST",
      headers: { authorization: "Bearer top-secret" }
    });

    assert.equal(missing.statusCode, 401);
    assert.equal(missing.body.error, "admin authorization required");
    assert.equal(wrong.statusCode, 401);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.ok, true);
    assert.equal(preview.statusCode, 200);
    assert.equal(analyze.statusCode, 200);
    assert.equal(vacuum.statusCode, 200);
    assert.equal(rebuild.statusCode, 200);
  } finally {
    db.db.close();
  }
});

test("admin heavy maintenance routes can be queued in background mode", async () => {
  const dbPath = makeTempDbPath("vast-monitor-server-admin-async-");
  const db = createDatabase(dbPath);
  const scheduled = [];

  const app = createServer({
    config: {
      projectRoot: path.resolve("."),
      pollIntervalMs: 5 * 60 * 1000,
      vastCliPath: "/definitely/missing/vast",
      vastApiKeyPath: "/definitely/missing/api_key",
      adminApiToken: "async-secret"
    },
    db,
    monitor: null,
    adminActionScheduler: (callback) => {
      scheduled.push(callback);
      return 1;
    }
  });

  try {
    const queuedVacuum = await invokeRoute(app, "/api/admin/vacuum", {
      method: "POST",
      query: { async: "1" },
      headers: { authorization: "Bearer async-secret" }
    });
    const queuedRebuild = await invokeRoute(app, "/api/admin/rebuild-derived", {
      method: "POST",
      query: { async: "1" },
      headers: { authorization: "Bearer async-secret" }
    });

    assert.equal(queuedVacuum.statusCode, 202);
    assert.equal(queuedVacuum.body.queued, true);
    assert.equal(queuedVacuum.body.action, "vacuum");
    assert.ok([202, 409].includes(queuedRebuild.statusCode));
    assert.equal(scheduled.length, 1);
  } finally {
    db.db.close();
  }
});

test("admin db-health route is disabled when no admin token is configured", async () => {
  const dbPath = makeTempDbPath("vast-monitor-server-admin-disabled-");
  const db = createDatabase(dbPath);

  const app = createServer({
    config: {
      projectRoot: path.resolve("."),
      pollIntervalMs: 5 * 60 * 1000,
      vastCliPath: "/definitely/missing/vast",
      vastApiKeyPath: "/definitely/missing/api_key",
      adminApiToken: ""
    },
    db,
    monitor: null
  });

  try {
    const response = await invokeRoute(app, "/api/admin/db-health");
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.error, "admin api disabled");
  } finally {
    db.db.close();
  }
});

async function invokeRoute(app, routePath, { query = {}, headers = {}, method = "GET" } = {}) {
  const layer = app.router.stack.find((entry) => entry.route?.path === routePath);
  assert.ok(layer, `Route ${routePath} not found`);

  const req = {
    query,
    headers,
    method,
    url: routePath
  };

  const result = {
    statusCode: 200,
    body: undefined
  };

  const res = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
    sendFile(payload) {
      result.body = payload;
      return this;
    }
  };

  const handlerLayer = layer.route.stack.find((entry) => entry.method === method.toLowerCase()) || layer.route.stack[0];
  await handlerLayer.handle(req, res);
  return result;
}
