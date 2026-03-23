import test from "node:test";
import assert from "node:assert/strict";

import {
  FleetMonitor,
  buildChangeSet,
  detectHostnameCollisions,
  dedupeMachinesByHostname,
  resolveDatacenterFields,
  resolveIdleSince,
  resolveReportTracking,
  shouldKeepIdleAlert,
  shouldKeepTempAlert
} from "../src/monitor.js";

test("dedupeMachinesByHostname keeps the highest machine_id per hostname", () => {
  const machines = dedupeMachinesByHostname([
    { machine_id: 10, hostname: "alpha" },
    { machine_id: 12, hostname: "alpha" },
    { machine_id: 9, hostname: "beta" }
  ]);

  assert.deepEqual(machines, [
    { machine_id: 12, hostname: "alpha" },
    { machine_id: 9, hostname: "beta" }
  ]);
});

test("detectHostnameCollisions reports duplicate hostnames in a poll", () => {
  const warnings = detectHostnameCollisions([
    { machine_id: 10, hostname: "alpha" },
    { machine_id: 12, hostname: "alpha" },
    { machine_id: 9, hostname: "beta" }
  ]);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /alpha appeared multiple times/);
  assert.deepEqual(warnings[0].payload, {
    hostname: "alpha",
    machine_ids: [10, 12],
    kept_machine_id: 12
  });
});

test("resolveReportTracking keeps baseline on same day and resets on next day", () => {
  const previous = {
    prev_day_reports: 3,
    num_reports: 5,
    updated_at: "2026-03-13T10:00:00.000Z"
  };

  assert.deepEqual(
    resolveReportTracking(previous, { num_reports: 6 }, "2026-03-13T12:00:00.000Z"),
    { prev_day_reports: 3, reports_changed: 1 }
  );

  assert.deepEqual(
    resolveReportTracking(previous, { num_reports: 6 }, "2026-03-14T00:05:00.000Z"),
    { prev_day_reports: 5, reports_changed: 1 }
  );
});

test("FleetMonitor health snapshot includes poll observability metrics", () => {
  const monitor = new FleetMonitor({
    config: { pollIntervalMs: 300000 },
    db: {},
    alertManager: { send() {} }
  });

  monitor.lastPollDurationMs = 4200;
  monitor.lastFetchDurationMs = 1800;
  monitor.lastPersistDurationMs = 900;
  monitor.lastAlertDispatchDurationMs = 120;
  monitor.lastOnlineMachineCount = 12;
  monitor.lastOfflineMachineCount = 3;
  monitor.lastEventCount = 7;
  monitor.lastAlertCount = 2;
  monitor.lastHostnameCollisionCount = 1;

  const snapshot = monitor.getHealthSnapshot();

  assert.equal(snapshot.lastPollDurationMs, 4200);
  assert.equal(snapshot.lastFetchDurationMs, 1800);
  assert.equal(snapshot.lastPersistDurationMs, 900);
  assert.equal(snapshot.lastAlertDispatchDurationMs, 120);
  assert.equal(snapshot.lastOnlineMachineCount, 12);
  assert.equal(snapshot.lastOfflineMachineCount, 3);
  assert.equal(snapshot.lastEventCount, 7);
  assert.equal(snapshot.lastAlertCount, 2);
  assert.equal(snapshot.lastHostnameCollisionCount, 1);
});

test("change set emits startup, rental, temperature, and idle alerts from current state", () => {
  const timestamp = "2026-03-14T12:00:00.000Z";
  const current = {
    machine_id: 42,
    hostname: "alpha",
    current_rentals_running: 2,
    gpu_max_cur_temp: 91,
    idle_since: null,
    reports_changed: 0,
    status: "online"
  };

  const previous = {
    status: "offline",
    current_rentals_running: 0,
    temp_alert_active: 0,
    idle_alert_active: 0
  };

  const { nextEvents, nextAlerts } = buildChangeSet({
    previous,
    current,
    timestamp,
    config: { alertTempThreshold: 85, alertIdleHours: 6 }
  });

  assert.deepEqual(nextEvents.map((event) => event.event_type), ["host_up", "rental_started"]);
  assert.deepEqual(nextAlerts.map((alert) => alert.alert_type), ["host_up", "high_temp"]);
});

test("idle helpers preserve idle start until rentals resume", () => {
  const previous = {
    current_rentals_running: 0,
    idle_since: "2026-03-14T01:00:00.000Z"
  };
  const idleCurrent = { current_rentals_running: 0, gpu_max_cur_temp: 86 };
  const rentedCurrent = { current_rentals_running: 1, gpu_max_cur_temp: 70 };
  const timestamp = "2026-03-14T10:00:00.000Z";

  assert.equal(resolveIdleSince(previous, idleCurrent, timestamp), previous.idle_since);
  assert.equal(shouldKeepIdleAlert(previous, idleCurrent, 6, timestamp), true);
  assert.equal(resolveIdleSince(previous, rentedCurrent, timestamp), null);
  assert.equal(shouldKeepIdleAlert(previous, rentedCurrent, 6, timestamp), false);
  assert.equal(shouldKeepTempAlert(previous, idleCurrent, 85), true);
  assert.equal(shouldKeepTempAlert(previous, rentedCurrent, 85), false);
});

test("resolveDatacenterFields preserves prior datacenter metadata when enrichment is missing", () => {
  assert.deepEqual(
    resolveDatacenterFields(
      { host_id: 500, hosting_type: 1, is_datacenter: 1, datacenter_id: 500 },
      { host_id: null, hosting_type: null }
    ),
    { host_id: 500, hosting_type: 1, is_datacenter: 1, datacenter_id: 500 }
  );

  assert.deepEqual(
    resolveDatacenterFields(
      { host_id: 500, hosting_type: 1, is_datacenter: 1, datacenter_id: 500 },
      { host_id: 700, hosting_type: 0 }
    ),
    { host_id: 700, hosting_type: 0, is_datacenter: 0, datacenter_id: null }
  );
});
