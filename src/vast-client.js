import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function fetchMachines(vastCliPath) {
  const { stdout, stderr } = await execFileAsync(vastCliPath, ["show", "machines", "--raw"], {
    maxBuffer: 1024 * 1024 * 20
  });

  if (stderr && stderr.trim()) {
    console.error(stderr.trim());
  }

  const parsed = JSON.parse(stdout || "{}");
  const machines = Array.isArray(parsed?.machines) ? parsed.machines : [];

  return machines.map(normalizeMachine);
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
    num_reports: intOrNull(machine.num_reports),
    num_recent_reports: numberOrNull(machine.num_recent_reports),
    status: "online",
    temp_alert_active: 0,
    idle_alert_active: 0,
    idle_since: Number(machine.current_rentals_running || 0) > 0 ? null : new Date().toISOString()
  };
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value) {
  if (value == null) return 0;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
