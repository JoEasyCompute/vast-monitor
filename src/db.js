import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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
        gpu_max_cur_temp, earn_day, num_reports, num_recent_reports, error_message, machine_maintenance, host_id, hosting_type,
        is_datacenter, datacenter_id, status
      ) VALUES (
        @poll_id, @polled_at, @machine_id, @hostname, @gpu_type, @num_gpus, @occupancy,
        @occupied_gpus, @current_rentals_running, @listed, @listed_gpu_cost, @reliability,
        @gpu_max_cur_temp, @earn_day, @num_reports, @num_recent_reports, @error_message, @machine_maintenance, @host_id, @hosting_type,
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
      SELECT polled_at, status, occupancy, occupied_gpus, current_rentals_running, gpu_max_cur_temp, listed_gpu_cost, earn_day
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
    selectSnapshotsForDate: db.prepare(`
      SELECT polled_at, machine_id, occupied_gpus, listed_gpu_cost
      FROM machine_snapshots
      WHERE polled_at >= ? AND polled_at < ?
      ORDER BY polled_at ASC
    `)
  };

  const txRecordPoll = db.transaction(({ timestamp, machines, offlineMachines, events, alerts }) => {
    const pollId = statements.insertPoll.run(timestamp).lastInsertRowid;

    for (const machine of machines) {
      statements.upsertRegistry.run({ ...machine, timestamp });
      statements.upsertState.run({
        ...machine,
        last_seen_at: timestamp,
        last_online_at: machine.last_online_at,
        updated_at: timestamp
      });
      statements.insertSnapshot.run({ ...machine, poll_id: pollId, polled_at: timestamp });
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

  function getCurrentFleetStatus() {
    const now = new Date();
    const machines = getMachineStates().map((state) => ({
      ...state,
      uptime: computeUptime(state.machine_id, now)
    }));

    return {
      latestPollAt: getLatestPollTime(),
      machines
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

  return {
    db,
    getCurrentFleetStatus,
    getHourlyEarnings,
    getKnownMachines,
    getMachineHistory,
    getMachineState,
    getRecentAlerts,
    recordPoll
  };
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
