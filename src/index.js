import { config } from "./config.js";
import { createDatabase } from "./db.js";
import { AlertManager } from "./alerts/alert-manager.js";
import { ConsoleAlertChannel } from "./alerts/console-alert-channel.js";
import { FleetMonitor } from "./monitor.js";
import { createServer } from "./server.js";

console.log("[startup] Loading configuration");
const db = createDatabase(config.dbPath);
console.log(`[startup] Database ready at ${config.dbPath}`);
const alertManager = new AlertManager([new ConsoleAlertChannel()]);
const monitor = new FleetMonitor({ config, db, alertManager });
const app = createServer({ config, db, monitor });

console.log(`[startup] Starting HTTP server on port ${config.port}`);
const server = app.listen(config.port, () => {
  console.log(`vast-monitor listening on http://localhost:${config.port}`);
});

console.log("[startup] Starting fleet monitor");
monitor.start()
  .then((initialPollSucceeded) => {
    if (initialPollSucceeded) {
      console.log("[startup] Initial fleet sync complete");
    } else {
      console.warn("[startup] Service is running, but initial fleet sync failed; waiting for next poll");
    }
  })
  .catch((error) => {
    console.error("[startup] Fleet monitor failed to start:", error);
    process.exitCode = 1;
  });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[shutdown] Received ${signal}, stopping monitor`);
    monitor.stop();
    server.close(() => {
      process.exit(0);
    });
  });
}
