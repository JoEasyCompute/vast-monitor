import test from "node:test";
import assert from "node:assert/strict";

import { createDatabase } from "../src/db.js";
import { makeMachine, makeTempDbPath } from "../support-helpers.js";

test("database integration returns fleet history, gpu utilization, price history, and hourly earnings", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-");
  const store = createDatabase(dbPath);

  try {
    store.recordPoll({
      timestamp: "2026-03-14T10:00:00.000Z",
      machines: [
        makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 2, listed_gpu_cost: 1.2, earn_day: 20 }),
        makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 1, listed_gpu_cost: 2.4, earn_day: 30 })
      ],
      offlineMachines: [],
      events: [],
      alerts: []
    });

    store.recordPoll({
      timestamp: "2026-03-14T11:00:00.000Z",
      machines: [
        makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 4, listed_gpu_cost: 1.4, earn_day: 24 }),
        makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 0, listed_gpu_cost: 2.4, earn_day: 12 }),
        makeMachine({ machine_id: 3, hostname: "gamma", gpu_type: "A100", num_gpus: 2, occupied_gpus: 0, listed: 0, listed_gpu_cost: null, earn_day: 0, hosting_type: 0, is_datacenter: 0, datacenter_id: null })
      ],
      offlineMachines: [],
      events: [],
      alerts: [
        {
          created_at: "2026-03-14T11:00:00.000Z",
          machine_id: null,
          hostname: null,
          alert_type: "hostname_collision",
          severity: "warning",
          message: "alpha appeared twice",
          payload_json: "{}"
        }
      ]
    });

    const fleet = store.getCurrentFleetStatus();
    const fleetHistory = store.getFleetHistory(24);
    const priceHistory = store.getGpuTypePriceHistory(24, 6);
    const hourly = store.getHourlyEarnings("2026-03-14");
    const alerts = store.getRecentAlerts(10);

    assert.equal(fleet.machines.length, 3);
    assert.equal(fleet.latestPollAt, "2026-03-14T11:00:00.000Z");
    assert.equal(fleetHistory.history.length, 2);
    assert.equal(fleetHistory.gpu_type_utilization.length, 2);
    assert.equal(fleetHistory.gpu_type_utilization[0].gpu_type, "A100");
    assert.equal(fleetHistory.gpu_type_utilization[0].points[1].utilisation_pct, 100);
    assert.equal(priceHistory.series.length, 2);
    assert.equal(priceHistory.series[0].gpu_type, "A100");
    assert.equal(hourly.total, 4.8);
    assert.equal(hourly.hours[10].earnings, 4.8);
    assert.equal(alerts[0].alert_type, "hostname_collision");
  } finally {
    store.db.close();
  }
});
