import express from "express";
import path from "node:path";
import { fetchMachineEarnings, fetchMachineReports } from "./vast-client.js";

export function createServer({ config, db, monitor }) {
  const app = express();

  app.use(express.static(path.join(config.projectRoot, "public")));

  app.get("/api/status", (_req, res) => {
    const fleet = db.getCurrentFleetStatus();
    res.json(buildFleetResponse(fleet, config));
  });

  app.get("/api/health", (_req, res) => {
    const health = buildHealthResponse({ config, db, monitor });
    res.status(health.ok ? 200 : 503).json(health);
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

  app.get("/api/fleet/history", (req, res) => {
    const rawHours = req.query.hours == null ? 168 : Number(req.query.hours);
    if (!Number.isFinite(rawHours) || rawHours < 1) {
      res.status(400).json({ error: "hours must be a positive number" });
      return;
    }

    const hours = Math.min(24 * 365, Math.floor(rawHours));
    res.json({
      hours,
      history: db.getFleetHistory(hours)
    });
  });

  app.get("/api/gpu-type/price-history", (req, res) => {
    const rawHours = req.query.hours == null ? 168 : Number(req.query.hours);
    if (!Number.isFinite(rawHours) || rawHours < 1) {
      res.status(400).json({ error: "hours must be a positive number" });
      return;
    }

    const rawTop = req.query.top == null ? 6 : Number(req.query.top);
    if (!Number.isFinite(rawTop) || rawTop < 1) {
      res.status(400).json({ error: "top must be a positive number" });
      return;
    }

    const hours = Math.min(24 * 365, Math.floor(rawHours));
    const top = Math.min(12, Math.floor(rawTop));
    res.json(db.getGpuTypePriceHistory(hours, top));
  });

  app.get("/api/reports", async (req, res) => {
    const machineId = Number(req.query.machine_id);
    if (!Number.isFinite(machineId)) {
      res.status(400).json({ error: "machine_id is required" });
      return;
    }

    try {
      const reports = await fetchMachineReports(config, machineId);
      res.json({
        machine_id: machineId,
        reports
      });
    } catch (error) {
      res.status(502).json({
        error: "failed to fetch reports",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/earnings/machine", async (req, res) => {
    const machineId = Number(req.query.machine_id);
    const rawHours = req.query.hours == null ? 168 : Number(req.query.hours);
    if (!Number.isFinite(machineId)) {
      res.status(400).json({ error: "machine_id is required" });
      return;
    }
    if (!Number.isFinite(rawHours) || rawHours < 1) {
      res.status(400).json({ error: "hours must be a positive number" });
      return;
    }

    try {
      const hours = Math.min(24 * 365, Math.floor(rawHours));
      const earnings = await fetchMachineEarnings(config, machineId, hours);
      res.json(earnings);
    } catch (error) {
      res.status(502).json({
        error: "failed to fetch machine earnings",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
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

function buildFleetResponse(fleet, config) {
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
    listed: Boolean(machine.listed),
    listed_gpu_cost: machine.listed_gpu_cost,
    previous_listed_gpu_cost: machine.previous_listed_gpu_cost,
    price_changed_at: machine.price_changed_at,
    price_change_direction: machine.price_change_direction,
    previous_rentals: machine.previous_rentals,
    rentals_changed_at: machine.rentals_changed_at,
    rentals_change_direction: machine.rentals_change_direction,
    previous_reliability: machine.previous_reliability,
    reliability_changed_at: machine.reliability_changed_at,
    reliability_change_direction: machine.reliability_change_direction,
    previous_status: machine.previous_status,
    status_changed_at: machine.status_changed_at,
    status_change_direction: machine.status_change_direction,
    reliability: machine.reliability,
    gpu_max_cur_temp: machine.gpu_max_cur_temp,
    earn_day: machine.earn_day,
    num_reports: machine.num_reports || 0,
    num_recent_reports: machine.num_recent_reports,
    reports_changed: machine.reports_changed || 0,
    status: machine.status,
    error_message: sanitizeErrorMessage(machine.error_message),
    machine_maintenance: parseMaintenance(machine.machine_maintenance),
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
  const unlistedMachines = machines.reduce((sum, machine) => sum + (machine.listed ? 0 : 1), 0);
  const listedGpus = machines.reduce((sum, machine) => sum + (machine.listed ? machine.num_gpus || 0 : 0), 0);
  const unlistedGpus = machines.reduce((sum, machine) => sum + (machine.listed ? 0 : machine.num_gpus || 0), 0);
  const occupiedGpus = machines.reduce(
    (sum, machine) => sum + (machine.listed && machine.status === "online" ? machine.occupied_gpus || 0 : 0),
    0
  );
  const totalDailyEarnings = machines.reduce((sum, machine) => sum + (machine.earn_day || 0), 0);
  const utilisationPct = listedGpus > 0 ? Number(((occupiedGpus / listedGpus) * 100).toFixed(2)) : 0;

  const gpuTypes = new Map();
  for (const machine of machines) {
    const key = machine.gpu_type || "Unknown";
    const current = gpuTypes.get(key) || {
      gpu_type: key,
      machines: 0,
      listed_gpus: 0,
      unlisted_gpus: 0,
      occupied_gpus: 0,
      total_price_weighted: 0,
      priced_gpus: 0,
      earnings: 0
    };

    current.machines += 1;
    if (machine.listed) {
      const gpuCount = machine.num_gpus || 0;
      current.listed_gpus += gpuCount;
      current.occupied_gpus += machine.status === "online" ? machine.occupied_gpus || 0 : 0;
      if (typeof machine.listed_gpu_cost === "number" && gpuCount > 0) {
        current.total_price_weighted += machine.listed_gpu_cost * gpuCount;
        current.priced_gpus += gpuCount;
      }
    } else {
      current.unlisted_gpus += machine.num_gpus || 0;
    }
    current.earnings += machine.earn_day || 0;
    gpuTypes.set(key, current);
  }

  const breakdown = [...gpuTypes.values()].map((item) => ({
    gpu_type: item.gpu_type,
    machines: item.machines,
    listed_gpus: item.listed_gpus,
    unlisted_gpus: item.unlisted_gpus,
    utilisation_pct: item.listed_gpus > 0 ? Number(((item.occupied_gpus / item.listed_gpus) * 100).toFixed(2)) : 0,
    avg_price: item.priced_gpus > 0 ? Number((item.total_price_weighted / item.priced_gpus).toFixed(3)) : null,
    earnings: Number(item.earnings.toFixed(2))
  }));

  return {
    latestPollAt: fleet.latestPollAt,
    health: buildHealthStatus({
      latestPollAt: fleet.latestPollAt,
      pollIntervalMs: config.pollIntervalMs
    }),
    summary: {
      totalMachines,
      datacenterMachines,
      unlistedMachines,
      listedGpus,
      unlistedGpus,
      occupiedGpus,
      utilisationPct,
      totalDailyEarnings: Number(totalDailyEarnings.toFixed(2)),
      comparison24h: fleet.comparison24h ?? null
    },
    gpuTypeBreakdown: breakdown,
    machines
  };
}

function buildHealthResponse({ config, db, monitor }) {
  const latestPollAt = db.getCurrentFleetStatus().latestPollAt;
  const status = buildHealthStatus({
    latestPollAt,
    pollIntervalMs: config.pollIntervalMs
  });
  const monitorHealth = typeof monitor?.getHealthSnapshot === "function" ? monitor.getHealthSnapshot() : {};

  return {
    ok: !status.isStale,
    status: status.isStale ? "stale" : "ok",
    latestPollAt,
    pollIntervalMs: config.pollIntervalMs,
    staleThresholdMs: status.staleThresholdMs,
    pollAgeMs: status.pollAgeMs,
    ...monitorHealth
  };
}

function buildHealthStatus({ latestPollAt, pollIntervalMs }) {
  const staleThresholdMs = pollIntervalMs * 2;
  const pollAgeMs = latestPollAt ? Math.max(0, Date.now() - Date.parse(latestPollAt)) : null;
  const isStale = pollAgeMs == null || pollAgeMs > staleThresholdMs;

  return {
    isStale,
    pollAgeMs,
    staleThresholdMs
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

function parseMaintenance(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const IGNORED_ERROR_MESSAGES = new Set([
  "Error: machine does not support VMs."
]);
