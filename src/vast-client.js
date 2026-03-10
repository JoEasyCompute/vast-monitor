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
    const hostingType = metadata?.hosting_type ?? machine.hosting_type ?? null;
    const hostId = metadata?.host_id ?? machine.host_id ?? null;
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

function normalizeMachine(machine) {
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
    listed_gpu_cost: numberOrNull(machine.listed_gpu_cost),
    reliability: numberOrNull(machine.reliability2),
    gpu_max_cur_temp: numberOrNull(machine.gpu_max_cur_temp),
    earn_day: numberOrNull(machine.earn_day),
    num_reports: intOrZero(machine.num_reports),
    num_recent_reports: numberOrNull(machine.num_recent_reports),
    status: (machine.timeout && machine.timeout > 300) ? "offline" : "online",
    public_ipaddr: machine.public_ipaddr || null,
    host_id: intOrNull(machine.host_id),
    hosting_type: intOrNull(machine.hosting_type),
    is_datacenter: Number(machine.hosting_type) === 1 ? 1 : 0,
    datacenter_id: Number(machine.hosting_type) === 1 ? intOrNull(machine.host_id) : null,
    temp_alert_active: 0,
    idle_alert_active: 0,
    idle_since: Number(machine.current_rentals_running || 0) > 0 ? null : new Date().toISOString()
  };
}

async function fetchDatacenterMetadata(config, machineIds) {
  const ids = machineIds.filter(Number.isFinite);
  if (ids.length === 0) {
    return {};
  }

  const apiKey = readApiKey(config.vastApiKeyPath);
  if (!apiKey) {
    return {};
  }
  const metadataByMachineId = {};

  for (const machineId of ids) {
    const offers = await fetchDatacenterMetadataBatch(config, apiKey, [machineId]);

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

async function fetchDatacenterMetadataBatch(config, apiKey, machineIds) {
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
