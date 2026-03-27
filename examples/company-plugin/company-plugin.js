import { definePlugin } from "../../src/plugins/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mappingPath = path.join(__dirname, "../config/owner-team-map.json");

export default definePlugin({
  name: "Example Company Plugin",

  async enrichMachine({ machine }) {
    return decorateMachineWithAssignment(machine);
  },

  async decorateStatusMachine({ machine }) {
    return decorateMachineWithAssignment(machine);
  },

  async buildAlerts({ current, timestamp }) {
    if (!current.owner_name && !current.team_name) {
      return { events: [], alerts: [] };
    }

    return {
      events: [],
      alerts: [{
        created_at: timestamp,
        machine_id: current.machine_id,
        hostname: current.hostname,
        alert_type: "company_assignment",
        severity: "info",
        message: `${current.hostname} assigned to ${formatAssignmentLabel(current)}`,
        payload_json: JSON.stringify({
          owner_name: current.owner_name,
          team_name: current.team_name
        })
      }]
    };
  },

  registerRoutes({ app }) {
    app.get("/api/company/assignments", (_req, res) => {
      res.json({
        ok: true,
        source: "example-company-plugin",
        mapping: loadOwnerTeamMapping()
      });
    });
  },

  clientAssets: {
    publicDir: "./examples/company-plugin/public",
    scripts: ["company-app.js"],
    styles: ["company.css"]
  }
});

function loadOwnerTeamMapping() {
  try {
    const raw = fs.readFileSync(mappingPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      machine_ids: Array.isArray(parsed?.machine_ids) ? parsed.machine_ids : [],
      hostname_prefixes: Array.isArray(parsed?.hostname_prefixes) ? parsed.hostname_prefixes : [],
      hostname_patterns: Array.isArray(parsed?.hostname_patterns) ? parsed.hostname_patterns : []
    };
  } catch {
    return {
      machine_ids: [],
      hostname_prefixes: [],
      hostname_patterns: []
    };
  }
}

function decorateMachineWithAssignment(machine) {
  const mapping = loadOwnerTeamMapping();
  const assignment = resolveOwnerTeamAssignment(machine, mapping);

  return {
    ...machine,
    owner_name: assignment?.owner_name ?? null,
    team_name: assignment?.team_name ?? null,
    company_annotations: buildCompanyAnnotations(assignment)
  };
}

function resolveOwnerTeamAssignment(machine, mapping) {
  const machineId = Number(machine.machine_id);
  const hostname = String(machine.hostname || "");

  const machineIdMatch = mapping.machine_ids.find((entry) => Number(entry.machine_id) === machineId);
  if (machineIdMatch) {
    return machineIdMatch;
  }

  const prefixMatch = mapping.hostname_prefixes.find((entry) => hostname.startsWith(String(entry.prefix || "")));
  if (prefixMatch) {
    return prefixMatch;
  }

  for (const entry of mapping.hostname_patterns) {
    try {
      const regex = new RegExp(String(entry.pattern || ""));
      if (regex.test(hostname)) {
        return entry;
      }
    } catch {
      // Ignore invalid private regex entries and continue.
    }
  }

  return null;
}

function buildCompanyAnnotations(assignment) {
  if (!assignment) {
    return [];
  }

  const annotations = [];
  if (assignment.owner_name) {
    annotations.push(`Owner: ${assignment.owner_name}`);
  }
  if (assignment.team_name) {
    annotations.push(`Team: ${assignment.team_name}`);
  }
  return annotations;
}

function formatAssignmentLabel(machine) {
  if (machine.owner_name && machine.team_name) {
    return `${machine.owner_name} / ${machine.team_name}`;
  }
  return machine.owner_name || machine.team_name || "unassigned";
}
