import { config } from "./config.js";
import { createDatabase } from "./db.js";
import { AlertManager } from "./alerts/alert-manager.js";
import { ConsoleAlertChannel } from "./alerts/console-alert-channel.js";
import { FleetMonitor } from "./monitor.js";
import { createServer } from "./server.js";

const db = createDatabase(config.dbPath);
const alertManager = new AlertManager([new ConsoleAlertChannel()]);
const monitor = new FleetMonitor({ config, db, alertManager });
const app = createServer({ config, db });

await monitor.start();

app.listen(config.port, () => {
  console.log(`vast-monitor listening on http://localhost:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    monitor.stop();
    process.exit(0);
  });
}
