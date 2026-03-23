import test from "node:test";
import assert from "node:assert/strict";

import { AlertManager } from "../src/alerts/alert-manager.js";

test("AlertManager suppresses duplicate noisy alerts during cooldown windows", async () => {
  const delivered = [];
  const manager = new AlertManager([{
    async send(alert) {
      delivered.push(alert.alert_type);
    }
  }], {
    defaultCooldownMinutes: 60,
    hostnameCollisionCooldownMinutes: 360
  });

  const firstNewReports = makeAlert({
    created_at: "2026-03-23T10:00:00.000Z",
    alert_type: "new_reports",
    machine_id: 1,
    hostname: "alpha",
    message: "alpha has 2 new report(s) (total: 5)"
  });
  const secondNewReports = makeAlert({
    created_at: "2026-03-23T10:30:00.000Z",
    alert_type: "new_reports",
    machine_id: 1,
    hostname: "alpha",
    message: "alpha has 2 new report(s) (total: 5)"
  });
  const laterNewReports = makeAlert({
    created_at: "2026-03-23T11:30:00.000Z",
    alert_type: "new_reports",
    machine_id: 1,
    hostname: "alpha",
    message: "alpha has 2 new report(s) (total: 5)"
  });

  assert.equal(await manager.send(firstNewReports), true);
  assert.equal(await manager.send(secondNewReports), false);
  assert.equal(await manager.send(laterNewReports), true);
  assert.deepEqual(delivered, ["new_reports", "new_reports"]);
});

test("AlertManager uses a longer cooldown for hostname collisions", async () => {
  const delivered = [];
  const manager = new AlertManager([{
    async send(alert) {
      delivered.push(alert.message);
    }
  }], {
    defaultCooldownMinutes: 60,
    hostnameCollisionCooldownMinutes: 360
  });

  assert.equal(await manager.send(makeAlert({
    created_at: "2026-03-23T10:00:00.000Z",
    alert_type: "hostname_collision",
    hostname: "alpha",
    message: "alpha appeared multiple times in the same poll (10, 12); keeping machine 12"
  })), true);
  assert.equal(await manager.send(makeAlert({
    created_at: "2026-03-23T12:00:00.000Z",
    alert_type: "hostname_collision",
    hostname: "alpha",
    message: "alpha appeared multiple times in the same poll (10, 12); keeping machine 12"
  })), false);
  assert.equal(await manager.send(makeAlert({
    created_at: "2026-03-23T17:30:00.000Z",
    alert_type: "hostname_collision",
    hostname: "alpha",
    message: "alpha appeared multiple times in the same poll (10, 12); keeping machine 12"
  })), true);

  assert.equal(delivered.length, 2);
});

test("AlertManager does not suppress transition alerts like host_down", async () => {
  const delivered = [];
  const manager = new AlertManager([{
    async send(alert) {
      delivered.push(alert.created_at);
    }
  }], {
    defaultCooldownMinutes: 60,
    hostnameCollisionCooldownMinutes: 360
  });

  assert.equal(await manager.send(makeAlert({
    created_at: "2026-03-23T10:00:00.000Z",
    alert_type: "host_down",
    machine_id: 1,
    hostname: "alpha",
    message: "alpha went offline"
  })), true);
  assert.equal(await manager.send(makeAlert({
    created_at: "2026-03-23T10:05:00.000Z",
    alert_type: "host_down",
    machine_id: 1,
    hostname: "alpha",
    message: "alpha went offline"
  })), true);

  assert.equal(delivered.length, 2);
});

function makeAlert(overrides = {}) {
  return {
    created_at: "2026-03-23T10:00:00.000Z",
    machine_id: null,
    hostname: "",
    alert_type: "new_reports",
    severity: "warning",
    message: "",
    payload_json: "{}",
    ...overrides
  };
}
