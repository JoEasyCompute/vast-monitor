import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { buildFleetAggregate, isFleetEligibleMachine } from "./fleet-metrics.js";

const UPTIME_WINDOWS = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30
};

export function createDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

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
      temp_alert_active INTEGER NOT NULL DEFAULT 0,
      idle_alert_active INTEGER NOT NULL DEFAULT 0,
      public_ipaddr TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      polled_at TEXT NOT NULL
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
      status TEXT NOT NULL,
      FOREIGN KEY (poll_id) REFERENCES polls(id)
    );

    CREATE INDEX IF NOT EXISTS idx_machine_snapshots_machine_time
      ON machine_snapshots(machine_id, polled_at);

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
  `);

  const machineStateColumns = new Set(
    db.prepare("PRAGMA table_info(machine_state)").all().map((column) => column.name)
  );
  if (!machineStateColumns.has("public_ipaddr")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN public_ipaddr TEXT");
  }
  if (!machineStateColumns.has("listed")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN listed INTEGER NOT NULL DEFAULT 1");
  }
  if (!machineStateColumns.has("host_id")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN host_id INTEGER");
  }
  if (!machineStateColumns.has("error_message")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN error_message TEXT");
  }
  if (!machineStateColumns.has("machine_maintenance")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN machine_maintenance TEXT");
  }
  if (!machineStateColumns.has("hosting_type")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN hosting_type INTEGER");
  }
  if (!machineStateColumns.has("is_datacenter")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN is_datacenter INTEGER NOT NULL DEFAULT 0");
  }
  if (!machineStateColumns.has("datacenter_id")) {
    db.exec("ALTER TABLE machine_state ADD COLUMN datacenter_id INTEGER");
  }

  const machineSnapshotColumns = new Set(
    db.prepare("PRAGMA table_info(machine_snapshots)").all().map((column) => column.name)
  );
  if (!machineSnapshotColumns.has("host_id")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN host_id INTEGER");
  }
  if (!machineSnapshotColumns.has("listed")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN listed INTEGER NOT NULL DEFAULT 1");
  }
  if (!machineSnapshotColumns.has("error_message")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN error_message TEXT");
  }
  if (!machineSnapshotColumns.has("machine_maintenance")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN machine_maintenance TEXT");
  }
  if (!machineSnapshotColumns.has("last_seen_at")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN last_seen_at TEXT");
  }
  if (!machineSnapshotColumns.has("last_online_at")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN last_online_at TEXT");
  }
  if (!machineSnapshotColumns.has("hosting_type")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN hosting_type INTEGER");
  }
  if (!machineSnapshotColumns.has("is_datacenter")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN is_datacenter INTEGER NOT NULL DEFAULT 0");
  }
  if (!machineSnapshotColumns.has("datacenter_id")) {
    db.exec("ALTER TABLE machine_snapshots ADD COLUMN datacenter_id INTEGER");
  }

  const statements = {
    insertPoll: db.prepare(`
      INSERT INTO polls (polled_at) VALUES (?)
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
    deleteFleetSnapshots: db.prepare(`
      DELETE FROM fleet_snapshots
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
        last_seen_at, last_online_at, idle_since, host_id, hosting_type, is_datacenter, datacenter_id,
        temp_alert_active, idle_alert_active, updated_at, public_ipaddr
      ) VALUES (
        @machine_id, @hostname, @gpu_type, @num_gpus, @status, @occupancy, @occupied_gpus,
        @current_rentals_running, @listed, @listed_gpu_cost, @reliability, @gpu_max_cur_temp, @earn_day,
        @num_reports, @num_recent_reports, @prev_day_reports, @reports_changed, @error_message, @machine_maintenance,
        @last_seen_at, @last_online_at, @idle_since, @host_id, @hosting_type, @is_datacenter, @datacenter_id,
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
        is_datacenter, datacenter_id, status
      ) VALUES (
        @poll_id, @polled_at, @machine_id, @hostname, @gpu_type, @num_gpus, @occupancy,
        @occupied_gpus, @current_rentals_running, @listed, @listed_gpu_cost, @reliability,
        @gpu_max_cur_temp, @earn_day, @num_reports, @num_recent_reports, @error_message, @machine_maintenance, @last_seen_at, @last_online_at, @host_id, @hosting_type,
        @is_datacenter, @datacenter_id, @status
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
    selectFleetSnapshotPollIds: db.prepare(`
      SELECT poll_id FROM fleet_snapshots
    `),
    selectAllMachineSnapshots: db.prepare(`
      SELECT poll_id, polled_at, machine_id, hostname, num_gpus, status, occupied_gpus,
             listed, earn_day, is_datacenter, last_seen_at, last_online_at
      FROM machine_snapshots
      ORDER BY poll_id ASC, machine_id ASC
    `),
    selectFleetSnapshotsSince: db.prepare(`
      SELECT polled_at, total_machines, datacenter_machines, unlisted_machines,
             listed_gpus, unlisted_gpus, occupied_gpus, utilisation_pct, total_daily_earnings
      FROM fleet_snapshots
      WHERE polled_at >= ?
      ORDER BY polled_at ASC
    `),
    selectGpuTypeUtilizationSnapshotsSince: db.prepare(`
      SELECT polled_at, gpu_type, num_gpus, occupied_gpus, listed, status, last_seen_at, last_online_at
      FROM machine_snapshots
      WHERE polled_at >= ?
        AND num_gpus IS NOT NULL
        AND num_gpus > 0
      ORDER BY polled_at ASC
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
    selectMachineSnapshotsByPollId: db.prepare(`
      SELECT listed, num_gpus, listed_gpu_cost
      FROM machine_snapshots
      WHERE poll_id = ?
    `)
  };

  backfillFleetSnapshots(statements);

  const txRecordPoll = db.transaction(({ timestamp, machines, offlineMachines, events, alerts }) => {
    const pollId = statements.insertPoll.run(timestamp).lastInsertRowid;
    const fleetSnapshot = buildFleetSnapshot([...machines, ...offlineMachines]);

    statements.insertFleetSnapshot.run({
      poll_id: pollId,
      polled_at: timestamp,
      ...fleetSnapshot
    });

    for (const machine of machines) {
      statements.upsertRegistry.run({ ...machine, timestamp });
      statements.upsertState.run({
        ...machine,
        last_seen_at: timestamp,
        last_online_at: machine.last_online_at,
        updated_at: timestamp
      });
      statements.insertSnapshot.run({
        ...machine,
        poll_id: pollId,
        polled_at: timestamp,
        last_seen_at: timestamp,
        last_online_at: machine.last_online_at
      });
    }

    for (const machine of offlineMachines) {
      statements.upsertRegistry.run({ ...machine, timestamp });
      statements.upsertState.run({
        ...machine,
        updated_at: timestamp
      });
      statements.insertSnapshot.run({ ...machine, poll_id: pollId, polled_at: timestamp });
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
    return statements.selectSnapshotsSince.all(machineId, cutoff);
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
      const history = statements.selectSnapshotsSince.all(state.machine_id, cutoff);
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
    const history = statements.selectFleetSnapshotsSince.all(cutoff);
    const gpuTypeUtilization = getGpuTypeUtilizationHistory(cutoff);

    return {
      history,
      gpu_type_utilization: gpuTypeUtilization
    };
  }

  function getGpuTypeUtilizationHistory(cutoff, top = 5) {
    const rows = statements.selectGpuTypeUtilizationSnapshotsSince.all(cutoff);
    if (rows.length === 0) {
      return [];
    }

    const totalsByGpuType = new Map();
    const byTimestamp = new Map();

    for (const row of rows) {
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

    const topGpuTypes = [...totalsByGpuType.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
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
    const rows = statements.selectGpuTypePriceSnapshotsSince.all(cutoff);
    if (rows.length === 0) {
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

    for (const row of rows) {
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

  return {
    db,
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

function backfillFleetSnapshots(statements) {
  const rows = statements.selectAllMachineSnapshots.all();
  if (!rows.length) {
    return;
  }

  const snapshotsByPollId = new Map();
  for (const row of rows) {
    const pollId = Number(row.poll_id);
    if (!snapshotsByPollId.has(pollId)) {
      snapshotsByPollId.set(pollId, {
        polled_at: row.polled_at,
        machines: []
      });
    }

    snapshotsByPollId.get(pollId).machines.push({
      machine_id: row.machine_id,
      hostname: row.hostname,
      num_gpus: row.num_gpus,
      status: row.status,
      occupied_gpus: row.occupied_gpus,
      listed: row.listed,
      earn_day: row.earn_day,
      is_datacenter: row.is_datacenter,
      last_seen_at: row.last_seen_at,
      last_online_at: row.last_online_at
    });
  }

  statements.deleteFleetSnapshots.run();

  for (const [pollId, snapshot] of snapshotsByPollId.entries()) {
    statements.insertFleetSnapshot.run({
      poll_id: pollId,
      polled_at: snapshot.polled_at,
      ...buildFleetSnapshot(snapshot.machines)
    });
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
