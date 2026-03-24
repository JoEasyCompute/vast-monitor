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
    vastApiKeyPath: "/definitely/missing/api_key"
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

  const app = createServer({
    config,
    db,
    monitor,
    plugins: [definePlugin({
      name: "Assignment Plugin",
      async decorateStatusMachine({ machine }) {
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
    assert.equal(status.body.observability.lastPollDurationMs, 3200);
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 1)?.owner_name, "Alice");
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 1)?.team_name, "Inference");
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 1)?.has_new_report_72h, true);
    assert.equal(status.body.machines.find((machine) => machine.machine_id === 2)?.has_new_report_72h, false);

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, "degraded");
    assert.equal(health.body.liveOperationsOk, false);
    assert.equal(health.body.liveDependencies.vastCli.ok, false);
    assert.equal(health.body.observability.lastFetchDurationMs, 1400);
    assert.equal(health.body.observability.lastAlertCount, 1);

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

async function invokeRoute(app, routePath, { query = {} } = {}) {
  const layer = app.router.stack.find((entry) => entry.route?.path === routePath);
  assert.ok(layer, `Route ${routePath} not found`);

  const req = {
    query,
    method: "GET",
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

  await layer.route.stack[0].handle(req, res);
  return result;
}
