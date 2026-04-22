import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { buildFleetAggregate, isFleetEligibleMachine } from "./fleet-metrics.js";
import { canonicalizeGpuType } from "./platform-metrics.js";
import {
  buildMarketGpuTypeUtilizationHistory,
  buildMarketWeightedUtilizationHistory,
  buildPlatformGpuMetricHourlyRollups
} from "./platform-metrics-history.js";

const UPTIME_WINDOWS = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30
};

const FLEET_SNAPSHOT_STATE_VERSION = "1";
const MAINTENANCE_LOCK_NAME = "global";
const MAINTENANCE_LOCK_TTL_MS = 6 * 60 * 60 * 1000;
const SCHEMA_MIGRATIONS = [
  {
    id: "001_managed_schema_baseline",
    description: "Create baseline tables/indexes and backfill additive columns",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS machine_registry (
          machine_id INTEGER PRIMARY KEY,
          hostname TEXT NOT NULL,
          gpu_type TEXT,
          num_gpus INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS machine_state (
          machine_id INTEGER PRIMARY KEY,
          hostname TEXT NOT NULL,
          gpu_type TEXT,
          num_gpus INTEGER,
          status TEXT NOT NULL,
          occupancy TEXT,
          occupied_gpus INTEGER,
          current_rentals_running INTEGER,
          listed INTEGER NOT NULL DEFAULT 1,
          listed_gpu_cost REAL,
          reliability REAL,
          gpu_max_cur_temp REAL,
          earn_day REAL,
          num_reports INTEGER NOT NULL DEFAULT 0,
          num_recent_reports REAL,
          prev_day_reports INTEGER NOT NULL DEFAULT 0,
          reports_changed INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          machine_maintenance TEXT,
          last_seen_at TEXT,
          last_online_at TEXT,
          idle_since TEXT,
          host_id INTEGER,
          hosting_type INTEGER,
          is_datacenter INTEGER NOT NULL DEFAULT 0,
          datacenter_id INTEGER,
          verified INTEGER,
          verification TEXT,
          temp_alert_active INTEGER NOT NULL DEFAULT 0,
          idle_alert_active INTEGER NOT NULL DEFAULT 0,
          public_ipaddr TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS polls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          polled_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS db_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fleet_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL,
          polled_at TEXT NOT NULL,
          total_machines INTEGER NOT NULL,
          datacenter_machines INTEGER NOT NULL,
          unlisted_machines INTEGER NOT NULL,
          listed_gpus INTEGER NOT NULL,
          unlisted_gpus INTEGER NOT NULL,
          occupied_gpus INTEGER NOT NULL,
          utilisation_pct REAL NOT NULL,
          total_daily_earnings REAL NOT NULL,
          FOREIGN KEY (poll_id) REFERENCES polls(id)
        );

        CREATE INDEX IF NOT EXISTS idx_fleet_snapshots_time
          ON fleet_snapshots(polled_at);

        CREATE TABLE IF NOT EXISTS fleet_snapshot_hourly_rollups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bucket_start TEXT NOT NULL UNIQUE,
          sample_count INTEGER NOT NULL,
          total_machines REAL NOT NULL,
          datacenter_machines REAL NOT NULL,
          unlisted_machines REAL NOT NULL,
          listed_gpus REAL NOT NULL,
          unlisted_gpus REAL NOT NULL,
          occupied_gpus REAL NOT NULL,
          utilisation_pct REAL NOT NULL,
          total_daily_earnings REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_fleet_snapshot_hourly_rollups_time
          ON fleet_snapshot_hourly_rollups(bucket_start);

        CREATE INDEX IF NOT EXISTS idx_polls_time
          ON polls(polled_at DESC);

        CREATE TABLE IF NOT EXISTS machine_snapshots (
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
          listed INTEGER NOT NULL DEFAULT 1,
          listed_gpu_cost REAL,
          reliability REAL,
          gpu_max_cur_temp REAL,
          earn_day REAL,
          num_reports INTEGER NOT NULL DEFAULT 0,
          num_recent_reports REAL,
          error_message TEXT,
          machine_maintenance TEXT,
          last_seen_at TEXT,
          last_online_at TEXT,
          host_id INTEGER,
          hosting_type INTEGER,
          is_datacenter INTEGER NOT NULL DEFAULT 0,
          datacenter_id INTEGER,
          verified INTEGER,
          verification TEXT,
          status TEXT NOT NULL,
          FOREIGN KEY (poll_id) REFERENCES polls(id)
        );

        CREATE INDEX IF NOT EXISTS idx_machine_snapshots_machine_time
          ON machine_snapshots(machine_id, polled_at);

        CREATE INDEX IF NOT EXISTS idx_machine_snapshots_time
          ON machine_snapshots(polled_at);

        CREATE INDEX IF NOT EXISTS idx_machine_snapshots_poll_id
          ON machine_snapshots(poll_id);

        CREATE TABLE IF NOT EXISTS machine_snapshot_hourly_rollups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bucket_start TEXT NOT NULL,
          machine_id INTEGER NOT NULL,
          sample_count INTEGER NOT NULL,
          hostname TEXT NOT NULL,
          status TEXT NOT NULL,
          occupancy TEXT,
          num_gpus INTEGER,
          occupied_gpus REAL,
          current_rentals_running REAL,
          reliability REAL,
          gpu_max_cur_temp REAL,
          listed_gpu_cost REAL,
          earn_day REAL,
          UNIQUE(machine_id, bucket_start)
        );

        CREATE INDEX IF NOT EXISTS idx_machine_snapshot_hourly_rollups_machine_time
          ON machine_snapshot_hourly_rollups(machine_id, bucket_start);

        CREATE TABLE IF NOT EXISTS gpu_type_utilization_hourly_rollups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bucket_start TEXT NOT NULL,
          gpu_type TEXT NOT NULL,
          listed_gpus REAL NOT NULL,
          occupied_gpus REAL NOT NULL,
          UNIQUE(bucket_start, gpu_type)
        );

        CREATE INDEX IF NOT EXISTS idx_gpu_type_utilization_hourly_rollups_time
          ON gpu_type_utilization_hourly_rollups(bucket_start, gpu_type);

        CREATE TABLE IF NOT EXISTS gpu_type_price_hourly_rollups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bucket_start TEXT NOT NULL,
          gpu_type TEXT NOT NULL,
          priced_gpus REAL NOT NULL,
          total_price_weighted REAL NOT NULL,
          UNIQUE(bucket_start, gpu_type)
        );

        CREATE INDEX IF NOT EXISTS idx_gpu_type_price_hourly_rollups_time
          ON gpu_type_price_hourly_rollups(bucket_start, gpu_type);

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          machine_id INTEGER,
          hostname TEXT,
          event_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          message TEXT NOT NULL,
          payload_json TEXT
        );

        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          machine_id INTEGER,
          hostname TEXT,
          alert_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          message TEXT NOT NULL,
          payload_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_alerts_created_at
          ON alerts(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_alerts_type_created_machine
          ON alerts(alert_type, created_at, machine_id);
      `);

      const dedupedFleetSnapshotRows = db.prepare(`
        DELETE FROM fleet_snapshots
        WHERE id NOT IN (
          SELECT MIN(id)
          FROM fleet_snapshots
          GROUP BY poll_id
        );
      `).run().changes;

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_snapshots_poll_id
          ON fleet_snapshots(poll_id);
      `);

      ensureColumns(db, "machine_state", [
        ["last_seen_at", "TEXT"],
        ["last_online_at", "TEXT"],
        ["idle_since", "TEXT"],
        ["public_ipaddr", "TEXT"],
        ["listed", "INTEGER NOT NULL DEFAULT 1"],
        ["host_id", "INTEGER"],
        ["error_message", "TEXT"],
        ["machine_maintenance", "TEXT"],
        ["hosting_type", "INTEGER"],
        ["is_datacenter", "INTEGER NOT NULL DEFAULT 0"],
        ["datacenter_id", "INTEGER"],
        ["verified", "INTEGER"],
        ["verification", "TEXT"],
        ["temp_alert_active", "INTEGER NOT NULL DEFAULT 0"],
        ["idle_alert_active", "INTEGER NOT NULL DEFAULT 0"]
      ]);

      ensureColumns(db, "machine_snapshots", [
        ["host_id", "INTEGER"],
        ["listed", "INTEGER NOT NULL DEFAULT 1"],
        ["error_message", "TEXT"],
        ["machine_maintenance", "TEXT"],
        ["last_seen_at", "TEXT"],
        ["last_online_at", "TEXT"],
        ["hosting_type", "INTEGER"],
        ["is_datacenter", "INTEGER NOT NULL DEFAULT 0"],
        ["datacenter_id", "INTEGER"],
        ["verified", "INTEGER"],
        ["verification", "TEXT"]
      ]);

      return {
        deduped_fleet_snapshot_rows: dedupedFleetSnapshotRows
      };
    }
  },
  {
    id: "002_maintenance_runs",
    description: "Track operator maintenance executions",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          duration_ms INTEGER,
          result_json TEXT,
          error_text TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_maintenance_runs_started_at
          ON maintenance_runs(started_at DESC);
      `);

      return {};
    }
  },
  {
    id: "003_maintenance_locks",
    description: "Prevent overlapping maintenance actions across processes",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_locks (
          name TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          action TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);

      return {};
    }
  },
  {
    id: "004_platform_gpu_metric_snapshots",
    description: "Persist external platform GPU benchmark snapshots",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS platform_gpu_metric_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL,
          polled_at TEXT NOT NULL,
          source_fetched_at TEXT,
          gpu_type TEXT NOT NULL,
          canonical_gpu_type TEXT NOT NULL,
          market_utilisation_pct REAL,
          market_gpus_on_platform REAL,
          market_gpus_available REAL,
          market_gpus_rented REAL,
          market_machines_available REAL,
          market_median_price REAL,
          market_minimum_price REAL,
          market_p10_price REAL,
          market_p90_price REAL,
          UNIQUE(poll_id, canonical_gpu_type),
          FOREIGN KEY (poll_id) REFERENCES polls(id)
        );

        CREATE INDEX IF NOT EXISTS idx_platform_gpu_metric_snapshots_time
          ON platform_gpu_metric_snapshots(polled_at);

        CREATE INDEX IF NOT EXISTS idx_platform_gpu_metric_snapshots_gpu_time
          ON platform_gpu_metric_snapshots(canonical_gpu_type, polled_at);
      `);

      return {};
    }
  },
  {
    id: "005_platform_gpu_metric_hourly_rollups",
    description: "Compact persisted platform GPU benchmark snapshots into hourly rollups",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS platform_gpu_metric_hourly_rollups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bucket_start TEXT NOT NULL,
          gpu_type TEXT NOT NULL,
          canonical_gpu_type TEXT NOT NULL,
          sample_count INTEGER NOT NULL,
          market_utilisation_pct REAL,
          market_gpus_on_platform REAL,
          market_gpus_available REAL,
          market_gpus_rented REAL,
          market_machines_available REAL,
          market_median_price REAL,
          market_minimum_price REAL,
          market_p10_price REAL,
          market_p90_price REAL,
          UNIQUE(bucket_start, canonical_gpu_type)
        );

        CREATE INDEX IF NOT EXISTS idx_platform_gpu_metric_hourly_rollups_time
          ON platform_gpu_metric_hourly_rollups(bucket_start, canonical_gpu_type);
      `);

      return {};
    }
  },
  {
    id: "006_machine_verification_metadata",
    description: "Persist machine verification metadata",
    up(db) {
      ensureColumns(db, "machine_state", [
        ["verified", "INTEGER"],
        ["verification", "TEXT"]
      ]);

      ensureColumns(db, "machine_snapshots", [
        ["verified", "INTEGER"],
        ["verification", "TEXT"]
      ]);

      return {};
    }
  }
];

export function createDatabase(dbPath, options = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const migrationSummary = applySchemaMigrations(db);

  const statements = {
    insertPoll: db.prepare(`
      INSERT INTO polls (polled_at) VALUES (?)
    `),
    upsertMeta: db.prepare(`
      INSERT INTO db_meta (key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `),
    selectMeta: db.prepare(`
      SELECT value, updated_at
      FROM db_meta
      WHERE key = ?
    `),
    selectAllMeta: db.prepare(`
      SELECT key, value, updated_at
      FROM db_meta
      ORDER BY key ASC
    `),
    insertMaintenanceLock: db.prepare(`
      INSERT INTO maintenance_locks (name, owner_id, action, acquired_at, expires_at)
      VALUES (@name, @owner_id, @action, @acquired_at, @expires_at)
    `),
    selectMaintenanceLock: db.prepare(`
      SELECT name, owner_id, action, acquired_at, expires_at
      FROM maintenance_locks
      WHERE name = ?
    `),
    deleteMaintenanceLockByName: db.prepare(`
      DELETE FROM maintenance_locks
      WHERE name = ?
    `),
    deleteMaintenanceLockByOwner: db.prepare(`
      DELETE FROM maintenance_locks
      WHERE name = @name AND owner_id = @owner_id
    `),
    insertMaintenanceRun: db.prepare(`
      INSERT INTO maintenance_runs (action, status, started_at)
      VALUES (@action, @status, @started_at)
    `),
    completeMaintenanceRun: db.prepare(`
      UPDATE maintenance_runs
      SET status = @status,
          completed_at = @completed_at,
          duration_ms = @duration_ms,
          result_json = @result_json,
          error_text = @error_text
      WHERE id = @id
    `),
    selectRecentMaintenanceRuns: db.prepare(`
      SELECT id, action, status, started_at, completed_at, duration_ms, result_json, error_text
      FROM maintenance_runs
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `),
    selectSchemaMigrations: db.prepare(`
      SELECT id, description, applied_at
      FROM schema_migrations
      ORDER BY id ASC
    `),
    insertFleetSnapshot: db.prepare(`
      INSERT INTO fleet_snapshots (
        poll_id, polled_at, total_machines, datacenter_machines, unlisted_machines,
        listed_gpus, unlisted_gpus, occupied_gpus, utilisation_pct, total_daily_earnings
      ) VALUES (
        @poll_id, @polled_at, @total_machines, @datacenter_machines, @unlisted_machines,
        @listed_gpus, @unlisted_gpus, @occupied_gpus, @utilisation_pct, @total_daily_earnings
      )
    `),
    upsertFleetSnapshotHourlyRollup: db.prepare(`
      INSERT INTO fleet_snapshot_hourly_rollups (
        bucket_start, sample_count, total_machines, datacenter_machines, unlisted_machines,
        listed_gpus, unlisted_gpus, occupied_gpus, utilisation_pct, total_daily_earnings
      ) VALUES (
        @bucket_start, @sample_count, @total_machines, @datacenter_machines, @unlisted_machines,
        @listed_gpus, @unlisted_gpus, @occupied_gpus, @utilisation_pct, @total_daily_earnings
      )
      ON CONFLICT(bucket_start) DO UPDATE SET
        sample_count = excluded.sample_count,
        total_machines = excluded.total_machines,
        datacenter_machines = excluded.datacenter_machines,
        unlisted_machines = excluded.unlisted_machines,
        listed_gpus = excluded.listed_gpus,
        unlisted_gpus = excluded.unlisted_gpus,
        occupied_gpus = excluded.occupied_gpus,
        utilisation_pct = excluded.utilisation_pct,
        total_daily_earnings = excluded.total_daily_earnings
    `),
    upsertRegistry: db.prepare(`
      INSERT INTO machine_registry (machine_id, hostname, gpu_type, num_gpus, created_at, updated_at)
      VALUES (@machine_id, @hostname, @gpu_type, @num_gpus, @timestamp, @timestamp)
      ON CONFLICT(machine_id) DO UPDATE SET
        hostname = excluded.hostname,
        gpu_type = excluded.gpu_type,
        num_gpus = excluded.num_gpus,
        updated_at = excluded.updated_at
    `),
    upsertState: db.prepare(`
      INSERT INTO machine_state (
        machine_id, hostname, gpu_type, num_gpus, status, occupancy, occupied_gpus,
        current_rentals_running, listed, listed_gpu_cost, reliability, gpu_max_cur_temp, earn_day,
        num_reports, num_recent_reports, prev_day_reports, reports_changed, error_message, machine_maintenance,
        last_seen_at, last_online_at, idle_since, host_id, hosting_type, is_datacenter, datacenter_id, verified, verification,
        temp_alert_active, idle_alert_active, updated_at, public_ipaddr
      ) VALUES (
        @machine_id, @hostname, @gpu_type, @num_gpus, @status, @occupancy, @occupied_gpus,
        @current_rentals_running, @listed, @listed_gpu_cost, @reliability, @gpu_max_cur_temp, @earn_day,
        @num_reports, @num_recent_reports, @prev_day_reports, @reports_changed, @error_message, @machine_maintenance,
        @last_seen_at, @last_online_at, @idle_since, @host_id, @hosting_type, @is_datacenter, @datacenter_id, @verified, @verification,
        @temp_alert_active, @idle_alert_active, @updated_at, @public_ipaddr
      )
      ON CONFLICT(machine_id) DO UPDATE SET
        hostname = excluded.hostname,
        gpu_type = excluded.gpu_type,
        num_gpus = excluded.num_gpus,
        status = excluded.status,
        occupancy = excluded.occupancy,
        occupied_gpus = excluded.occupied_gpus,
        current_rentals_running = excluded.current_rentals_running,
        listed = excluded.listed,
        listed_gpu_cost = excluded.listed_gpu_cost,
        reliability = excluded.reliability,
        gpu_max_cur_temp = excluded.gpu_max_cur_temp,
        earn_day = excluded.earn_day,
        num_reports = excluded.num_reports,
        num_recent_reports = excluded.num_recent_reports,
        prev_day_reports = excluded.prev_day_reports,
        reports_changed = excluded.reports_changed,
        error_message = excluded.error_message,
        machine_maintenance = excluded.machine_maintenance,
        last_seen_at = excluded.last_seen_at,
        last_online_at = excluded.last_online_at,
        idle_since = excluded.idle_since,
        host_id = excluded.host_id,
        hosting_type = excluded.hosting_type,
        is_datacenter = excluded.is_datacenter,
        datacenter_id = excluded.datacenter_id,
        verified = excluded.verified,
        verification = excluded.verification,
        temp_alert_active = excluded.temp_alert_active,
        idle_alert_active = excluded.idle_alert_active,
        updated_at = excluded.updated_at,
        public_ipaddr = excluded.public_ipaddr
    `),
    insertSnapshot: db.prepare(`
      INSERT INTO machine_snapshots (
        poll_id, polled_at, machine_id, hostname, gpu_type, num_gpus, occupancy,
        occupied_gpus, current_rentals_running, listed, listed_gpu_cost, reliability,
        gpu_max_cur_temp, earn_day, num_reports, num_recent_reports, error_message, machine_maintenance, last_seen_at, last_online_at, host_id, hosting_type,
        is_datacenter, datacenter_id, verified, verification, status
      ) VALUES (
        @poll_id, @polled_at, @machine_id, @hostname, @gpu_type, @num_gpus, @occupancy,
        @occupied_gpus, @current_rentals_running, @listed, @listed_gpu_cost, @reliability,
        @gpu_max_cur_temp, @earn_day, @num_reports, @num_recent_reports, @error_message, @machine_maintenance, @last_seen_at, @last_online_at, @host_id, @hosting_type,
        @is_datacenter, @datacenter_id, @verified, @verification, @status
      )
    `),
    insertEvent: db.prepare(`
      INSERT INTO events (created_at, machine_id, hostname, event_type, severity, message, payload_json)
      VALUES (@created_at, @machine_id, @hostname, @event_type, @severity, @message, @payload_json)
    `),
    insertAlert: db.prepare(`
      INSERT INTO alerts (created_at, machine_id, hostname, alert_type, severity, message, payload_json)
      VALUES (@created_at, @machine_id, @hostname, @alert_type, @severity, @message, @payload_json)
    `),
    selectStateRows: db.prepare(`
      SELECT * FROM machine_state ORDER BY hostname COLLATE NOCASE
    `),
    selectStateById: db.prepare(`
      SELECT * FROM machine_state WHERE machine_id = ?
    `),
    selectKnownMachines: db.prepare(`
      SELECT machine_id, hostname, gpu_type, num_gpus FROM machine_registry
    `),
    selectSnapshotsSince: db.prepare(`
      SELECT polled_at, status, occupancy, num_gpus, occupied_gpus, current_rentals_running, reliability, gpu_max_cur_temp, listed_gpu_cost, earn_day
      FROM machine_snapshots
      WHERE machine_id = ? AND polled_at >= ?
      ORDER BY polled_at ASC
    `),
    selectHourlyRollupsSince: db.prepare(`
      SELECT
        bucket_start AS polled_at,
        status,
        occupancy,
        num_gpus,
        occupied_gpus,
        current_rentals_running,
        reliability,
        gpu_max_cur_temp,
        listed_gpu_cost,
        earn_day,
        sample_count
      FROM machine_snapshot_hourly_rollups
      WHERE machine_id = ? AND bucket_start >= ?
      ORDER BY bucket_start ASC
    `),
    selectLatestPollTime: db.prepare(`
      SELECT polled_at FROM polls ORDER BY polled_at DESC LIMIT 1
    `),
    selectRecentAlerts: db.prepare(`
      SELECT created_at, machine_id, hostname, alert_type, severity, message, payload_json
      FROM alerts
      ORDER BY created_at DESC
      LIMIT ?
    `),
    selectMachineIdsWithNewReportsSince: db.prepare(`
      SELECT DISTINCT machine_id
      FROM alerts
      WHERE alert_type = 'new_reports'
        AND machine_id IS NOT NULL
        AND created_at >= ?
    `),
    selectSnapshotsForDate: db.prepare(`
      SELECT polled_at, machine_id, occupied_gpus, listed_gpu_cost
      FROM machine_snapshots
      WHERE polled_at >= ? AND polled_at < ?
      ORDER BY polled_at ASC
    `),
    selectMissingFleetSnapshotPolls: db.prepare(`
      SELECT machine_snapshots.poll_id, MIN(machine_snapshots.polled_at) AS polled_at
      FROM machine_snapshots
      LEFT JOIN fleet_snapshots
        ON fleet_snapshots.poll_id = machine_snapshots.poll_id
      WHERE fleet_snapshots.poll_id IS NULL
      GROUP BY machine_snapshots.poll_id
      ORDER BY machine_snapshots.poll_id ASC
    `),
    selectAllFleetSnapshotSourcePolls: db.prepare(`
      SELECT machine_snapshots.poll_id, MIN(machine_snapshots.polled_at) AS polled_at
      FROM machine_snapshots
      GROUP BY machine_snapshots.poll_id
      ORDER BY machine_snapshots.poll_id ASC
    `),
    selectFleetSnapshotsSince: db.prepare(`
      SELECT polled_at, total_machines, datacenter_machines, unlisted_machines,
             listed_gpus, unlisted_gpus, occupied_gpus, utilisation_pct, total_daily_earnings
      FROM fleet_snapshots
      WHERE polled_at >= ?
      ORDER BY polled_at ASC
    `),
    selectFleetSnapshotHourlyRollupsSince: db.prepare(`
      SELECT
        bucket_start AS polled_at,
        total_machines,
        datacenter_machines,
        unlisted_machines,
        listed_gpus,
        unlisted_gpus,
        occupied_gpus,
        utilisation_pct,
        total_daily_earnings,
        sample_count
      FROM fleet_snapshot_hourly_rollups
      WHERE bucket_start >= ?
      ORDER BY bucket_start ASC
    `),
    selectGpuTypeUtilizationHourlyRollupsSince: db.prepare(`
      SELECT
        bucket_start AS polled_at,
        gpu_type,
        listed_gpus,
        occupied_gpus
      FROM gpu_type_utilization_hourly_rollups
      WHERE bucket_start >= ?
      ORDER BY bucket_start ASC
    `),
    selectGpuTypeUtilizationSnapshotsSince: db.prepare(`
      SELECT polled_at, gpu_type, num_gpus, occupied_gpus, listed, status, last_seen_at, last_online_at
      FROM machine_snapshots
      WHERE polled_at >= ?
        AND num_gpus IS NOT NULL
        AND num_gpus > 0
      ORDER BY polled_at ASC
    `),
    selectPlatformGpuMetricSnapshotsSince: db.prepare(`
      SELECT
        polled_at,
        source_fetched_at,
        gpu_type,
        canonical_gpu_type,
        market_utilisation_pct,
        market_gpus_on_platform,
        market_gpus_available,
        market_gpus_rented,
        market_machines_available,
        market_median_price,
        market_minimum_price,
        market_p10_price,
        market_p90_price
      FROM platform_gpu_metric_snapshots
      WHERE polled_at >= ?
      ORDER BY polled_at ASC, canonical_gpu_type ASC
    `),
    selectPlatformGpuMetricHourlyRollupsSince: db.prepare(`
      SELECT
        bucket_start AS polled_at,
        gpu_type,
        canonical_gpu_type,
        sample_count,
        market_utilisation_pct,
        market_gpus_on_platform,
        market_gpus_available,
        market_gpus_rented,
        market_machines_available,
        market_median_price,
        market_minimum_price,
        market_p10_price,
        market_p90_price
      FROM platform_gpu_metric_hourly_rollups
      WHERE bucket_start >= ?
      ORDER BY bucket_start ASC, canonical_gpu_type ASC
    `),
    selectFleetSnapshotAtOrBefore: db.prepare(`
      SELECT poll_id, polled_at, total_machines, datacenter_machines, unlisted_machines,
             listed_gpus, unlisted_gpus, occupied_gpus, utilisation_pct, total_daily_earnings
      FROM fleet_snapshots
      WHERE polled_at <= ?
      ORDER BY polled_at DESC
      LIMIT 1
    `),
    selectGpuTypePriceSnapshotsSince: db.prepare(`
      SELECT polled_at, gpu_type, num_gpus, listed_gpu_cost
      FROM machine_snapshots
      WHERE polled_at >= ?
        AND listed = 1
        AND listed_gpu_cost IS NOT NULL
        AND num_gpus IS NOT NULL
        AND num_gpus > 0
      ORDER BY polled_at ASC
    `),
    selectGpuTypePriceHourlyRollupsSince: db.prepare(`
      SELECT
        bucket_start,
        gpu_type,
        priced_gpus,
        total_price_weighted
      FROM gpu_type_price_hourly_rollups
      WHERE bucket_start >= ?
      ORDER BY bucket_start ASC
    `),
    selectMachineSnapshotsByPollId: db.prepare(`
      SELECT listed, num_gpus, listed_gpu_cost
      FROM machine_snapshots
      WHERE poll_id = ?
    `),
    selectFleetSnapshotBackfillMachinesByPollId: db.prepare(`
      SELECT machine_id, hostname, num_gpus, status, occupied_gpus,
             listed, earn_day, is_datacenter, last_seen_at, last_online_at
      FROM machine_snapshots
      WHERE poll_id = ?
      ORDER BY machine_id ASC
    `),
    selectFleetSnapshotsBefore: db.prepare(`
      SELECT polled_at, total_machines, datacenter_machines, unlisted_machines,
             listed_gpus, unlisted_gpus, occupied_gpus, utilisation_pct, total_daily_earnings
      FROM fleet_snapshots
      WHERE polled_at < ?
      ORDER BY polled_at ASC
    `),
    selectPlatformGpuMetricSnapshotsBefore: db.prepare(`
      SELECT
        polled_at,
        source_fetched_at,
        gpu_type,
        canonical_gpu_type,
        market_utilisation_pct,
        market_gpus_on_platform,
        market_gpus_available,
        market_gpus_rented,
        market_machines_available,
        market_median_price,
        market_minimum_price,
        market_p10_price,
        market_p90_price
      FROM platform_gpu_metric_snapshots
      WHERE polled_at < ?
      ORDER BY polled_at ASC, canonical_gpu_type ASC
    `),
    selectAllPlatformGpuMetricSnapshotsForRollups: db.prepare(`
      SELECT
        polled_at,
        source_fetched_at,
        gpu_type,
        canonical_gpu_type,
        market_utilisation_pct,
        market_gpus_on_platform,
        market_gpus_available,
        market_gpus_rented,
        market_machines_available,
        market_median_price,
        market_minimum_price,
        market_p10_price,
        market_p90_price
      FROM platform_gpu_metric_snapshots
      ORDER BY polled_at ASC, canonical_gpu_type ASC
    `),
    selectMachineSnapshotsBefore: db.prepare(`
      SELECT polled_at, machine_id, hostname, gpu_type, status, occupancy, num_gpus, occupied_gpus,
             current_rentals_running, reliability, gpu_max_cur_temp, listed_gpu_cost, earn_day,
             listed, last_seen_at, last_online_at
      FROM machine_snapshots
      WHERE polled_at < ?
      ORDER BY machine_id ASC, polled_at ASC
    `),
    selectAllMachineSnapshotsForRollups: db.prepare(`
      SELECT polled_at, machine_id, hostname, gpu_type, status, occupancy, num_gpus, occupied_gpus,
             current_rentals_running, reliability, gpu_max_cur_temp, listed_gpu_cost, earn_day,
             listed, last_seen_at, last_online_at
      FROM machine_snapshots
      ORDER BY machine_id ASC, polled_at ASC
    `),
    selectAllFleetSnapshotsForRollups: db.prepare(`
      SELECT polled_at, total_machines, datacenter_machines, unlisted_machines,
             listed_gpus, unlisted_gpus, occupied_gpus, utilisation_pct, total_daily_earnings
      FROM fleet_snapshots
      ORDER BY polled_at ASC
    `),
    upsertMachineSnapshotHourlyRollup: db.prepare(`
      INSERT INTO machine_snapshot_hourly_rollups (
        bucket_start, machine_id, sample_count, hostname, status, occupancy, num_gpus,
        occupied_gpus, current_rentals_running, reliability, gpu_max_cur_temp,
        listed_gpu_cost, earn_day
      ) VALUES (
        @bucket_start, @machine_id, @sample_count, @hostname, @status, @occupancy, @num_gpus,
        @occupied_gpus, @current_rentals_running, @reliability, @gpu_max_cur_temp,
        @listed_gpu_cost, @earn_day
      )
      ON CONFLICT(machine_id, bucket_start) DO UPDATE SET
        sample_count = excluded.sample_count,
        hostname = excluded.hostname,
        status = excluded.status,
        occupancy = excluded.occupancy,
        num_gpus = excluded.num_gpus,
        occupied_gpus = excluded.occupied_gpus,
        current_rentals_running = excluded.current_rentals_running,
        reliability = excluded.reliability,
        gpu_max_cur_temp = excluded.gpu_max_cur_temp,
        listed_gpu_cost = excluded.listed_gpu_cost,
        earn_day = excluded.earn_day
    `),
    upsertGpuTypeUtilizationHourlyRollup: db.prepare(`
      INSERT INTO gpu_type_utilization_hourly_rollups (
        bucket_start, gpu_type, listed_gpus, occupied_gpus
      ) VALUES (
        @bucket_start, @gpu_type, @listed_gpus, @occupied_gpus
      )
      ON CONFLICT(bucket_start, gpu_type) DO UPDATE SET
        listed_gpus = excluded.listed_gpus,
        occupied_gpus = excluded.occupied_gpus
    `),
    upsertGpuTypePriceHourlyRollup: db.prepare(`
      INSERT INTO gpu_type_price_hourly_rollups (
        bucket_start, gpu_type, priced_gpus, total_price_weighted
      ) VALUES (
        @bucket_start, @gpu_type, @priced_gpus, @total_price_weighted
      )
      ON CONFLICT(bucket_start, gpu_type) DO UPDATE SET
        priced_gpus = excluded.priced_gpus,
        total_price_weighted = excluded.total_price_weighted
    `),
    insertPlatformGpuMetricSnapshot: db.prepare(`
      INSERT INTO platform_gpu_metric_snapshots (
        poll_id,
        polled_at,
        source_fetched_at,
        gpu_type,
        canonical_gpu_type,
        market_utilisation_pct,
        market_gpus_on_platform,
        market_gpus_available,
        market_gpus_rented,
        market_machines_available,
        market_median_price,
        market_minimum_price,
        market_p10_price,
        market_p90_price
      ) VALUES (
        @poll_id,
        @polled_at,
        @source_fetched_at,
        @gpu_type,
        @canonical_gpu_type,
        @market_utilisation_pct,
        @market_gpus_on_platform,
        @market_gpus_available,
        @market_gpus_rented,
        @market_machines_available,
        @market_median_price,
        @market_minimum_price,
        @market_p10_price,
        @market_p90_price
      )
      ON CONFLICT(poll_id, canonical_gpu_type) DO UPDATE SET
        source_fetched_at = excluded.source_fetched_at,
        gpu_type = excluded.gpu_type,
        market_utilisation_pct = excluded.market_utilisation_pct,
        market_gpus_on_platform = excluded.market_gpus_on_platform,
        market_gpus_available = excluded.market_gpus_available,
        market_gpus_rented = excluded.market_gpus_rented,
        market_machines_available = excluded.market_machines_available,
        market_median_price = excluded.market_median_price,
        market_minimum_price = excluded.market_minimum_price,
        market_p10_price = excluded.market_p10_price,
        market_p90_price = excluded.market_p90_price
    `),
    upsertPlatformGpuMetricHourlyRollup: db.prepare(`
      INSERT INTO platform_gpu_metric_hourly_rollups (
        bucket_start,
        gpu_type,
        canonical_gpu_type,
        sample_count,
        market_utilisation_pct,
        market_gpus_on_platform,
        market_gpus_available,
        market_gpus_rented,
        market_machines_available,
        market_median_price,
        market_minimum_price,
        market_p10_price,
        market_p90_price
      ) VALUES (
        @bucket_start,
        @gpu_type,
        @canonical_gpu_type,
        @sample_count,
        @market_utilisation_pct,
        @market_gpus_on_platform,
        @market_gpus_available,
        @market_gpus_rented,
        @market_machines_available,
        @market_median_price,
        @market_minimum_price,
        @market_p10_price,
        @market_p90_price
      )
      ON CONFLICT(bucket_start, canonical_gpu_type) DO UPDATE SET
        gpu_type = excluded.gpu_type,
        sample_count = excluded.sample_count,
        market_utilisation_pct = excluded.market_utilisation_pct,
        market_gpus_on_platform = excluded.market_gpus_on_platform,
        market_gpus_available = excluded.market_gpus_available,
        market_gpus_rented = excluded.market_gpus_rented,
        market_machines_available = excluded.market_machines_available,
        market_median_price = excluded.market_median_price,
        market_minimum_price = excluded.market_minimum_price,
        market_p10_price = excluded.market_p10_price,
        market_p90_price = excluded.market_p90_price
    `),
    deleteFleetSnapshotsBefore: db.prepare(`
      DELETE FROM fleet_snapshots
      WHERE polled_at < ?
    `),
    countFleetSnapshotsBefore: db.prepare(`
      SELECT COUNT(*) AS count FROM fleet_snapshots
      WHERE polled_at < ?
    `),
    deleteMachineSnapshotsBefore: db.prepare(`
      DELETE FROM machine_snapshots
      WHERE polled_at < ?
    `),
    countMachineSnapshotsBefore: db.prepare(`
      SELECT COUNT(*) AS count FROM machine_snapshots
      WHERE polled_at < ?
    `),
    deletePlatformGpuMetricSnapshotsBefore: db.prepare(`
      DELETE FROM platform_gpu_metric_snapshots
      WHERE polled_at < ?
    `),
    countPlatformGpuMetricSnapshotsBefore: db.prepare(`
      SELECT COUNT(*) AS count FROM platform_gpu_metric_snapshots
      WHERE polled_at < ?
    `),
    deletePlatformGpuMetricHourlyRollupsBefore: db.prepare(`
      DELETE FROM platform_gpu_metric_hourly_rollups
      WHERE bucket_start < ?
    `),
    countPlatformGpuMetricHourlyRollupsBefore: db.prepare(`
      SELECT COUNT(*) AS count FROM platform_gpu_metric_hourly_rollups
      WHERE bucket_start < ?
    `),
    deletePollsBefore: db.prepare(`
      DELETE FROM polls
      WHERE polled_at < ?
    `),
    countPollsBefore: db.prepare(`
      SELECT COUNT(*) AS count FROM polls
      WHERE polled_at < ?
    `),
    deleteAlertsBefore: db.prepare(`
      DELETE FROM alerts
      WHERE created_at < ?
    `),
    countAlertsBefore: db.prepare(`
      SELECT COUNT(*) AS count FROM alerts
      WHERE created_at < ?
    `),
    deleteEventsBefore: db.prepare(`
      DELETE FROM events
      WHERE created_at < ?
    `),
    countEventsBefore: db.prepare(`
      SELECT COUNT(*) AS count FROM events
      WHERE created_at < ?
    `),
    countPolls: db.prepare(`
      SELECT COUNT(*) AS count FROM polls
    `),
    countSchemaMigrations: db.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations
    `),
    countMaintenanceRuns: db.prepare(`
      SELECT COUNT(*) AS count FROM maintenance_runs
    `),
    countFleetSnapshots: db.prepare(`
      SELECT COUNT(*) AS count FROM fleet_snapshots
    `),
    countFleetSnapshotHourlyRollups: db.prepare(`
      SELECT COUNT(*) AS count FROM fleet_snapshot_hourly_rollups
    `),
    countMachineSnapshots: db.prepare(`
      SELECT COUNT(*) AS count FROM machine_snapshots
    `),
    countMachineSnapshotHourlyRollups: db.prepare(`
      SELECT COUNT(*) AS count FROM machine_snapshot_hourly_rollups
    `),
    countGpuTypeUtilizationHourlyRollups: db.prepare(`
      SELECT COUNT(*) AS count FROM gpu_type_utilization_hourly_rollups
    `),
    countGpuTypePriceHourlyRollups: db.prepare(`
      SELECT COUNT(*) AS count FROM gpu_type_price_hourly_rollups
    `),
    countPlatformGpuMetricSnapshots: db.prepare(`
      SELECT COUNT(*) AS count FROM platform_gpu_metric_snapshots
    `),
    countPlatformGpuMetricHourlyRollups: db.prepare(`
      SELECT COUNT(*) AS count FROM platform_gpu_metric_hourly_rollups
    `),
    countAlerts: db.prepare(`
      SELECT COUNT(*) AS count FROM alerts
    `),
    countEvents: db.prepare(`
      SELECT COUNT(*) AS count FROM events
    `),
    deleteAllFleetSnapshots: db.prepare(`
      DELETE FROM fleet_snapshots
    `),
    deleteAllFleetSnapshotHourlyRollups: db.prepare(`
      DELETE FROM fleet_snapshot_hourly_rollups
    `),
    deleteAllMachineSnapshotHourlyRollups: db.prepare(`
      DELETE FROM machine_snapshot_hourly_rollups
    `),
    deleteAllGpuTypeUtilizationHourlyRollups: db.prepare(`
      DELETE FROM gpu_type_utilization_hourly_rollups
    `),
    deleteAllGpuTypePriceHourlyRollups: db.prepare(`
      DELETE FROM gpu_type_price_hourly_rollups
    `),
    deleteAllPlatformGpuMetricHourlyRollups: db.prepare(`
      DELETE FROM platform_gpu_metric_hourly_rollups
    `)
  };

  const startupMaintenanceSummary = {
    schema_migrations: migrationSummary,
    deduped_fleet_snapshot_rows: migrationSummary.deduped_fleet_snapshot_rows || 0,
    retention: applyRetentionPolicies(statements, options),
    fleet_snapshots: reconcileFleetSnapshots(statements)
  };
  let currentMaintenanceRun = null;

  function normalizeMachinePersistenceRow(machine) {
    return {
      ...machine,
      verified: machine?.verified === true ? 1 : machine?.verified === false ? 0 : machine?.verified ?? null,
      verification: String(machine?.verification || "").trim() || null
    };
  }

  const txRecordPoll = db.transaction(({ timestamp, machines, offlineMachines, events, alerts, platformMetricsSnapshot = null }) => {
    const pollId = statements.insertPoll.run(timestamp).lastInsertRowid;
    const fleetSnapshot = buildFleetSnapshot([...machines, ...offlineMachines]);

    statements.insertFleetSnapshot.run({
      poll_id: pollId,
      polled_at: timestamp,
      ...fleetSnapshot
    });

    for (const machine of machines) {
      const persistedMachine = normalizeMachinePersistenceRow(machine);
      statements.upsertRegistry.run({ ...persistedMachine, timestamp });
      statements.upsertState.run({
        ...persistedMachine,
        last_seen_at: timestamp,
        last_online_at: persistedMachine.last_online_at,
        updated_at: timestamp
      });
      statements.insertSnapshot.run({
        ...persistedMachine,
        poll_id: pollId,
        polled_at: timestamp,
        last_seen_at: timestamp,
        last_online_at: persistedMachine.last_online_at
      });
    }

    for (const machine of offlineMachines) {
      const persistedMachine = normalizeMachinePersistenceRow(machine);
      statements.upsertRegistry.run({ ...persistedMachine, timestamp });
      statements.upsertState.run({
        ...persistedMachine,
        updated_at: timestamp
      });
      statements.insertSnapshot.run({ ...persistedMachine, poll_id: pollId, polled_at: timestamp });
    }

    if (platformMetricsSnapshot?.ok && Array.isArray(platformMetricsSnapshot.rows)) {
      for (const row of platformMetricsSnapshot.rows) {
        const canonicalGpuType = row.canonical_gpu_type || canonicalizeGpuType(row.gpu_type);
        if (!canonicalGpuType) {
          continue;
        }

        statements.insertPlatformGpuMetricSnapshot.run({
          poll_id: pollId,
          polled_at: timestamp,
          source_fetched_at: platformMetricsSnapshot.fetchedAt || null,
          gpu_type: row.gpu_type,
          canonical_gpu_type: canonicalGpuType,
          market_utilisation_pct: row.market_utilisation_pct ?? null,
          market_gpus_on_platform: row.market_gpus_on_platform ?? null,
          market_gpus_available: row.market_gpus_available ?? null,
          market_gpus_rented: row.market_gpus_rented ?? null,
          market_machines_available: row.market_machines_available ?? null,
          market_median_price: row.market_median_price ?? null,
          market_minimum_price: row.market_minimum_price ?? null,
          market_p10_price: row.market_p10_price ?? null,
          market_p90_price: row.market_p90_price ?? null
        });
      }
    }

    for (const event of events) {
      statements.insertEvent.run(event);
    }

    for (const alert of alerts) {
      statements.insertAlert.run(alert);
    }
  });

  function getMachineStates() {
    return statements.selectStateRows.all();
  }

  function getMachineState(machineId) {
    return statements.selectStateById.get(machineId) || null;
  }

  function getKnownMachines() {
    return statements.selectKnownMachines.all();
  }

  function recordPoll(payload) {
    txRecordPoll(payload);
  }

  function getMachineHistory(machineId, hours) {
    const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
    return getMachineSnapshotsSince(machineId, cutoff);
  }

  function getRecentAlerts(limit) {
    return statements.selectRecentAlerts.all(limit);
  }

  function getLatestPollTime() {
    return statements.selectLatestPollTime.get()?.polled_at ?? null;
  }

  function computeUptime(machineId, now = new Date()) {
    const history = statements.selectSnapshotsSince.all(
      machineId,
      new Date(now.getTime() - UPTIME_WINDOWS["30d"] * 60 * 60 * 1000).toISOString()
    );

    const result = {};
    for (const [label, hours] of Object.entries(UPTIME_WINDOWS)) {
      result[label] = computeWindowUptime(history, now, hours);
    }

    return result;
  }

  function computePriceContext(history) {
    const pricedHistory = history.filter((row) => typeof row.listed_gpu_cost === "number");
    const current = pricedHistory[pricedHistory.length - 1] ?? null;
    if (!current) {
      return {
        previous_listed_gpu_cost: null,
        price_changed_at: null,
        price_change_direction: "none"
      };
    }

    let previous = null;
    for (let index = pricedHistory.length - 2; index >= 0; index -= 1) {
      if (pricedHistory[index].listed_gpu_cost !== current.listed_gpu_cost) {
        previous = pricedHistory[index];
        break;
      }
    }

    if (!previous) {
      return {
        previous_listed_gpu_cost: current.listed_gpu_cost,
        price_changed_at: null,
        price_change_direction: "none"
      };
    }

    const direction = current.listed_gpu_cost > previous.listed_gpu_cost
      ? "up"
      : current.listed_gpu_cost < previous.listed_gpu_cost
        ? "down"
        : "none";

    return {
      previous_listed_gpu_cost: previous.listed_gpu_cost,
      price_changed_at: current.polled_at,
      price_change_direction: direction
    };
  }

  function computeMachineDeltaContext(history) {
    const latest = history[history.length - 1] ?? null;
    if (!latest) {
      return {
        previous_rentals: null,
        rentals_changed_at: null,
        rentals_change_direction: "none",
        previous_reliability: null,
        reliability_changed_at: null,
        reliability_change_direction: "none",
        previous_status: null,
        status_changed_at: null,
        status_change_direction: "none"
      };
    }

    const rentalsContext = computeDeltaFromHistory(
      history,
      (row) => Number.isFinite(row.current_rentals_running) ? row.current_rentals_running : null,
      (current, previous) => current > previous ? "up" : current < previous ? "down" : "none"
    );
    const reliabilityContext = computeDeltaFromHistory(
      history,
      (row) => Number.isFinite(row.reliability) ? row.reliability : null,
      (current, previous) => current > previous ? "up" : current < previous ? "down" : "none"
    );
    const statusContext = computeDeltaFromHistory(
      history,
      (row) => row.status || null,
      (current, previous) => current === previous ? "none" : current === "online" ? "up" : "down"
    );

    return {
      previous_rentals: rentalsContext.previousValue,
      rentals_changed_at: rentalsContext.changedAt,
      rentals_change_direction: rentalsContext.direction,
      previous_reliability: reliabilityContext.previousValue,
      reliability_changed_at: reliabilityContext.changedAt,
      reliability_change_direction: reliabilityContext.direction,
      previous_status: statusContext.previousValue,
      status_changed_at: statusContext.changedAt,
      status_change_direction: statusContext.direction
    };
  }

  function getCurrentFleetStatus() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - UPTIME_WINDOWS["30d"] * 60 * 60 * 1000).toISOString();
    const newReportCutoff = new Date(now.getTime() - (72 * 60 * 60 * 1000)).toISOString();
    const machineIdsWithNewReports72h = new Set(
      statements.selectMachineIdsWithNewReportsSince.all(newReportCutoff).map((row) => row.machine_id)
    );
    const machines = getMachineStates().map((state) => {
      const history = getMachineSnapshotsSince(state.machine_id, cutoff);
      const uptime = {};
      for (const [label, hours] of Object.entries(UPTIME_WINDOWS)) {
        uptime[label] = computeWindowUptime(history, now, hours);
      }

      return {
        ...state,
        ...computePriceContext(history),
        ...computeMachineDeltaContext(history),
        has_new_report_72h: machineIdsWithNewReports72h.has(state.machine_id),
        uptime
      };
    });

    return {
      latestPollAt: getLatestPollTime(),
      machines,
      comparison24h: getFleetComparison(24)
    };
  }

  function getMachineSnapshotsSince(machineId, cutoff) {
    const rawSnapshots = statements.selectSnapshotsSince.all(machineId, cutoff);
    const hourlyRollups = statements.selectHourlyRollupsSince.all(machineId, cutoff);

    return [...hourlyRollups, ...rawSnapshots]
      .sort((left, right) => Date.parse(left.polled_at) - Date.parse(right.polled_at));
  }

  function getHourlyEarnings(dateStr) {
    // dateStr = "YYYY-MM-DD", interpreted as UTC
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;
    const nextDay = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

    const rows = statements.selectSnapshotsForDate.all(dayStart, nextDay);
    if (rows.length === 0) return { date: dateStr, hours: [], total: 0 };

    // Group by poll timestamp to get fleet-wide snapshot per poll
    const polls = new Map();
    for (const row of rows) {
      if (!polls.has(row.polled_at)) polls.set(row.polled_at, []);
      polls.get(row.polled_at).push(row);
    }

    // For each consecutive poll pair, compute earnings = sum(occupied_gpus * listed_gpu_cost) * interval_hours
    const pollTimes = [...polls.keys()].sort();
    const hourBuckets = new Array(24).fill(0);

    for (let i = 0; i < pollTimes.length; i++) {
      const currentTime = pollTimes[i];
      const nextTime = pollTimes[i + 1] || null;
      if (!nextTime) break;

      const intervalHours = (Date.parse(nextTime) - Date.parse(currentTime)) / (1000 * 60 * 60);
      if (intervalHours <= 0 || intervalHours > 2) continue; // skip unreasonable gaps

      const machines = polls.get(currentTime);
      let fleetHourlyRate = 0;
      for (const m of machines) {
        const gpus = m.occupied_gpus || 0;
        const price = m.listed_gpu_cost || 0;
        fleetHourlyRate += gpus * price;
      }

      const earnings = fleetHourlyRate * intervalHours;
      const hour = new Date(currentTime).getUTCHours();
      hourBuckets[hour] += earnings;
    }

    const hours = hourBuckets.map((amount, h) => ({
      hour: h,
      earnings: Number(amount.toFixed(4))
    }));

    const total = Number(hourBuckets.reduce((s, v) => s + v, 0).toFixed(4));

    return { date: dateStr, hours, total };
  }

  function getFleetHistory(hours) {
    const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
    const history = [
      ...statements.selectFleetSnapshotHourlyRollupsSince.all(cutoff),
      ...statements.selectFleetSnapshotsSince.all(cutoff)
    ].sort((left, right) => Date.parse(left.polled_at) - Date.parse(right.polled_at));
    const gpuTypeUtilization = getGpuTypeUtilizationHistory(cutoff);
    const marketGpuTypeUtilization = getMarketGpuTypeUtilizationHistory(cutoff);
    const marketWeightedUtilizationHistory = getMarketWeightedUtilizationHistory(gpuTypeUtilization, marketGpuTypeUtilization);

    return {
      history,
      gpu_type_utilization: gpuTypeUtilization,
      market_gpu_type_utilization: marketGpuTypeUtilization,
      market_weighted_utilization_history: marketWeightedUtilizationHistory
    };
  }

  function getGpuTypeUtilizationHistory(cutoff) {
    const rawRows = statements.selectGpuTypeUtilizationSnapshotsSince.all(cutoff);
    const rollupRows = statements.selectGpuTypeUtilizationHourlyRollupsSince.all(cutoff);
    if (rawRows.length === 0 && rollupRows.length === 0) {
      return [];
    }

    const totalsByGpuType = new Map();
    const byTimestamp = new Map();

    for (const row of rawRows) {
      if (!row.listed) {
        continue;
      }

      if (!isFleetEligibleMachine(row, row.polled_at)) {
        continue;
      }

      const polledAt = row.polled_at;
      const gpuType = row.gpu_type || "Unknown";
      const listedGpus = Number(row.num_gpus) || 0;
      const occupiedGpus = row.status === "online" ? (Number(row.occupied_gpus) || 0) : 0;
      if (listedGpus <= 0) {
        continue;
      }

      totalsByGpuType.set(gpuType, (totalsByGpuType.get(gpuType) || 0) + listedGpus);

      const point = byTimestamp.get(polledAt) || new Map();
      const current = point.get(gpuType) || { listed_gpus: 0, occupied_gpus: 0 };
      current.listed_gpus += listedGpus;
      current.occupied_gpus += occupiedGpus;
      point.set(gpuType, current);
      byTimestamp.set(polledAt, point);
    }

    for (const row of rollupRows) {
      const polledAt = row.polled_at;
      const gpuType = row.gpu_type || "Unknown";
      const listedGpus = Number(row.listed_gpus) || 0;
      const occupiedGpus = Number(row.occupied_gpus) || 0;
      if (listedGpus <= 0) {
        continue;
      }

      totalsByGpuType.set(gpuType, (totalsByGpuType.get(gpuType) || 0) + listedGpus);

      const point = byTimestamp.get(polledAt) || new Map();
      point.set(gpuType, {
        listed_gpus: listedGpus,
        occupied_gpus: occupiedGpus
      });
      byTimestamp.set(polledAt, point);
    }

    const topGpuTypes = [...totalsByGpuType.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([gpuType]) => gpuType);

    const timestamps = [...byTimestamp.keys()].sort((a, b) => Date.parse(a) - Date.parse(b));

    return topGpuTypes.map((gpuType) => ({
      gpu_type: gpuType,
      points: timestamps
        .map((polledAt) => {
          const point = byTimestamp.get(polledAt)?.get(gpuType);
          if (!point || point.listed_gpus <= 0) {
            return null;
          }

          return {
            polled_at: polledAt,
            listed_gpus: point.listed_gpus,
            occupied_gpus: point.occupied_gpus,
            utilisation_pct: Number(((point.occupied_gpus / point.listed_gpus) * 100).toFixed(2))
          };
        })
        .filter(Boolean)
    })).filter((series) => series.points.length > 0);
  }

  function getGpuTypePriceHistory(hours, top = 6) {
    const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
    const rawRows = statements.selectGpuTypePriceSnapshotsSince.all(cutoff);
    const rollupRows = statements.selectGpuTypePriceHourlyRollupsSince.all(cutoff);
    if (rawRows.length === 0 && rollupRows.length === 0) {
      return {
        hours,
        bucket_hours: getGpuTypePriceBucketHours(hours),
        series: []
      };
    }

    const bucketHours = getGpuTypePriceBucketHours(hours);
    const bucketMs = bucketHours * 60 * 60 * 1000;
    const buckets = new Map();
    const totalPricedGpusByType = new Map();

    for (const row of rawRows) {
      const timeMs = Date.parse(row.polled_at);
      if (!Number.isFinite(timeMs)) {
        continue;
      }

      const gpuType = row.gpu_type || "Unknown";
      const gpuCount = row.num_gpus || 0;
      const price = row.listed_gpu_cost;
      if (!Number.isFinite(gpuCount) || gpuCount <= 0 || !Number.isFinite(price)) {
        continue;
      }

      const bucketStartMs = Math.floor(timeMs / bucketMs) * bucketMs;
      if (!buckets.has(bucketStartMs)) {
        buckets.set(bucketStartMs, new Map());
      }

      const bucket = buckets.get(bucketStartMs);
      const current = bucket.get(gpuType) || { total_price_weighted: 0, priced_gpus: 0 };
      current.total_price_weighted += price * gpuCount;
      current.priced_gpus += gpuCount;
      bucket.set(gpuType, current);

      totalPricedGpusByType.set(gpuType, (totalPricedGpusByType.get(gpuType) || 0) + gpuCount);
    }

    for (const row of rollupRows) {
      const timeMs = Date.parse(row.bucket_start);
      if (!Number.isFinite(timeMs)) {
        continue;
      }

      const gpuType = row.gpu_type || "Unknown";
      const pricedGpus = Number(row.priced_gpus) || 0;
      const totalPriceWeighted = Number(row.total_price_weighted) || 0;
      if (pricedGpus <= 0 || !Number.isFinite(totalPriceWeighted)) {
        continue;
      }

      const bucketStartMs = Math.floor(timeMs / bucketMs) * bucketMs;
      if (!buckets.has(bucketStartMs)) {
        buckets.set(bucketStartMs, new Map());
      }

      const bucket = buckets.get(bucketStartMs);
      const current = bucket.get(gpuType) || { total_price_weighted: 0, priced_gpus: 0 };
      current.total_price_weighted += totalPriceWeighted;
      current.priced_gpus += pricedGpus;
      bucket.set(gpuType, current);

      totalPricedGpusByType.set(gpuType, (totalPricedGpusByType.get(gpuType) || 0) + pricedGpus);
    }

    const topGpuTypes = [...totalPricedGpusByType.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
      .map(([gpuType]) => gpuType);

    const sortedBucketStarts = [...buckets.keys()].sort((a, b) => a - b);
    const series = topGpuTypes.map((gpuType) => ({
      gpu_type: gpuType,
      points: sortedBucketStarts
        .map((bucketStartMs) => {
          const bucket = buckets.get(bucketStartMs);
          const data = bucket.get(gpuType);
          if (!data || data.priced_gpus === 0) {
            return null;
          }

          return {
            bucket_start: new Date(bucketStartMs).toISOString(),
            avg_price: Number((data.total_price_weighted / data.priced_gpus).toFixed(3)),
            priced_gpus: data.priced_gpus
          };
        })
        .filter(Boolean)
    })).filter((item) => item.points.length > 0);

    return {
      hours,
      bucket_hours: bucketHours,
      series
    };
  }

  function getMarketGpuTypeUtilizationHistory(cutoff) {
    return buildMarketGpuTypeUtilizationHistory(
      statements.selectPlatformGpuMetricSnapshotsSince.all(cutoff),
      statements.selectPlatformGpuMetricHourlyRollupsSince.all(cutoff)
    );
  }

  function getMarketWeightedUtilizationHistory(ourGpuTypeUtilization, marketGpuTypeUtilization) {
    return buildMarketWeightedUtilizationHistory(ourGpuTypeUtilization, marketGpuTypeUtilization);
  }

  function getFleetComparison(hoursAgo = 24) {
    const latestPollAt = getLatestPollTime();
    if (!latestPollAt) {
      return null;
    }

    const latestSnapshot = statements.selectFleetSnapshotAtOrBefore.get(latestPollAt);
    if (!latestSnapshot) {
      return null;
    }

    const compareCutoff = new Date(Date.parse(latestPollAt) - (hoursAgo * 60 * 60 * 1000)).toISOString();
    const previousSnapshot = statements.selectFleetSnapshotAtOrBefore.get(compareCutoff);
    if (!previousSnapshot) {
      return null;
    }

    const latestAvgPrice = computeGpuWeightedAvgPrice(
      statements.selectMachineSnapshotsByPollId.all(latestSnapshot.poll_id)
    );
    const previousAvgPrice = computeGpuWeightedAvgPrice(
      statements.selectMachineSnapshotsByPollId.all(previousSnapshot.poll_id)
    );

    return {
      hoursAgo,
      latest_at: latestSnapshot.polled_at,
      previous_at: previousSnapshot.polled_at,
      listed_gpus: buildComparisonMetric(latestSnapshot.listed_gpus, previousSnapshot.listed_gpus, 0),
      utilisation_pct: buildComparisonMetric(latestSnapshot.utilisation_pct, previousSnapshot.utilisation_pct, 2),
      total_daily_earnings: buildComparisonMetric(latestSnapshot.total_daily_earnings, previousSnapshot.total_daily_earnings, 2),
      avg_listed_gpu_price: buildComparisonMetric(latestAvgPrice, previousAvgPrice, 3)
    };
  }

  function getDatabaseHealth() {
    const metadata = Object.fromEntries(
      statements.selectAllMeta.all().map((row) => [
        row.key,
        {
          value: row.value,
          updated_at: row.updated_at
        }
      ])
    );

    return {
      path: db.name,
      file_size_bytes: getDatabaseFileSize(db.name),
      row_counts: {
        schema_migrations: statements.countSchemaMigrations.get()?.count ?? 0,
        maintenance_runs: statements.countMaintenanceRuns.get()?.count ?? 0,
        polls: statements.countPolls.get()?.count ?? 0,
        fleet_snapshots: statements.countFleetSnapshots.get()?.count ?? 0,
        fleet_snapshot_hourly_rollups: statements.countFleetSnapshotHourlyRollups.get()?.count ?? 0,
        machine_snapshots: statements.countMachineSnapshots.get()?.count ?? 0,
        machine_snapshot_hourly_rollups: statements.countMachineSnapshotHourlyRollups.get()?.count ?? 0,
        gpu_type_utilization_hourly_rollups: statements.countGpuTypeUtilizationHourlyRollups.get()?.count ?? 0,
        gpu_type_price_hourly_rollups: statements.countGpuTypePriceHourlyRollups.get()?.count ?? 0,
        platform_gpu_metric_snapshots: statements.countPlatformGpuMetricSnapshots.get()?.count ?? 0,
        platform_gpu_metric_hourly_rollups: statements.countPlatformGpuMetricHourlyRollups.get()?.count ?? 0,
        alerts: statements.countAlerts.get()?.count ?? 0,
        events: statements.countEvents.get()?.count ?? 0
      },
      retention: {
        snapshot_days: normalizeRetentionDays(options.dbSnapshotRetentionDays),
        alert_days: normalizeRetentionDays(options.dbAlertRetentionDays),
        event_days: normalizeRetentionDays(options.dbEventRetentionDays)
      },
      maintenance_lock: normalizeMaintenanceLock(statements.selectMaintenanceLock.get(MAINTENANCE_LOCK_NAME) || null),
      derived_state: {
        fleet_snapshot_state_version: metadata.fleet_snapshot_state_version?.value ?? null,
        fleet_snapshot_state_updated_at: metadata.fleet_snapshot_state_version?.updated_at ?? null
      },
      maintenance: {
        in_progress: normalizeMaintenanceLock(statements.selectMaintenanceLock.get(MAINTENANCE_LOCK_NAME) || null),
        recent_runs: statements.selectRecentMaintenanceRuns.all(10).map((row) => ({
          id: row.id,
          action: row.action,
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          duration_ms: row.duration_ms,
          result: parseJsonOrNull(row.result_json),
          error_text: row.error_text
        }))
      },
      schema_migrations: statements.selectSchemaMigrations.all(),
      metadata
    };
  }

  function getStartupMaintenanceSummary() {
    return {
      ...startupMaintenanceSummary
    };
  }

  function getRetentionPreview() {
    return buildRetentionPreview(statements, options);
  }

  function acquireMaintenanceLock({ action, ownerId, startedAt }) {
    const acquiredAt = startedAt;
    const expiresAt = new Date(Date.parse(acquiredAt) + MAINTENANCE_LOCK_TTL_MS).toISOString();
    const tx = db.transaction(() => {
      const existing = statements.selectMaintenanceLock.get(MAINTENANCE_LOCK_NAME) || null;
      if (isMaintenanceLockActive(existing, acquiredAt)) {
        const error = new Error(`${existing.action} is already running`);
        error.code = "MAINTENANCE_BUSY";
        error.statusCode = 409;
        error.active_lock = normalizeMaintenanceLock(existing);
        throw error;
      }

      if (existing) {
        statements.deleteMaintenanceLockByName.run(MAINTENANCE_LOCK_NAME);
      }

      statements.insertMaintenanceLock.run({
        name: MAINTENANCE_LOCK_NAME,
        owner_id: ownerId,
        action,
        acquired_at: acquiredAt,
        expires_at: expiresAt
      });
    });

    tx();
  }

  function releaseMaintenanceLock(ownerId) {
    statements.deleteMaintenanceLockByOwner.run({
      name: MAINTENANCE_LOCK_NAME,
      owner_id: ownerId
    });
  }

  function runMaintenanceAction(action, handler) {
    const ownerId = randomUUID();
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    acquireMaintenanceLock({ action, ownerId, startedAt });
    const runId = statements.insertMaintenanceRun.run({
      action,
      status: "running",
      started_at: startedAt
    }).lastInsertRowid;

    currentMaintenanceRun = {
      action,
      started_at: startedAt,
      run_id: runId,
      owner_id: ownerId
    };

    try {
      const result = handler() || {};
      const completedAt = result.completed_at || new Date().toISOString();
      const durationMs = Number.isFinite(result.duration_ms) ? result.duration_ms : Date.now() - startedMs;
      const finalResult = {
        ...result,
        completed_at: completedAt,
        duration_ms: durationMs
      };

      statements.completeMaintenanceRun.run({
        id: runId,
        status: "succeeded",
        completed_at: completedAt,
        duration_ms: durationMs,
        result_json: JSON.stringify(finalResult),
        error_text: null
      });

      return finalResult;
    } catch (error) {
      const completedAt = new Date().toISOString();
      statements.completeMaintenanceRun.run({
        id: runId,
        status: "failed",
        completed_at: completedAt,
        duration_ms: Date.now() - startedMs,
        result_json: null,
        error_text: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      releaseMaintenanceLock(ownerId);
      currentMaintenanceRun = null;
    }
  }

  function runAnalyze() {
    return runMaintenanceAction("analyze", () => {
      db.exec("ANALYZE");
      const completedAt = new Date().toISOString();
      statements.upsertMeta.run({
        key: "analyze_last_run_at",
        value: completedAt,
        updated_at: completedAt
      });

      return {
        completed_at: completedAt
      };
    });
  }

  function runVacuum() {
    return runMaintenanceAction("vacuum", () => {
      db.exec("VACUUM");
      const completedAt = new Date().toISOString();
      statements.upsertMeta.run({
        key: "vacuum_last_run_at",
        value: completedAt,
        updated_at: completedAt
      });

      return {
        completed_at: completedAt,
        file_size_bytes: getDatabaseFileSize(db.name)
      };
    });
  }

  function runRebuildDerivedState() {
    return runMaintenanceAction("rebuild_derived", () => {
      const tx = db.transaction(() => {
        const fleetSourcePolls = statements.selectAllFleetSnapshotSourcePolls.all();
        const allMachineSnapshotRows = statements.selectAllMachineSnapshotsForRollups.all();
        const allPlatformGpuMetricSnapshotRows = statements.selectAllPlatformGpuMetricSnapshotsForRollups.all();

        const deletedFleetSnapshots = statements.deleteAllFleetSnapshots.run().changes;
        const deletedFleetRollups = statements.deleteAllFleetSnapshotHourlyRollups.run().changes;
        const deletedMachineRollups = statements.deleteAllMachineSnapshotHourlyRollups.run().changes;
        const deletedGpuUtilRollups = statements.deleteAllGpuTypeUtilizationHourlyRollups.run().changes;
        const deletedGpuPriceRollups = statements.deleteAllGpuTypePriceHourlyRollups.run().changes;
        const deletedPlatformGpuMetricRollups = statements.deleteAllPlatformGpuMetricHourlyRollups.run().changes;

        let rebuiltFleetSnapshots = 0;
        for (const snapshot of fleetSourcePolls) {
          const pollId = Number(snapshot.poll_id);
          const machines = statements.selectFleetSnapshotBackfillMachinesByPollId.all(pollId);
          if (!machines.length) {
            continue;
          }

          statements.insertFleetSnapshot.run({
            poll_id: pollId,
            polled_at: snapshot.polled_at,
            ...buildFleetSnapshot(machines)
          });
          rebuiltFleetSnapshots += 1;
        }

        const allFleetSnapshotRows = statements.selectAllFleetSnapshotsForRollups.all();
        const fleetRollups = groupFleetSnapshotRollupRows(allFleetSnapshotRows);
        for (const [bucketStart, group] of fleetRollups.entries()) {
          statements.upsertFleetSnapshotHourlyRollup.run({
            bucket_start: bucketStart,
            sample_count: group.length,
            total_machines: averageFinite(group.map((row) => row.total_machines)) ?? 0,
            datacenter_machines: averageFinite(group.map((row) => row.datacenter_machines)) ?? 0,
            unlisted_machines: averageFinite(group.map((row) => row.unlisted_machines)) ?? 0,
            listed_gpus: averageFinite(group.map((row) => row.listed_gpus)) ?? 0,
            unlisted_gpus: averageFinite(group.map((row) => row.unlisted_gpus)) ?? 0,
            occupied_gpus: averageFinite(group.map((row) => row.occupied_gpus)) ?? 0,
            utilisation_pct: averageFinite(group.map((row) => row.utilisation_pct)) ?? 0,
            total_daily_earnings: averageFinite(group.map((row) => row.total_daily_earnings)) ?? 0
          });
        }

        const machineRollups = groupMachineSnapshotRollupRows(allMachineSnapshotRows);
        for (const [key, group] of machineRollups.entries()) {
          const latest = group[group.length - 1];
          const bucketStart = key.slice(key.indexOf("|") + 1);
          statements.upsertMachineSnapshotHourlyRollup.run({
            bucket_start: bucketStart,
            machine_id: latest.machine_id,
            sample_count: group.length,
            hostname: latest.hostname,
            status: latest.status,
            occupancy: latest.occupancy,
            num_gpus: latest.num_gpus,
            occupied_gpus: averageFinite(group.map((row) => row.occupied_gpus)),
            current_rentals_running: averageFinite(group.map((row) => row.current_rentals_running)),
            reliability: averageFinite(group.map((row) => row.reliability)),
            gpu_max_cur_temp: maxFinite(group.map((row) => row.gpu_max_cur_temp)),
            listed_gpu_cost: averageFinite(group.map((row) => row.listed_gpu_cost)),
            earn_day: averageFinite(group.map((row) => row.earn_day))
          });
        }

        const gpuRollups = rollupGpuTypeHistoryRows(allMachineSnapshotRows);
        for (const row of gpuRollups.utilization_rows) {
          statements.upsertGpuTypeUtilizationHourlyRollup.run(row);
        }
        for (const row of gpuRollups.price_rows) {
          statements.upsertGpuTypePriceHourlyRollup.run(row);
        }
        const platformRollups = rollupPlatformGpuMetricHistoryRows(allPlatformGpuMetricSnapshotRows);
        for (const row of platformRollups.rows) {
          statements.upsertPlatformGpuMetricHourlyRollup.run(row);
        }

        const completedAt = new Date().toISOString();
        statements.upsertMeta.run({
          key: "derived_rebuild_last_run_at",
          value: completedAt,
          updated_at: completedAt
        });

        return {
          completed_at: completedAt,
          deleted: {
            fleet_snapshots: deletedFleetSnapshots,
            fleet_snapshot_hourly_rollups: deletedFleetRollups,
            machine_snapshot_hourly_rollups: deletedMachineRollups,
            gpu_type_utilization_hourly_rollups: deletedGpuUtilRollups,
            gpu_type_price_hourly_rollups: deletedGpuPriceRollups,
            platform_gpu_metric_hourly_rollups: deletedPlatformGpuMetricRollups
          },
          rebuilt: {
            fleet_snapshots: rebuiltFleetSnapshots,
            fleet_snapshot_hourly_rollups: fleetRollups.size,
            machine_snapshot_hourly_rollups: machineRollups.size,
            gpu_type_utilization_hourly_rollups: gpuRollups.utilization_upserted,
            gpu_type_price_hourly_rollups: gpuRollups.price_upserted,
            platform_gpu_metric_hourly_rollups: platformRollups.upserted
          }
        };
      });

      return tx();
    });
  }

  return {
    db,
    getDatabaseHealth,
    getRetentionPreview,
    runRebuildDerivedState,
    runVacuum,
    runAnalyze,
    getStartupMaintenanceSummary,
    getCurrentFleetStatus,
    getFleetHistory,
    getGpuTypePriceHistory,
    getHourlyEarnings,
    getKnownMachines,
    getMachineHistory,
    getMachineState,
    getRecentAlerts,
    recordPoll
  };
}

function buildFleetSnapshot(machines) {
  return buildFleetAggregate(machines).summary;
}

function parseJsonOrNull(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeMaintenanceLock(lockRow) {
  if (!lockRow) {
    return null;
  }

  return {
    action: lockRow.action,
    started_at: lockRow.acquired_at,
    expires_at: lockRow.expires_at,
    owner_id: lockRow.owner_id
  };
}

function isMaintenanceLockActive(lockRow, nowIso) {
  if (!lockRow) {
    return false;
  }

  return Date.parse(lockRow.expires_at) > Date.parse(nowIso);
}

function applySchemaMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = db.prepare(`
    SELECT 1
    FROM schema_migrations
    WHERE id = ?
  `);
  const insertMigration = db.prepare(`
    INSERT INTO schema_migrations (id, description, applied_at)
    VALUES (@id, @description, @applied_at)
  `);

  const summary = {
    applied_count: 0,
    applied_ids: [],
    deduped_fleet_snapshot_rows: 0
  };

  for (const migration of SCHEMA_MIGRATIONS) {
    if (hasMigration.get(migration.id)) {
      continue;
    }

    const result = migration.up(db) || {};
    const appliedAt = new Date().toISOString();
    insertMigration.run({
      id: migration.id,
      description: migration.description,
      applied_at: appliedAt
    });

    summary.applied_count += 1;
    summary.applied_ids.push(migration.id);
    summary.deduped_fleet_snapshot_rows += Number(result.deduped_fleet_snapshot_rows || 0);
  }

  return summary;
}

function ensureColumns(db, tableName, columns) {
  const existingColumns = new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name)
  );

  for (const [name, definition] of columns) {
    if (existingColumns.has(name)) {
      continue;
    }

    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
  }
}

function buildComparisonMetric(current, previous, decimals = 2) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return {
      current: Number.isFinite(current) ? Number(current.toFixed(decimals)) : null,
      previous: Number.isFinite(previous) ? Number(previous.toFixed(decimals)) : null,
      delta: null,
      pct_delta: null
    };
  }

  const roundedCurrent = Number(current.toFixed(decimals));
  const roundedPrevious = Number(previous.toFixed(decimals));
  const delta = Number((current - previous).toFixed(decimals));
  const pctDelta = previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(2));

  return {
    current: roundedCurrent,
    previous: roundedPrevious,
    delta,
    pct_delta: pctDelta
  };
}

function computeGpuWeightedAvgPrice(rows) {
  let totalWeightedPrice = 0;
  let totalPricedGpus = 0;

  for (const row of rows) {
    const gpuCount = Number(row.num_gpus);
    const price = Number(row.listed_gpu_cost);
    if (!row.listed || !Number.isFinite(gpuCount) || gpuCount <= 0 || !Number.isFinite(price)) {
      continue;
    }

    totalWeightedPrice += price * gpuCount;
    totalPricedGpus += gpuCount;
  }

  if (totalPricedGpus === 0) {
    return null;
  }

  return totalWeightedPrice / totalPricedGpus;
}

function computeDeltaFromHistory(history, getValue, getDirection) {
  const currentRow = history[history.length - 1] ?? null;
  if (!currentRow) {
    return {
      previousValue: null,
      changedAt: null,
      direction: "none"
    };
  }

  const currentValue = getValue(currentRow);
  if (currentValue == null) {
    return {
      previousValue: null,
      changedAt: null,
      direction: "none"
    };
  }

  let previousValue = currentValue;
  let changedAt = null;
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const candidateValue = getValue(history[index]);
    if (candidateValue == null) {
      continue;
    }
    previousValue = candidateValue;
    if (candidateValue !== currentValue) {
      changedAt = currentRow.polled_at;
      break;
    }
  }

  return {
    previousValue,
    changedAt,
    direction: changedAt ? getDirection(currentValue, previousValue) : "none"
  };
}

function getGpuTypePriceBucketHours(hours) {
  if (hours <= 48) {
    return 1;
  }
  if (hours <= 24 * 10) {
    return 6;
  }
  return 24;
}

function reconcileFleetSnapshots(statements) {
  const currentVersion = statements.selectMeta.get("fleet_snapshot_state_version")?.value ?? null;
  let summary;
  if (currentVersion !== FLEET_SNAPSHOT_STATE_VERSION) {
    summary = rebuildAllFleetSnapshots(statements, currentVersion);
  } else {
    summary = backfillMissingFleetSnapshots(statements, currentVersion);
  }

  statements.upsertMeta.run({
    key: "fleet_snapshot_state_version",
    value: FLEET_SNAPSHOT_STATE_VERSION,
    updated_at: new Date().toISOString()
  });

  return {
    ...summary,
    version_after: FLEET_SNAPSHOT_STATE_VERSION
  };
}

function rebuildAllFleetSnapshots(statements, versionBefore = null) {
  const polls = statements.selectAllFleetSnapshotSourcePolls.all();
  const deletedSnapshots = statements.deleteAllFleetSnapshots.run().changes;
  let insertedSnapshots = 0;

  for (const snapshot of polls) {
    const pollId = Number(snapshot.poll_id);
    const machines = statements.selectFleetSnapshotBackfillMachinesByPollId.all(pollId);
    if (!machines.length) {
      continue;
    }

    statements.insertFleetSnapshot.run({
      poll_id: pollId,
      polled_at: snapshot.polled_at,
      ...buildFleetSnapshot(machines)
    });
    insertedSnapshots += 1;
  }

  return {
    mode: "full_rebuild",
    version_before: versionBefore,
    deleted_snapshots: deletedSnapshots,
    inserted_snapshots: insertedSnapshots,
    affected_polls: polls.length
  };
}

function backfillMissingFleetSnapshots(statements, versionBefore = null) {
  const missingPolls = statements.selectMissingFleetSnapshotPolls.all();
  if (!missingPolls.length) {
    return {
      mode: "incremental_backfill",
      version_before: versionBefore,
      deleted_snapshots: 0,
      inserted_snapshots: 0,
      affected_polls: 0
    };
  }

  let insertedSnapshots = 0;
  for (const snapshot of missingPolls) {
    const pollId = Number(snapshot.poll_id);
    const machines = statements.selectFleetSnapshotBackfillMachinesByPollId.all(pollId);
    if (!machines.length) {
      continue;
    }

    statements.insertFleetSnapshot.run({
      poll_id: pollId,
      polled_at: snapshot.polled_at,
      ...buildFleetSnapshot(machines)
    });
    insertedSnapshots += 1;
  }

  return {
    mode: "incremental_backfill",
    version_before: versionBefore,
    deleted_snapshots: 0,
    inserted_snapshots: insertedSnapshots,
    affected_polls: missingPolls.length
  };
}

function applyRetentionPolicies(statements, options) {
  const summary = {
    fleet_snapshot_hourly_rollups_upserted: 0,
    machine_snapshot_hourly_rollups_upserted: 0,
    gpu_type_utilization_hourly_rollups_upserted: 0,
    gpu_type_price_hourly_rollups_upserted: 0,
    platform_gpu_metric_hourly_rollups_upserted: 0,
    fleet_snapshots_deleted: 0,
    machine_snapshots_deleted: 0,
    platform_gpu_metric_snapshots_deleted: 0,
    polls_deleted: 0,
    alerts_deleted: 0,
    events_deleted: 0
  };

  const snapshotCutoff = buildRetentionCutoffIso(options.dbSnapshotRetentionDays);
  if (snapshotCutoff) {
    summary.fleet_snapshot_hourly_rollups_upserted = rollupFleetSnapshotsBefore(statements, snapshotCutoff);
    summary.machine_snapshot_hourly_rollups_upserted = rollupMachineSnapshotsBefore(statements, snapshotCutoff);
    const gpuRollupSummary = rollupGpuTypeHistoryBefore(statements, snapshotCutoff);
    summary.gpu_type_utilization_hourly_rollups_upserted = gpuRollupSummary.utilization_upserted;
    summary.gpu_type_price_hourly_rollups_upserted = gpuRollupSummary.price_upserted;
    summary.platform_gpu_metric_hourly_rollups_upserted = rollupPlatformGpuMetricHistoryBefore(statements, snapshotCutoff);
    summary.fleet_snapshots_deleted = statements.deleteFleetSnapshotsBefore.run(snapshotCutoff).changes;
    summary.machine_snapshots_deleted = statements.deleteMachineSnapshotsBefore.run(snapshotCutoff).changes;
    summary.platform_gpu_metric_snapshots_deleted = statements.deletePlatformGpuMetricSnapshotsBefore.run(snapshotCutoff).changes;
    summary.polls_deleted = statements.deletePollsBefore.run(snapshotCutoff).changes;
  }

  const alertCutoff = buildRetentionCutoffIso(options.dbAlertRetentionDays);
  if (alertCutoff) {
    summary.alerts_deleted = statements.deleteAlertsBefore.run(alertCutoff).changes;
  }

  const eventCutoff = buildRetentionCutoffIso(options.dbEventRetentionDays);
  if (eventCutoff) {
    summary.events_deleted = statements.deleteEventsBefore.run(eventCutoff).changes;
  }

  return summary;
}

function buildRetentionPreview(statements, options) {
  const snapshotCutoff = buildRetentionCutoffIso(options.dbSnapshotRetentionDays);
  const alertCutoff = buildRetentionCutoffIso(options.dbAlertRetentionDays);
  const eventCutoff = buildRetentionCutoffIso(options.dbEventRetentionDays);

  const machineSnapshotRows = snapshotCutoff ? statements.selectMachineSnapshotsBefore.all(snapshotCutoff) : [];
  const fleetSnapshotRows = snapshotCutoff ? statements.selectFleetSnapshotsBefore.all(snapshotCutoff) : [];
  const gpuRollupSummary = snapshotCutoff
    ? rollupGpuTypeHistoryRows(machineSnapshotRows)
    : { utilization_upserted: 0, price_upserted: 0 };
  const platformBenchmarkRows = snapshotCutoff ? statements.selectPlatformGpuMetricSnapshotsBefore.all(snapshotCutoff) : [];
  const platformBenchmarkRollupSummary = snapshotCutoff
    ? rollupPlatformGpuMetricHistoryRows(platformBenchmarkRows)
    : { upserted: 0 };

  return {
    cutoffs: {
      snapshot: snapshotCutoff,
      alert: alertCutoff,
      event: eventCutoff
    },
    would_delete: {
      polls: snapshotCutoff ? (statements.countPollsBefore.get(snapshotCutoff)?.count ?? 0) : 0,
      fleet_snapshots: snapshotCutoff ? (statements.countFleetSnapshotsBefore.get(snapshotCutoff)?.count ?? 0) : 0,
      machine_snapshots: snapshotCutoff ? (statements.countMachineSnapshotsBefore.get(snapshotCutoff)?.count ?? 0) : 0,
      platform_gpu_metric_snapshots: snapshotCutoff ? (statements.countPlatformGpuMetricSnapshotsBefore.get(snapshotCutoff)?.count ?? 0) : 0,
      alerts: alertCutoff ? (statements.countAlertsBefore.get(alertCutoff)?.count ?? 0) : 0,
      events: eventCutoff ? (statements.countEventsBefore.get(eventCutoff)?.count ?? 0) : 0
    },
    would_upsert_rollups: {
      fleet_snapshot_hourly_rollups: snapshotCutoff ? countFleetSnapshotRollupBuckets(fleetSnapshotRows) : 0,
      machine_snapshot_hourly_rollups: snapshotCutoff ? countMachineSnapshotRollupBuckets(machineSnapshotRows) : 0,
      gpu_type_utilization_hourly_rollups: gpuRollupSummary.utilization_upserted,
      gpu_type_price_hourly_rollups: gpuRollupSummary.price_upserted,
      platform_gpu_metric_hourly_rollups: platformBenchmarkRollupSummary.upserted
    }
  };
}

function rollupMachineSnapshotsBefore(statements, cutoff) {
  const rows = statements.selectMachineSnapshotsBefore.all(cutoff);
  const groupedRows = groupMachineSnapshotRollupRows(rows);
  let upserted = 0;
  for (const [key, group] of groupedRows.entries()) {
    const latest = group[group.length - 1];
    const bucketStart = key.slice(key.indexOf("|") + 1);
    const sampleCount = group.length;

    statements.upsertMachineSnapshotHourlyRollup.run({
      bucket_start: bucketStart,
      machine_id: latest.machine_id,
      sample_count: sampleCount,
      hostname: latest.hostname,
      status: latest.status,
      occupancy: latest.occupancy,
      num_gpus: latest.num_gpus,
      occupied_gpus: averageFinite(group.map((row) => row.occupied_gpus)),
      current_rentals_running: averageFinite(group.map((row) => row.current_rentals_running)),
      reliability: averageFinite(group.map((row) => row.reliability)),
      gpu_max_cur_temp: maxFinite(group.map((row) => row.gpu_max_cur_temp)),
      listed_gpu_cost: averageFinite(group.map((row) => row.listed_gpu_cost)),
      earn_day: averageFinite(group.map((row) => row.earn_day))
    });
    upserted += 1;
  }

  return upserted;
}

function rollupFleetSnapshotsBefore(statements, cutoff) {
  const rows = statements.selectFleetSnapshotsBefore.all(cutoff);
  const groupedRows = groupFleetSnapshotRollupRows(rows);
  let upserted = 0;
  for (const [bucketStart, group] of groupedRows.entries()) {
    statements.upsertFleetSnapshotHourlyRollup.run({
      bucket_start: bucketStart,
      sample_count: group.length,
      total_machines: averageFinite(group.map((row) => row.total_machines)) ?? 0,
      datacenter_machines: averageFinite(group.map((row) => row.datacenter_machines)) ?? 0,
      unlisted_machines: averageFinite(group.map((row) => row.unlisted_machines)) ?? 0,
      listed_gpus: averageFinite(group.map((row) => row.listed_gpus)) ?? 0,
      unlisted_gpus: averageFinite(group.map((row) => row.unlisted_gpus)) ?? 0,
      occupied_gpus: averageFinite(group.map((row) => row.occupied_gpus)) ?? 0,
      utilisation_pct: averageFinite(group.map((row) => row.utilisation_pct)) ?? 0,
      total_daily_earnings: averageFinite(group.map((row) => row.total_daily_earnings)) ?? 0
    });
    upserted += 1;
  }

  return upserted;
}

function rollupGpuTypeHistoryBefore(statements, cutoff) {
  const rows = statements.selectMachineSnapshotsBefore.all(cutoff);
  return rollupGpuTypeHistoryRows(rows, statements);
}

function rollupPlatformGpuMetricHistoryBefore(statements, cutoff) {
  const rows = statements.selectPlatformGpuMetricSnapshotsBefore.all(cutoff);
  return rollupPlatformGpuMetricHistoryRows(rows, statements).upserted;
}

function rollupGpuTypeHistoryRows(rows, statements = null) {
  if (!rows.length) {
    return {
      utilization_upserted: 0,
      price_upserted: 0,
      utilization_rows: [],
      price_rows: []
    };
  }

  const utilizationGroups = new Map();
  const priceGroups = new Map();

  for (const row of rows) {
    const bucketStart = toHourBucketStart(row.polled_at);
    if (!bucketStart) {
      continue;
    }

    const gpuType = row.gpu_type || "Unknown";
    const numGpus = Number(row.num_gpus) || 0;
    if (numGpus > 0 && row.listed && isFleetEligibleMachine(row, row.polled_at)) {
      const utilKey = `${bucketStart}|${gpuType}`;
      const currentUtil = utilizationGroups.get(utilKey) || { bucket_start: bucketStart, gpu_type: gpuType, listed_gpus: 0, occupied_gpus: 0 };
      currentUtil.listed_gpus += numGpus;
      currentUtil.occupied_gpus += row.status === "online" ? (Number(row.occupied_gpus) || 0) : 0;
      utilizationGroups.set(utilKey, currentUtil);
    }

    const listedGpuCost = Number(row.listed_gpu_cost);
    if (row.listed && numGpus > 0 && Number.isFinite(listedGpuCost)) {
      const priceKey = `${bucketStart}|${gpuType}`;
      const currentPrice = priceGroups.get(priceKey) || { bucket_start: bucketStart, gpu_type: gpuType, priced_gpus: 0, total_price_weighted: 0 };
      currentPrice.priced_gpus += numGpus;
      currentPrice.total_price_weighted += listedGpuCost * numGpus;
      priceGroups.set(priceKey, currentPrice);
    }
  }

  let utilizationUpserted = 0;
  const utilizationRows = [...utilizationGroups.values()];
  for (const row of utilizationRows) {
    statements?.upsertGpuTypeUtilizationHourlyRollup.run(row);
    utilizationUpserted += 1;
  }

  let priceUpserted = 0;
  const priceRows = [...priceGroups.values()];
  for (const row of priceRows) {
    statements?.upsertGpuTypePriceHourlyRollup.run(row);
    priceUpserted += 1;
  }

  return {
    utilization_upserted: utilizationUpserted,
    price_upserted: priceUpserted,
    utilization_rows: utilizationRows,
    price_rows: priceRows
  };
}

function rollupPlatformGpuMetricHistoryRows(rows, statements = null) {
  const rollupRows = buildPlatformGpuMetricHourlyRollups(rows);

  let upserted = 0;
  for (const row of rollupRows) {
    statements?.upsertPlatformGpuMetricHourlyRollup.run(row);
    upserted += 1;
  }

  return {
    upserted,
    rows: rollupRows
  };
}

function groupMachineSnapshotRollupRows(rows) {
  const groupedRows = new Map();
  for (const row of rows) {
    const bucketStart = toHourBucketStart(row.polled_at);
    if (!bucketStart) {
      continue;
    }

    const key = `${row.machine_id}|${bucketStart}`;
    if (!groupedRows.has(key)) {
      groupedRows.set(key, []);
    }
    groupedRows.get(key).push(row);
  }
  return groupedRows;
}

function countMachineSnapshotRollupBuckets(rows) {
  return groupMachineSnapshotRollupRows(rows).size;
}

function groupFleetSnapshotRollupRows(rows) {
  const groupedRows = new Map();
  for (const row of rows) {
    const bucketStart = toHourBucketStart(row.polled_at);
    if (!bucketStart) {
      continue;
    }

    if (!groupedRows.has(bucketStart)) {
      groupedRows.set(bucketStart, []);
    }
    groupedRows.get(bucketStart).push(row);
  }
  return groupedRows;
}

function countFleetSnapshotRollupBuckets(rows) {
  return groupFleetSnapshotRollupRows(rows).size;
}

function toHourBucketStart(value) {
  const timeMs = Date.parse(value);
  if (!Number.isFinite(timeMs)) {
    return null;
  }

  const date = new Date(timeMs);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function averageFinite(values) {
  const finiteValues = values.map(Number).filter(Number.isFinite);
  if (!finiteValues.length) {
    return null;
  }

  return Number((finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length).toFixed(4));
}

function maxFinite(values) {
  const finiteValues = values.map(Number).filter(Number.isFinite);
  if (!finiteValues.length) {
    return null;
  }

  return Math.max(...finiteValues);
}

function buildRetentionCutoffIso(days) {
  const retentionDays = Number(days);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return null;
  }

  return new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)).toISOString();
}

function normalizeRetentionDays(days) {
  const value = Number(days);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getDatabaseFileSize(dbPath) {
  try {
    return fs.statSync(dbPath).size;
  } catch {
    return null;
  }
}

function computeWindowUptime(history, now, hours) {
  const windowStart = now.getTime() - hours * 60 * 60 * 1000;
  const relevant = history
    .map((row) => ({ ...row, timeMs: Date.parse(row.polled_at) }))
    .filter((row) => Number.isFinite(row.timeMs) && row.timeMs >= windowStart)
    .sort((a, b) => a.timeMs - b.timeMs);

  if (relevant.length === 0) {
    return null;
  }

  let onlineMs = 0;
  for (let index = 0; index < relevant.length; index += 1) {
    const current = relevant[index];
    const nextTime = relevant[index + 1]?.timeMs ?? now.getTime();
    const duration = Math.max(0, nextTime - current.timeMs);

    if (current.status === "online") {
      onlineMs += duration;
    }
  }

  const totalMs = Math.max(1, now.getTime() - Math.max(windowStart, relevant[0].timeMs));
  return Number(((onlineMs / totalMs) * 100).toFixed(2));
}
