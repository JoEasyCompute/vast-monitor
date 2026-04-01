import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

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

test("database startup records applied schema migrations on fresh databases", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-migrations-fresh-");
  const store = createDatabase(dbPath);

  try {
    const migrations = store.db.prepare(`
      SELECT id, description
      FROM schema_migrations
      ORDER BY id ASC
    `).all();

    assert.deepEqual(migrations, [
      {
        id: "001_managed_schema_baseline",
        description: "Create baseline tables/indexes and backfill additive columns"
      },
      {
        id: "002_maintenance_runs",
        description: "Track operator maintenance executions"
      }
    ]);

    const dbHealth = store.getDatabaseHealth();
    assert.equal(dbHealth.row_counts.schema_migrations, 2);
    assert.equal(dbHealth.schema_migrations[0].id, "001_managed_schema_baseline");
    assert.equal(dbHealth.schema_migrations[1].id, "002_maintenance_runs");
  } finally {
    store.db.close();
  }
});

test("database startup upgrades legacy schema through managed migrations", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-migrations-legacy-");
  const legacyDb = new Database(dbPath);

  try {
    legacyDb.exec(`
      CREATE TABLE machine_registry (
        machine_id INTEGER PRIMARY KEY,
        hostname TEXT NOT NULL,
        gpu_type TEXT,
        num_gpus INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE machine_state (
        machine_id INTEGER PRIMARY KEY,
        hostname TEXT NOT NULL,
        gpu_type TEXT,
        num_gpus INTEGER,
        status TEXT NOT NULL,
        occupancy TEXT,
        occupied_gpus INTEGER,
        current_rentals_running INTEGER,
        listed_gpu_cost REAL,
        reliability REAL,
        gpu_max_cur_temp REAL,
        earn_day REAL,
        num_reports INTEGER NOT NULL DEFAULT 0,
        num_recent_reports REAL,
        prev_day_reports INTEGER NOT NULL DEFAULT 0,
        reports_changed INTEGER NOT NULL DEFAULT 0,
        idle_since TEXT,
        temp_alert_active INTEGER NOT NULL DEFAULT 0,
        idle_alert_active INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        polled_at TEXT NOT NULL
      );

      CREATE TABLE machine_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL,
        polled_at TEXT NOT NULL,
        machine_id INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        gpu_type TEXT,
        num_gpus INTEGER,
        occupancy TEXT,
        occupied_gpus INTEGER,
        current_rentals_running INTEGER,
        listed_gpu_cost REAL,
        reliability REAL,
        gpu_max_cur_temp REAL,
        earn_day REAL,
        num_reports INTEGER NOT NULL DEFAULT 0,
        num_recent_reports REAL,
        status TEXT NOT NULL
      );
    `);
  } finally {
    legacyDb.close();
  }

  const store = createDatabase(dbPath);

  try {
    const machineStateColumns = store.db.prepare("PRAGMA table_info(machine_state)").all().map((row) => row.name);
    const machineSnapshotColumns = store.db.prepare("PRAGMA table_info(machine_snapshots)").all().map((row) => row.name);
    const migrations = store.db.prepare("SELECT id FROM schema_migrations ORDER BY id ASC").all();

    assert.ok(machineStateColumns.includes("public_ipaddr"));
    assert.ok(machineStateColumns.includes("listed"));
    assert.ok(machineStateColumns.includes("is_datacenter"));
    assert.ok(machineSnapshotColumns.includes("listed"));
    assert.ok(machineSnapshotColumns.includes("last_seen_at"));
    assert.ok(machineSnapshotColumns.includes("is_datacenter"));
    assert.deepEqual(migrations, [
      { id: "001_managed_schema_baseline" },
      { id: "002_maintenance_runs" }
    ]);
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
      const fleetHourlyRollups = retainedStore.db.prepare(`
        SELECT bucket_start, sample_count, total_machines
        FROM fleet_snapshot_hourly_rollups
        ORDER BY bucket_start ASC
      `).all();
      const gpuUtilHourlyRollups = retainedStore.db.prepare(`
        SELECT bucket_start, gpu_type, listed_gpus, occupied_gpus
        FROM gpu_type_utilization_hourly_rollups
        ORDER BY bucket_start ASC, gpu_type ASC
      `).all();
      const gpuPriceHourlyRollups = retainedStore.db.prepare(`
        SELECT bucket_start, gpu_type, priced_gpus, total_price_weighted
        FROM gpu_type_price_hourly_rollups
        ORDER BY bucket_start ASC, gpu_type ASC
      `).all();
      const machineSnapshots = retainedStore.db.prepare("SELECT polled_at FROM machine_snapshots ORDER BY polled_at ASC").all();
      const hourlyRollups = retainedStore.db.prepare(`
        SELECT bucket_start, machine_id, sample_count
        FROM machine_snapshot_hourly_rollups
        ORDER BY bucket_start ASC
      `).all();
      const alerts = retainedStore.db.prepare("SELECT created_at FROM alerts ORDER BY created_at ASC").all();
      const events = retainedStore.db.prepare("SELECT created_at FROM events ORDER BY created_at ASC").all();
      const rolledUpHistory = retainedStore.getMachineHistory(1, 24 * 120);

      const rolledUpFleetHistory = retainedStore.getFleetHistory(24 * 120);
      const rolledUpPriceHistory = retainedStore.getGpuTypePriceHistory(24 * 120, 6);

      assert.deepEqual(polls.map((row) => row.polled_at), [recentTimestamp]);
      assert.deepEqual(fleetSnapshots.map((row) => row.polled_at), [recentTimestamp]);
      assert.deepEqual(fleetHourlyRollups, [{
        bucket_start: "2026-01-01T10:00:00.000Z",
        sample_count: 1,
        total_machines: 1
      }]);
      assert.deepEqual(gpuUtilHourlyRollups, [{
        bucket_start: "2026-01-01T10:00:00.000Z",
        gpu_type: "A100",
        listed_gpus: 4,
        occupied_gpus: 2
      }]);
      assert.deepEqual(gpuPriceHourlyRollups, [{
        bucket_start: "2026-01-01T10:00:00.000Z",
        gpu_type: "A100",
        priced_gpus: 4,
        total_price_weighted: 4.8
      }]);
      assert.deepEqual(machineSnapshots.map((row) => row.polled_at), [recentTimestamp]);
      assert.deepEqual(hourlyRollups, [{
        bucket_start: "2026-01-01T10:00:00.000Z",
        machine_id: 1,
        sample_count: 1
      }]);
      assert.deepEqual(alerts.map((row) => row.created_at), [recentTimestamp]);
      assert.deepEqual(events.map((row) => row.created_at), [recentTimestamp]);
      assert.equal(rolledUpHistory.length, 1);
      assert.equal(rolledUpHistory[0].polled_at, "2026-01-01T10:00:00.000Z");
      assert.equal(rolledUpHistory[0].sample_count, 1);
      assert.equal(rolledUpHistory[0].num_gpus, 4);
      assert.equal(rolledUpFleetHistory.history.length, 2);
      assert.equal(rolledUpFleetHistory.history[0].polled_at, "2026-01-01T10:00:00.000Z");
      assert.equal(rolledUpFleetHistory.history[0].sample_count, 1);
      assert.equal(rolledUpFleetHistory.history[1].polled_at, recentTimestamp);
      assert.ok(rolledUpFleetHistory.gpu_type_utilization.some((series) => (
        series.gpu_type === "A100"
          && series.points.some((point) => point.polled_at === "2026-01-01T10:00:00.000Z" && point.utilisation_pct === 50)
      )));
      assert.ok(rolledUpPriceHistory.series.some((series) => (
        series.gpu_type === "A100"
          && series.points.some((point) => point.bucket_start === "2026-01-01T00:00:00.000Z" && point.avg_price === 1.2)
      )));
      assert.equal(maintenance.retention.fleet_snapshot_hourly_rollups_upserted, 1);
      assert.equal(maintenance.retention.polls_deleted, 1);
      assert.equal(maintenance.retention.machine_snapshots_deleted, 1);
      assert.equal(maintenance.retention.machine_snapshot_hourly_rollups_upserted, 1);
      assert.equal(maintenance.retention.gpu_type_utilization_hourly_rollups_upserted, 1);
      assert.equal(maintenance.retention.gpu_type_price_hourly_rollups_upserted, 1);
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

test("database maintenance actions are recorded in maintenance_runs", () => {
  const dbPath = makeTempDbPath("vast-monitor-db-maintenance-runs-");
  const store = createDatabase(dbPath);

  try {
    const analyze = store.runAnalyze();
    const vacuum = store.runVacuum();
    const rebuild = store.runRebuildDerivedState();
    const dbHealth = store.getDatabaseHealth();

    assert.ok(Number.isFinite(analyze.duration_ms));
    assert.ok(Number.isFinite(vacuum.duration_ms));
    assert.ok(Number.isFinite(rebuild.duration_ms));
    assert.equal(dbHealth.row_counts.maintenance_runs, 3);
    assert.equal(dbHealth.maintenance.in_progress, null);
    assert.equal(dbHealth.maintenance.recent_runs[0].action, "rebuild_derived");
    assert.equal(dbHealth.maintenance.recent_runs[1].action, "vacuum");
    assert.equal(dbHealth.maintenance.recent_runs[2].action, "analyze");
    assert.equal(dbHealth.maintenance.recent_runs[0].status, "succeeded");
    assert.ok(dbHealth.metadata.analyze_last_run_at?.value);
    assert.ok(dbHealth.metadata.vacuum_last_run_at?.value);
    assert.ok(dbHealth.metadata.derived_rebuild_last_run_at?.value);
  } finally {
    store.db.close();
  }
});
