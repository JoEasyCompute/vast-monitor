const FLEET_OFFLINE_EXCLUSION_MS = 24 * 60 * 60 * 1000;

export function getFleetEligibleMachines(machines, now = new Date()) {
  const uniqueMachines = dedupeMachinesByHostname(machines);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);

  return uniqueMachines.filter((machine) => isFleetEligibleMachine(machine, nowMs));
}

export function buildFleetAggregate(machines, now = new Date()) {
  const fleetMachines = getFleetEligibleMachines(machines, now);
  const totalMachines = fleetMachines.length;
  const datacenterMachines = fleetMachines.reduce((sum, machine) => sum + (machine.is_datacenter ? 1 : 0), 0);
  const unlistedMachines = fleetMachines.reduce((sum, machine) => sum + (machine.listed ? 0 : 1), 0);
  const listedGpus = fleetMachines.reduce((sum, machine) => sum + (machine.listed ? machine.num_gpus || 0 : 0), 0);
  const unlistedGpus = fleetMachines.reduce((sum, machine) => sum + (machine.listed ? 0 : machine.num_gpus || 0), 0);
  const occupiedGpus = fleetMachines.reduce(
    (sum, machine) => sum + (machine.listed && machine.status === "online" ? machine.occupied_gpus || 0 : 0),
    0
  );
  const utilisationPct = listedGpus > 0 ? Number(((occupiedGpus / listedGpus) * 100).toFixed(2)) : 0;
  const totalDailyEarnings = Number(
    fleetMachines.reduce((sum, machine) => sum + (machine.earn_day || 0), 0).toFixed(2)
  );

  return {
    machines: fleetMachines,
    summary: {
      total_machines: totalMachines,
      datacenter_machines: datacenterMachines,
      unlisted_machines: unlistedMachines,
      listed_gpus: listedGpus,
      unlisted_gpus: unlistedGpus,
      occupied_gpus: occupiedGpus,
      utilisation_pct: utilisationPct,
      total_daily_earnings: totalDailyEarnings
    }
  };
}

function dedupeMachinesByHostname(machines) {
  const byHostname = new Map();
  for (const machine of machines) {
    const existing = byHostname.get(machine.hostname);
    if (!existing || machine.machine_id > existing.machine_id) {
      byHostname.set(machine.hostname, machine);
    }
  }

  return [...byHostname.values()];
}

export function isFleetEligibleMachine(machine, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);

  if (machine.status !== "offline") {
    return true;
  }

  const offlineSinceMs = getOfflineSinceMs(machine);
  if (!Number.isFinite(offlineSinceMs)) {
    return true;
  }

  return (nowMs - offlineSinceMs) <= FLEET_OFFLINE_EXCLUSION_MS;
}

function getOfflineSinceMs(machine) {
  const candidates = [
    machine.last_online_at,
    machine.last_seen_at,
    machine.updated_at
  ];

  for (const value of candidates) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}
