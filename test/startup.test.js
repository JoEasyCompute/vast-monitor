import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startApp } from "../src/index.js";

test("startApp logs a concise database maintenance summary at startup", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vast-monitor-startup-"));
  const cliPath = path.join(tempDir, "vast");
  const apiKeyPath = path.join(tempDir, "vast_api_key");

  fs.writeFileSync(cliPath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(cliPath, 0o755);
  fs.writeFileSync(apiKeyPath, "secret-token\n");

  const logs = [];
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalProcessOn = process.on;

  console.log = (...args) => logs.push(args.join(" "));
  console.warn = () => {};
  process.on = () => process;

  const server = { close(callback) { callback?.(); } };
  const app = {
    listen(_port, callback) {
      callback?.();
      return server;
    }
  };

  try {
    const started = await startApp({
      config: {
        projectRoot: tempDir,
        port: 3000,
        pollIntervalMs: 300000,
        vastCliPath: cliPath,
        vastApiKeyPath: apiKeyPath,
        dbPath: path.join(tempDir, "vast-monitor.db"),
        alertCooldownMinutes: 60,
        alertHostnameCollisionCooldownMinutes: 360
      },
      db: {
        getStartupMaintenanceSummary() {
          return {
            deduped_fleet_snapshot_rows: 0,
            retention: {
              fleet_snapshots_deleted: 0,
              machine_snapshots_deleted: 0,
              polls_deleted: 0,
              alerts_deleted: 0,
              events_deleted: 0
            },
            fleet_snapshots: {
              mode: "incremental_backfill",
              inserted_snapshots: 2
            }
          };
        }
      },
      plugins: [],
      app,
      monitor: {
        start: async () => true,
        stop() {}
      }
    });

    assert.ok(logs.some((line) => line.includes("[startup] Database maintenance: fleet snapshots backfilled (2 poll(s))")));
    started.server.close(() => {});
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    process.on = originalProcessOn;
  }
});
