import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTempDbPath(prefix = "vast-monitor-test-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, "vast-monitor.db");
}

export function makeMachine(overrides = {}) {
  return {
    machine_id: 1,
    hostname: "host-1",
    gpu_type: "RTX 4090",
    num_gpus: 2,
    occupancy: "D -",
    occupied_gpus: 1,
    current_rentals_running: 1,
    listed: 1,
    listed_gpu_cost: 0.5,
    reliability: 0.99,
    gpu_max_cur_temp: 70,
    earn_day: 10,
    num_reports: 0,
    num_recent_reports: 0,
    prev_day_reports: 0,
    reports_changed: 0,
    status: "online",
    error_message: null,
    machine_maintenance: null,
    public_ipaddr: "127.0.0.1",
    host_id: 500,
    hosting_type: 1,
    is_datacenter: 1,
    datacenter_id: 500,
    verified: null,
    verification: null,
    last_seen_at: null,
    last_online_at: null,
    idle_since: null,
    temp_alert_active: 0,
    idle_alert_active: 0,
    ...overrides
  };
}
