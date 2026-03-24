import test from "node:test";
import assert from "node:assert/strict";

import { createDatabase } from "../src/db.js";
import { makeMachine, makeTempDbPath } from "../support-helpers.js";

test("database integration returns fleet history, gpu utilization, price history, and hourly earnings", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-");
  const store = createDatabase(dbPath);
  const baseTime = new Date();
  const firstPollAt = new Date(baseTime.getTime() - (2 * 60 * 60 * 1000));
  const secondPollAt = new Date(baseTime.getTime() - (60 * 60 * 1000));
  const firstDate = firstPollAt.toISOString();
  const secondDate = secondPollAt.toISOString();
  const earningsDate = firstDate.slice(0, 10);
  const firstHour = firstPollAt.getUTCHours();

  try {
    store.recordPoll({
      timestamp: firstDate,
      machines: [
        makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 2, listed_gpu_cost: 1.2, earn_day: 20 }),
        makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 1, listed_gpu_cost: 2.4, earn_day: 30 }),
        makeMachine({ machine_id: 4, hostname: "delta", gpu_type: "RTX 4090", num_gpus: 1, occupied_gpus: 1, listed_gpu_cost: 1.8, earn_day: 12 }),
        makeMachine({ machine_id: 5, hostname: "epsilon", gpu_type: "RTX A4000", num_gpus: 1, occupied_gpus: 0, listed_gpu_cost: 0.6, earn_day: 4 }),
        makeMachine({ machine_id: 6, hostname: "zeta", gpu_type: "RTX 6000ADA", num_gpus: 1, occupied_gpus: 1, listed_gpu_cost: 1.3, earn_day: 9 }),
        makeMachine({ machine_id: 7, hostname: "eta", gpu_type: "RTX 5090", num_gpus: 1, occupied_gpus: 0, listed_gpu_cost: 2.2, earn_day: 7 })
      ],
      offlineMachines: [],
      events: [],
      alerts: []
    });

    store.recordPoll({
      timestamp: secondDate,
      machines: [
        makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 4, listed_gpu_cost: 1.4, earn_day: 24 }),
        makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 0, listed_gpu_cost: 2.4, earn_day: 12 }),
        makeMachine({ machine_id: 4, hostname: "delta", gpu_type: "RTX 4090", num_gpus: 1, occupied_gpus: 0, listed_gpu_cost: 1.8, earn_day: 8 }),
        makeMachine({ machine_id: 5, hostname: "epsilon", gpu_type: "RTX A4000", num_gpus: 1, occupied_gpus: 1, listed_gpu_cost: 0.6, earn_day: 6 }),
        makeMachine({ machine_id: 6, hostname: "zeta", gpu_type: "RTX 6000ADA", num_gpus: 1, occupied_gpus: 1, listed_gpu_cost: 1.3, earn_day: 10 }),
        makeMachine({ machine_id: 7, hostname: "eta", gpu_type: "RTX 5090", num_gpus: 1, occupied_gpus: 1, listed_gpu_cost: 2.2, earn_day: 11 }),
        makeMachine({ machine_id: 3, hostname: "gamma", gpu_type: "A100", num_gpus: 2, occupied_gpus: 0, listed: 0, listed_gpu_cost: null, earn_day: 0, hosting_type: 0, is_datacenter: 0, datacenter_id: null })
      ],
      offlineMachines: [],
      events: [],
      alerts: [
        {
          created_at: secondDate,
          machine_id: 1,
          hostname: "alpha",
          alert_type: "new_reports",
          severity: "warning",
          message: "alpha has 1 new report",
          payload_json: "{}"
        },
        {
          created_at: secondDate,
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
    const hourly = store.getHourlyEarnings(earningsDate);
    const alerts = store.getRecentAlerts(10);

    assert.equal(fleet.machines.length, 7);
    assert.equal(fleet.latestPollAt, secondDate);
    assert.equal(fleet.machines.find((machine) => machine.machine_id === 1)?.has_new_report_72h, true);
    assert.equal(fleet.machines.find((machine) => machine.machine_id === 2)?.has_new_report_72h, false);
    assert.equal(fleetHistory.history.length, 2);
    assert.equal(fleetHistory.gpu_type_utilization.length, 6);
    assert.equal(fleetHistory.gpu_type_utilization[0].gpu_type, "A100");
    assert.equal(fleetHistory.gpu_type_utilization[0].points[1].utilisation_pct, 100);
    assert.ok(fleetHistory.gpu_type_utilization.some((series) => series.gpu_type === "RTX 4090"));
    assert.ok(fleetHistory.gpu_type_utilization.some((series) => series.gpu_type === "RTX A4000"));
    assert.ok(fleetHistory.gpu_type_utilization.some((series) => series.gpu_type === "RTX 6000ADA"));
    assert.ok(fleetHistory.gpu_type_utilization.some((series) => series.gpu_type === "RTX 5090"));
    assert.equal(priceHistory.series.length, 6);
    assert.equal(priceHistory.series[0].gpu_type, "A100");
    assert.equal(hourly.total, 7.9);
    assert.equal(hourly.hours[firstHour].earnings, 7.9);
    assert.ok(alerts.some((alert) => alert.alert_type === "hostname_collision"));
  } finally {
    store.db.close();
  }
});

test("fleet snapshots exclude machines offline for more than 24 hours", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-offline-");
  const store = createDatabase(dbPath);
  const now = new Date();
  const pollAt = now.toISOString();
  const oldOfflineAt = new Date(now.getTime() - (30 * 60 * 60 * 1000)).toISOString();

  try {
    store.recordPoll({
      timestamp: pollAt,
      machines: [
        makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 2, listed_gpu_cost: 1.2, earn_day: 20 })
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

    const fleet = store.getCurrentFleetStatus();
    const fleetHistory = store.getFleetHistory(24);

    assert.equal(fleet.machines.length, 2);
    assert.equal(fleetHistory.history.length, 1);
    assert.equal(fleetHistory.history[0].total_machines, 1);
    assert.equal(fleetHistory.history[0].unlisted_machines, 0);
    assert.equal(fleetHistory.history[0].unlisted_gpus, 0);
  } finally {
    store.db.close();
  }
});
