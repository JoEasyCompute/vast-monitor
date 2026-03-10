import express from "express";
import path from "node:path";

export function createServer({ config, db }) {
  const app = express();

  app.use(express.static(path.join(config.projectRoot, "public")));

  app.get("/api/status", (_req, res) => {
    const fleet = db.getCurrentFleetStatus();
    res.json(buildFleetResponse(fleet));
  });

  app.get("/api/history", (req, res) => {
    const machineId = Number(req.query.machine_id);
    const rawHours = req.query.hours == null ? 24 : Number(req.query.hours);

    if (!Number.isFinite(machineId)) {
      res.status(400).json({ error: "machine_id is required" });
      return;
    }

    if (!Number.isFinite(rawHours) || rawHours < 1) {
      res.status(400).json({ error: "hours must be a positive number" });
      return;
    }

    const hours = Math.floor(rawHours);

    res.json({
      machine_id: machineId,
      hours,
      history: db.getMachineHistory(machineId, hours)
    });
  });

  app.get("/api/earnings/hourly", (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    res.json(db.getHourlyEarnings(date));
  });

  app.get("/api/alerts", (req, res) => {
    const rawLimit = req.query.limit == null ? 50 : Number(req.query.limit);
    if (!Number.isFinite(rawLimit) || rawLimit < 1) {
      res.status(400).json({ error: "limit must be a positive number" });
      return;
    }

    const limit = Math.min(500, Math.floor(rawLimit));
    res.json({
      alerts: db.getRecentAlerts(limit)
    });
  });

  app.get("/", (_req, res) => {
    res.sendFile(path.join(config.projectRoot, "public/index.html"));
  });

  return app;
}

function buildFleetResponse(fleet) {
  // Deduplicate machines by hostname to avoid double counting old offline machine IDs
  const byHostname = new Map();
  for (const m of fleet.machines) {
    const existing = byHostname.get(m.hostname);
    if (!existing || m.machine_id > existing.machine_id) {
      byHostname.set(m.hostname, m);
    }
  }
  const uniqueMachines = Array.from(byHostname.values());

  const machines = uniqueMachines.map((machine) => ({
    machine_id: machine.machine_id,
    hostname: machine.hostname,
    gpu_type: machine.gpu_type,
    num_gpus: machine.num_gpus,
    occupancy: machine.occupancy || "",
    occupied_gpus: machine.occupied_gpus || 0,
    current_rentals_running: machine.current_rentals_running || 0,
    listed_gpu_cost: machine.listed_gpu_cost,
    reliability: machine.reliability,
    gpu_max_cur_temp: machine.gpu_max_cur_temp,
    earn_day: machine.earn_day,
    num_reports: machine.num_reports || 0,
    num_recent_reports: machine.num_recent_reports,
    reports_changed: machine.reports_changed || 0,
    status: machine.status,
    error_message: sanitizeErrorMessage(machine.error_message),
    last_online_at: machine.last_online_at,
    public_ipaddr: machine.public_ipaddr,
    host_id: machine.host_id,
    hosting_type: machine.hosting_type,
    is_datacenter: Boolean(machine.is_datacenter),
    datacenter_id: machine.datacenter_id,
    uptime: machine.uptime
  }));

  const totalMachines = machines.length;
  const datacenterMachines = machines.reduce((sum, machine) => sum + (machine.is_datacenter ? 1 : 0), 0);
  const totalGpus = machines.reduce((sum, machine) => sum + (machine.num_gpus || 0), 0);
  const occupiedGpus = machines.reduce((sum, machine) => sum + (machine.status === "online" ? machine.occupied_gpus || 0 : 0), 0);
  const totalDailyEarnings = machines.reduce((sum, machine) => sum + (machine.earn_day || 0), 0);
  const utilisationPct = totalGpus > 0 ? Number(((occupiedGpus / totalGpus) * 100).toFixed(2)) : 0;

  const gpuTypes = new Map();
  for (const machine of machines) {
    const key = machine.gpu_type || "Unknown";
    const current = gpuTypes.get(key) || {
      gpu_type: key,
      machines: 0,
      gpus: 0,
      occupied_gpus: 0,
      total_price: 0,
      priced_machines: 0,
      earnings: 0
    };

    current.machines += 1;
    current.gpus += machine.num_gpus || 0;
    current.occupied_gpus += machine.status === "online" ? machine.occupied_gpus || 0 : 0;
    current.earnings += machine.earn_day || 0;
    if (typeof machine.listed_gpu_cost === "number") {
      current.total_price += machine.listed_gpu_cost;
      current.priced_machines += 1;
    }
    gpuTypes.set(key, current);
  }

  const breakdown = [...gpuTypes.values()].map((item) => ({
    gpu_type: item.gpu_type,
    machines: item.machines,
    gpus: item.gpus,
    utilisation_pct: item.gpus > 0 ? Number(((item.occupied_gpus / item.gpus) * 100).toFixed(2)) : 0,
    avg_price: item.priced_machines > 0 ? Number((item.total_price / item.priced_machines).toFixed(3)) : null,
    earnings: Number(item.earnings.toFixed(2))
  }));

  return {
    latestPollAt: fleet.latestPollAt,
    summary: {
      totalMachines,
      datacenterMachines,
      totalGpus,
      occupiedGpus,
      utilisationPct,
      totalDailyEarnings: Number(totalDailyEarnings.toFixed(2))
    },
    gpuTypeBreakdown: breakdown,
    machines
  };
}

function sanitizeErrorMessage(message) {
  const text = String(message ?? "").trim();
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
