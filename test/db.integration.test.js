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

test("startup backfill restores only missing fleet snapshots instead of rebuilding all history", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-backfill-");
  const firstStore = createDatabase(dbPath);
  let firstStoreClosed = false;
  const firstPollAt = "2026-03-20T10:00:00.000Z";
  const secondPollAt = "2026-03-20T11:00:00.000Z";

  try {
    firstStore.recordPoll({
      timestamp: firstPollAt,
      machines: [
        makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 2, listed_gpu_cost: 1.2, earn_day: 20 })
      ],
      offlineMachines: [],
      events: [],
      alerts: []
    });

    firstStore.recordPoll({
      timestamp: secondPollAt,
      machines: [
        makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 1, listed_gpu_cost: 2.4, earn_day: 30 })
      ],
      offlineMachines: [],
      events: [],
      alerts: []
    });

    const originalSnapshots = firstStore.db.prepare(`
      SELECT id, poll_id, polled_at
      FROM fleet_snapshots
      ORDER BY poll_id ASC
    `).all();

    assert.equal(originalSnapshots.length, 2);

    firstStore.db.prepare("DELETE FROM fleet_snapshots WHERE poll_id = ?").run(originalSnapshots[1].poll_id);
    firstStore.db.close();
    firstStoreClosed = true;

    const reopenedStore = createDatabase(dbPath);
    try {
      const maintenance = reopenedStore.getStartupMaintenanceSummary();
      const restoredSnapshots = reopenedStore.db.prepare(`
        SELECT id, poll_id, polled_at
        FROM fleet_snapshots
        ORDER BY poll_id ASC
      `).all();

      assert.equal(restoredSnapshots.length, 2);
      assert.equal(restoredSnapshots[0].id, originalSnapshots[0].id);
      assert.equal(restoredSnapshots[0].poll_id, originalSnapshots[0].poll_id);
      assert.equal(restoredSnapshots[1].poll_id, originalSnapshots[1].poll_id);
      assert.equal(restoredSnapshots[1].polled_at, originalSnapshots[1].polled_at);
      assert.notEqual(restoredSnapshots[1].id, originalSnapshots[1].id);
      assert.equal(maintenance.fleet_snapshots.mode, "incremental_backfill");
      assert.equal(maintenance.fleet_snapshots.inserted_snapshots, 1);
    } finally {
      reopenedStore.db.close();
    }
  } finally {
    if (!firstStoreClosed) {
      firstStore.db.close();
    }
  }
});

test("database startup creates hot-path indexes for snapshots, alerts, polls, and fleet snapshots", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-indexes-");
  const store = createDatabase(dbPath);

  try {
    const pollIndexes = store.db.prepare("PRAGMA index_list('polls')").all().map((row) => row.name);
    const fleetIndexes = store.db.prepare("PRAGMA index_list('fleet_snapshots')").all().map((row) => row.name);
    const snapshotIndexes = store.db.prepare("PRAGMA index_list('machine_snapshots')").all().map((row) => row.name);
    const alertIndexes = store.db.prepare("PRAGMA index_list('alerts')").all().map((row) => row.name);

    assert.ok(pollIndexes.includes("idx_polls_time"));
    assert.ok(fleetIndexes.includes("idx_fleet_snapshots_time"));
    assert.ok(fleetIndexes.includes("idx_fleet_snapshots_poll_id"));
    assert.ok(snapshotIndexes.includes("idx_machine_snapshots_machine_time"));
    assert.ok(snapshotIndexes.includes("idx_machine_snapshots_time"));
    assert.ok(snapshotIndexes.includes("idx_machine_snapshots_poll_id"));
    assert.ok(alertIndexes.includes("idx_alerts_created_at"));
    assert.ok(alertIndexes.includes("idx_alerts_type_created_machine"));
  } finally {
    store.db.close();
  }
});

test("startup rebuilds all fleet snapshots when the stored derived-state version is stale", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-rebuild-version-");
  const firstStore = createDatabase(dbPath);
  let firstStoreClosed = false;

  try {
    firstStore.recordPoll({
      timestamp: "2026-03-20T10:00:00.000Z",
      machines: [
        makeMachine({ machine_id: 1, hostname: "alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 2, listed_gpu_cost: 1.2, earn_day: 20 })
      ],
      offlineMachines: [],
      events: [],
      alerts: []
    });

    firstStore.recordPoll({
      timestamp: "2026-03-20T11:00:00.000Z",
      machines: [
        makeMachine({ machine_id: 2, hostname: "beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 1, listed_gpu_cost: 2.4, earn_day: 30 })
      ],
      offlineMachines: [],
      events: [],
      alerts: []
    });

    const originalSnapshots = firstStore.db.prepare(`
      SELECT id, poll_id, total_machines
      FROM fleet_snapshots
      ORDER BY poll_id ASC
    `).all();
    assert.equal(originalSnapshots.length, 2);

    firstStore.db.prepare("UPDATE fleet_snapshots SET total_machines = 999 WHERE poll_id = ?").run(originalSnapshots[0].poll_id);
    firstStore.db.prepare(`
      INSERT INTO db_meta (key, value, updated_at)
      VALUES ('fleet_snapshot_state_version', 'stale-version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(new Date().toISOString());
    firstStore.db.close();
    firstStoreClosed = true;

    const reopenedStore = createDatabase(dbPath);
    try {
      const maintenance = reopenedStore.getStartupMaintenanceSummary();
      const rebuiltSnapshots = reopenedStore.db.prepare(`
        SELECT id, poll_id, total_machines
        FROM fleet_snapshots
        ORDER BY poll_id ASC
      `).all();
      const meta = reopenedStore.db.prepare("SELECT value FROM db_meta WHERE key = 'fleet_snapshot_state_version'").get();

      assert.equal(rebuiltSnapshots.length, 2);
      assert.equal(rebuiltSnapshots[0].total_machines, 1);
      assert.equal(rebuiltSnapshots[1].total_machines, 1);
      assert.notEqual(rebuiltSnapshots[0].id, originalSnapshots[0].id);
      assert.notEqual(rebuiltSnapshots[1].id, originalSnapshots[1].id);
      assert.equal(meta?.value, "1");
      assert.equal(maintenance.fleet_snapshots.mode, "full_rebuild");
      assert.equal(maintenance.fleet_snapshots.inserted_snapshots, 2);
    } finally {
      reopenedStore.db.close();
    }
  } finally {
    if (!firstStoreClosed) {
      firstStore.db.close();
    }
  }
});

test("startup retention prunes old snapshots, polls, alerts, and events when configured", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-retention-");
  const oldTimestamp = "2026-01-01T10:00:00.000Z";
  const recentTimestamp = "2026-03-20T10:00:00.000Z";

  const firstStore = createDatabase(dbPath);
  let firstStoreClosed = false;

  try {
    firstStore.recordPoll({
      timestamp: oldTimestamp,
      machines: [
        makeMachine({ machine_id: 1, hostname: "old-alpha", gpu_type: "A100", num_gpus: 4, occupied_gpus: 2, listed_gpu_cost: 1.2, earn_day: 20 })
      ],
      offlineMachines: [],
      events: [{
        created_at: oldTimestamp,
        machine_id: 1,
        hostname: "old-alpha",
        event_type: "host_up",
        severity: "info",
        message: "old-alpha came online",
        payload_json: "{}"
      }],
      alerts: [{
        created_at: oldTimestamp,
        machine_id: 1,
        hostname: "old-alpha",
        alert_type: "high_temp",
        severity: "warning",
        message: "old-alpha is hot",
        payload_json: "{}"
      }]
    });

    firstStore.recordPoll({
      timestamp: recentTimestamp,
      machines: [
        makeMachine({ machine_id: 2, hostname: "new-beta", gpu_type: "H100", num_gpus: 2, occupied_gpus: 1, listed_gpu_cost: 2.4, earn_day: 30 })
      ],
      offlineMachines: [],
      events: [{
        created_at: recentTimestamp,
        machine_id: 2,
        hostname: "new-beta",
        event_type: "host_up",
        severity: "info",
        message: "new-beta came online",
        payload_json: "{}"
      }],
      alerts: [{
        created_at: recentTimestamp,
        machine_id: 2,
        hostname: "new-beta",
        alert_type: "high_temp",
        severity: "warning",
        message: "new-beta is hot",
        payload_json: "{}"
      }]
    });

    const realDateNow = Date.now;
    Date.now = () => Date.parse("2026-03-21T10:00:00.000Z");
    firstStore.db.close();
    firstStoreClosed = true;

    const retainedStore = createDatabase(dbPath, {
      dbSnapshotRetentionDays: 30,
      dbAlertRetentionDays: 30,
      dbEventRetentionDays: 30
    });

    try {
      const maintenance = retainedStore.getStartupMaintenanceSummary();
      const polls = retainedStore.db.prepare("SELECT polled_at FROM polls ORDER BY polled_at ASC").all();
      const fleetSnapshots = retainedStore.db.prepare("SELECT polled_at FROM fleet_snapshots ORDER BY polled_at ASC").all();
      const machineSnapshots = retainedStore.db.prepare("SELECT polled_at FROM machine_snapshots ORDER BY polled_at ASC").all();
      const alerts = retainedStore.db.prepare("SELECT created_at FROM alerts ORDER BY created_at ASC").all();
      const events = retainedStore.db.prepare("SELECT created_at FROM events ORDER BY created_at ASC").all();

      assert.deepEqual(polls.map((row) => row.polled_at), [recentTimestamp]);
      assert.deepEqual(fleetSnapshots.map((row) => row.polled_at), [recentTimestamp]);
      assert.deepEqual(machineSnapshots.map((row) => row.polled_at), [recentTimestamp]);
      assert.deepEqual(alerts.map((row) => row.created_at), [recentTimestamp]);
      assert.deepEqual(events.map((row) => row.created_at), [recentTimestamp]);
      assert.equal(maintenance.retention.polls_deleted, 1);
      assert.equal(maintenance.retention.machine_snapshots_deleted, 1);
      assert.equal(maintenance.retention.fleet_snapshots_deleted, 1);
      assert.equal(maintenance.retention.alerts_deleted, 1);
      assert.equal(maintenance.retention.events_deleted, 1);
    } finally {
      retainedStore.db.close();
      Date.now = realDateNow;
    }
  } finally {
    if (!firstStoreClosed) {
      firstStore.db.close();
    }
  }
});
