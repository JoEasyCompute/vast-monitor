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
    const hours = Math.max(1, Number(req.query.hours || 24));

    if (!Number.isFinite(machineId)) {
      res.status(400).json({ error: "machine_id is required" });
      return;
    }

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
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
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
  const machines = fleet.machines.map((machine) => ({
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
    uptime: machine.uptime
  }));

  const totalMachines = machines.length;
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
      totalGpus,
      occupiedGpus,
      utilisationPct,
      totalDailyEarnings: Number(totalDailyEarnings.toFixed(2))
    },
    gpuTypeBreakdown: breakdown,
    machines
  };
}
