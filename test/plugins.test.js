import test from "node:test";
import assert from "node:assert/strict";

import { FleetMonitor } from "../src/monitor.js";
import { getClientExtensionManifest, normalizePlugin } from "../src/plugins/index.js";

test("normalizePlugin assigns a stable slug and preserves plugin hooks", () => {
  const plugin = normalizePlugin({
    name: "Acme Internal",
    enrichMachine() {}
  });

  assert.equal(plugin.name, "Acme Internal");
  assert.equal(plugin.slug, "acme-internal");
  assert.equal(typeof plugin.enrichMachine, "function");
});

test("client extension manifest resolves plugin asset urls under /plugins/<slug>", () => {
  const manifest = getClientExtensionManifest([
    {
      name: "Acme Internal",
      slug: "acme-internal",
      clientAssets: {
        publicDir: "./private-assets",
        scripts: ["company-app.js"],
        styles: ["company.css"]
      }
    }
  ]);

  assert.deepEqual(manifest, {
    scripts: ["/plugins/acme-internal/company-app.js"],
    styles: ["/plugins/acme-internal/company.css"]
  });
});

test("FleetMonitor plugin hooks can enrich machines and emit custom alerts", async () => {
  const recorded = [];
  const monitor = new FleetMonitor({
    config: {
      pollIntervalMs: 300000,
      alertTempThreshold: 85,
      alertIdleHours: 6
    },
    db: {},
    alertManager: { async send(alert) { recorded.push(alert.alert_type); } },
    plugins: [{
      name: "Acme Internal",
      async enrichMachine({ machine }) {
        return { ...machine, company_tag: "acme" };
      },
      async buildAlerts({ current, timestamp }) {
        return {
          events: [],
          alerts: [{
            created_at: timestamp,
            machine_id: current.machine_id,
            hostname: current.hostname,
            alert_type: "company_policy",
            severity: "info",
            message: `${current.hostname} tagged ${current.company_tag}`,
            payload_json: JSON.stringify({ company_tag: current.company_tag })
          }]
        };
      }
    }]
  });

  const enriched = await monitor.runEnrichMachineHooks({
    machine: { machine_id: 1, hostname: "alpha" },
    previous: null
  });
  const extra = await monitor.runBuildAlertsHooks({
    previous: null,
    current: enriched,
    timestamp: "2026-03-24T10:00:00.000Z"
  });

  assert.equal(enriched.company_tag, "acme");
  assert.equal(extra.alerts.length, 1);
  assert.equal(extra.alerts[0].alert_type, "company_policy");
});
