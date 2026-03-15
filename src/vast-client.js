import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function fetchMachines(config) {
  const { vastCliPath } = config;
  const { stdout, stderr } = await execFileAsync(vastCliPath, ["show", "machines", "--raw"], {
    maxBuffer: 1024 * 1024 * 20
  });

  if (stderr && stderr.trim()) {
    console.error(stderr.trim());
  }

  const parsed = JSON.parse(stdout || "{}");
  const machines = Array.isArray(parsed?.machines) ? parsed.machines : [];
  const normalizedMachines = machines.map(normalizeMachine);
  let datacenterMetadata = {};
  try {
    datacenterMetadata = await fetchDatacenterMetadata(config, normalizedMachines.map((machine) => machine.machine_id));
  } catch (error) {
    console.error("Failed to enrich Vast datacenter metadata:", error.message);
  }

  return normalizedMachines.map((machine) => {
    const metadata = datacenterMetadata[String(machine.machine_id)] || null;
    const hostingType = metadata?.hosting_type ?? null;
    const hostId = metadata?.host_id ?? null;
    const isDatacenter = hostingType === 1;

    return {
      ...machine,
      host_id: hostId,
      hosting_type: hostingType,
      is_datacenter: isDatacenter ? 1 : 0,
      datacenter_id: isDatacenter ? hostId : null
    };
  });
}

export async function fetchMachineReports(config, machineId) {
  const { vastCliPath } = config;
  const { stdout, stderr } = await execFileAsync(vastCliPath, ["reports", String(machineId)], {
    maxBuffer: 1024 * 1024 * 20
  });

  if (stderr && stderr.trim()) {
    console.error(stderr.trim());
  }

  const trimmed = (stdout || "").trim();
  const jsonText = trimmed.startsWith("reports:") ? trimmed.slice("reports:".length).trim() : trimmed;
  const parsed = JSON.parse(jsonText || "[]");
  const reports = Array.isArray(parsed) ? parsed : [];

  return reports.map((report, index) => ({
    id: index,
    problem: cleanText(report.problem) || "Unknown",
    message: cleanText(report.message) || "",
    created_at: Number(report.created_at) || null
  }));
}

export async function fetchMachineEarnings(config, machineId, options = {}) {
  const { vastCliPath } = config;
  const window = resolveEarningsWindow(options);
  const { stdout, stderr } = await execFileAsync(vastCliPath, [
    "show",
    "earnings",
    "--raw",
    "-m",
    String(machineId),
    "-s",
    window.start.toISOString(),
    "-e",
    window.end.toISOString()
  ], {
    maxBuffer: 1024 * 1024 * 20
  });

  if (stderr && stderr.trim()) {
    console.error(stderr.trim());
  }

  const parsed = JSON.parse((stdout || "{}").trim() || "{}");
  const perDay = Array.isArray(parsed?.per_day) ? parsed.per_day : [];
  const perMachine = Array.isArray(parsed?.per_machine) ? parsed.per_machine : [];
  const currentMachine = perMachine.find((row) => Number(row.machine_id) === machineId) || perMachine[0] || null;

  const days = perDay
    .map((row) => ({
      day: normalizeEarningsDay(row.day),
      earnings: sumEarningsRow(row),
      gpu_earn: numberOrNull(row.gpu_earn) || 0,
      sto_earn: numberOrNull(row.sto_earn) || 0,
      bwu_earn: numberOrNull(row.bwu_earn) || 0,
      bwd_earn: numberOrNull(row.bwd_earn) || 0
    }))
    .filter((row) => row.day)
    .sort((a, b) => Date.parse(a.day) - Date.parse(b.day));

  return {
    machine_id: machineId,
    hours: window.hours,
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    total: resolveMachineEarningsTotal(currentMachine, days, options),
    gpu_earn: currentMachine ? (numberOrNull(currentMachine.gpu_earn) || 0) : 0,
    sto_earn: currentMachine ? (numberOrNull(currentMachine.sto_earn) || 0) : 0,
    bwu_earn: currentMachine ? (numberOrNull(currentMachine.bwu_earn) || 0) : 0,
    bwd_earn: currentMachine ? (numberOrNull(currentMachine.bwd_earn) || 0) : 0,
    days
  };
}

function resolveMachineEarningsTotal(currentMachine, days, options) {
  if (currentMachine) {
    return sumEarningsRow(currentMachine);
  }

  if (options?.requirePerMachineTotal) {
    return null;
  }

  return Number(days.reduce((sum, row) => sum + row.earnings, 0).toFixed(4));
}

function resolveEarningsWindow(options) {
  if (typeof options === "number") {
    const end = new Date();
    const start = new Date(end.getTime() - (options * 60 * 60 * 1000));

    return {
      start,
      end,
      hours: options
    };
  }

  const end = options.end ? new Date(options.end) : new Date();
  const start = options.start
    ? new Date(options.start)
    : new Date(end.getTime() - ((options.hours || 168) * 60 * 60 * 1000));
  const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);

  return {
    start,
    end,
    hours: Number.isFinite(hours) ? Number(hours.toFixed(2)) : null
  };
}

export function normalizeMachine(machine, now = new Date().toISOString()) {
  const occupancy = String(machine.gpu_occupancy || "").trim();
  const occupiedGpus = occupancy
    .split(/\s+/)
    .filter(Boolean)
    .filter((value) => value === "D")
    .length;

  return {
    machine_id: Number(machine.machine_id ?? machine.id),
    hostname: machine.hostname || `machine-${machine.machine_id ?? machine.id}`,
    gpu_type: machine.gpu_name || "Unknown",
    num_gpus: Number(machine.num_gpus || 0),
    occupancy,
    occupied_gpus: occupiedGpus,
    current_rentals_running: Number(machine.current_rentals_running || 0),
    listed: machine.listed === false ? 0 : 1,
    listed_gpu_cost: numberOrNull(machine.listed_gpu_cost),
    reliability: numberOrNull(machine.reliability2),
    gpu_max_cur_temp: numberOrNull(machine.gpu_max_cur_temp),
    earn_day: numberOrNull(machine.earn_day),
    num_reports: intOrZero(machine.num_reports),
    num_recent_reports: numberOrNull(machine.num_recent_reports),
    status: (machine.timeout && machine.timeout > 300) ? "offline" : "online",
    error_message: resolveErrorMessage(machine),
    machine_maintenance: serializeMaintenance(machine.machine_maintenance),
    public_ipaddr: machine.public_ipaddr || null,
    host_id: null,
    hosting_type: null,
    is_datacenter: 0,
    datacenter_id: null,
    temp_alert_active: 0,
    idle_alert_active: 0,
    idle_since: Number(machine.current_rentals_running || 0) > 0 ? null : now
  };
}

export async function fetchDatacenterMetadata(config, machineIds) {
  const ids = machineIds.filter(Number.isFinite);
  if (ids.length === 0) {
    return {};
  }

  const apiKey = readApiKey(config.vastApiKeyPath);
  if (!apiKey) {
    return {};
  }
  const metadataByMachineId = {};
  const batchSize = 100;

  for (let index = 0; index < ids.length; index += batchSize) {
    const offers = await fetchDatacenterMetadataBatch(config, apiKey, ids.slice(index, index + batchSize));

    for (const offer of offers) {
      const machineId = Number(offer.machine_id);
      if (!Number.isFinite(machineId)) {
        continue;
      }

      const candidate = {
        host_id: intOrNull(offer.host_id),
        hosting_type: intOrNull(offer.hosting_type)
      };
      const key = String(machineId);
      const existing = metadataByMachineId[key];
      if (!existing || shouldPreferDatacenterCandidate(existing, candidate)) {
        metadataByMachineId[key] = candidate;
      }
    }
  }

  return metadataByMachineId;
}

export async function fetchDatacenterMetadataBatch(config, apiKey, machineIds) {
  const response = await fetch(`${config.vastApiUrl}/bundles/?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      machine_id: { in: machineIds },
      order: [["score", "desc"]],
      type: "on-demand",
      allocated_storage: 5.0,
      rented: { eq: "any" },
      verified: { eq: "any" },
      external: { eq: true }
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Vast bundle metadata (${response.status})`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.offers) ? payload.offers : Array.isArray(payload) ? payload : [];
}

function shouldPreferDatacenterCandidate(existing, candidate) {
  if ((candidate.hosting_type ?? -1) > (existing.hosting_type ?? -1)) {
    return true;
  }

  if ((candidate.hosting_type ?? -1) === (existing.hosting_type ?? -1)) {
    return (candidate.host_id ?? -1) > (existing.host_id ?? -1);
  }

  return false;
}

function readApiKey(apiKeyPath) {
  try {
    return fs.readFileSync(apiKeyPath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumEarningsRow(row) {
  return Number((
    (numberOrNull(row.gpu_earn) || 0) +
    (numberOrNull(row.sto_earn) || 0) +
    (numberOrNull(row.bwu_earn) || 0) +
    (numberOrNull(row.bwd_earn) || 0)
  ).toFixed(4));
}

export function normalizeEarningsDay(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return `${trimmed.slice(0, 10)}T00:00:00.000Z`;
    }
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  // Vast machine-earnings uses "day" as days since Unix epoch.
  if (numeric > 1000 && numeric < 100000) {
    return new Date(numeric * 24 * 60 * 60 * 1000).toISOString();
  }

  if (numeric > 10_000_000_000) {
    return new Date(numeric).toISOString();
  }

  if (numeric > 1_000_000_000) {
    return new Date(numeric * 1000).toISOString();
  }

  const text = String(Math.trunc(numeric));
  if (text.length === 8) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00.000Z`;
  }

  return null;
}

function intOrNull(value) {
  if (value == null) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrZero(value) {
  if (value == null) return 0;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveErrorMessage(machine) {
  const primary = normalizeErrorMessage(machine.error_description);
  if (primary) {
    return primary;
  }

  return normalizeErrorMessage(machine.vm_error_msg);
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function serializeMaintenance(value) {
  return Array.isArray(value) && value.length > 0 ? JSON.stringify(value) : null;
}

function normalizeErrorMessage(value) {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  if (IGNORED_ERROR_MESSAGES.has(text)) {
    return null;
  }

  return text;
}

const IGNORED_ERROR_MESSAGES = new Set([
  "Error: machine does not support VMs."
]);
