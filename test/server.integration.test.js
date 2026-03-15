import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { createDatabase } from "../src/db.js";
import { createServer } from "../src/server.js";
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
    alerts: []
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
        lastPollSucceededAt: db.getCurrentFleetStatus().latestPollAt
      };
    }
  };

  const app = createServer({ config, db, monitor });

  try {
    const status = await invokeRoute(app, "/api/status");
    const health = await invokeRoute(app, "/api/health");
    const fleet = await invokeRoute(app, "/api/fleet/history", { query: { hours: "24" } });
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

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, "degraded");
    assert.equal(health.body.liveOperationsOk, false);
    assert.equal(health.body.liveDependencies.vastCli.ok, false);

    assert.equal(fleet.statusCode, 200);
    assert.ok(Array.isArray(fleet.body.history));
    assert.ok(Array.isArray(fleet.body.gpu_type_utilization));

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
