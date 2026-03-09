import { fetchMachines } from "./vast-client.js";

export class FleetMonitor {
  constructor({ config, db, alertManager }) {
    this.config = config;
    this.db = db;
    this.alertManager = alertManager;
    this.intervalHandle = null;
    this.isPolling = false;
  }

  async start() {
    await this.poll();
    this.intervalHandle = setInterval(() => {
      this.poll().catch((error) => {
        console.error("Polling failed:", error);
      });
    }, this.config.pollIntervalMs);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async poll() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    const timestamp = new Date().toISOString();

    try {
            let rawMachines = await fetchMachines(this.config.vastCliPath);
      
      // Deduplicate by hostname, keeping only the highest machine_id
      const byHostname = new Map();
      for (const m of rawMachines) {
        if (!byHostname.has(m.hostname) || byHostname.get(m.hostname).machine_id < m.machine_id) {
          byHostname.set(m.hostname, m);
        }
      }
      rawMachines = Array.from(byHostname.values());
      const previousStates = new Map(this.db.getCurrentFleetStatus().machines.map((machine) => [machine.machine_id, machine]));
      const knownMachines = new Map(this.db.getKnownMachines().map((machine) => [machine.machine_id, machine]));
      const onlineMachines = [];
      const offlineMachines = [];
      const events = [];
      const alerts = [];

      for (const machine of rawMachines) {
        const previous = previousStates.get(machine.machine_id) || null;
        const { prev_day_reports, reports_changed } = resolveReportTracking(previous, machine, timestamp);
        const normalized = {
          ...machine,
          prev_day_reports,
          reports_changed,
          temp_alert_active: shouldKeepTempAlert(previous, machine, this.config.alertTempThreshold) ? 1 : 0,
          idle_alert_active: shouldKeepIdleAlert(previous, machine, this.config.alertIdleHours, timestamp) ? 1 : 0,
          idle_since: resolveIdleSince(previous, machine, timestamp)
        };

        onlineMachines.push({
          ...normalized,
          last_online_at: normalized.status === "online" ? timestamp : (previous?.last_online_at || null)
        });

        knownMachines.set(machine.machine_id, machine);

        const { nextEvents, nextAlerts } = buildChangeSet({
          previous,
          current: normalized,
          timestamp,
          config: this.config
        });

        events.push(...nextEvents);
        alerts.push(...nextAlerts);
      }

      for (const [machineId, registryMachine] of knownMachines.entries()) {
        if (rawMachines.some((machine) => machine.machine_id === machineId)) {
          continue;
        }

        const previous = previousStates.get(machineId) || null;
        const offline = {
          machine_id: machineId,
          hostname: previous?.hostname || registryMachine.hostname,
          gpu_type: previous?.gpu_type || registryMachine.gpu_type || null,
          num_gpus: previous?.num_gpus || registryMachine.num_gpus || 0,
          occupancy: "",
          occupied_gpus: 0,
          current_rentals_running: 0,
          listed_gpu_cost: previous?.listed_gpu_cost ?? null,
          reliability: previous?.reliability ?? null,
          gpu_max_cur_temp: null,
          earn_day: previous?.earn_day ?? null,
          num_reports: previous?.num_reports ?? 0,
          num_recent_reports: previous?.num_recent_reports ?? null,
          prev_day_reports: previous?.prev_day_reports ?? 0,
          reports_changed: 0,
          status: "offline",
          public_ipaddr: previous?.public_ipaddr ?? null,
          last_seen_at: previous?.last_seen_at ?? null,
          last_online_at: previous?.last_online_at ?? null,
          idle_since: previous?.idle_since || timestamp,
          temp_alert_active: 0,
          idle_alert_active: 0
        };

        offlineMachines.push(offline);

        if (previous?.status !== "offline") {
          const message = `${offline.hostname} went offline`;
          events.push(makeEvent(timestamp, offline, "host_down", "error", message, offline));
          alerts.push(makeAlert(timestamp, offline, "host_down", "error", message, offline));
        }

        if (previous && previous.current_rentals_running > 0) {
          const message = `${offline.hostname} lost rental activity while going offline`;
          events.push(makeEvent(timestamp, offline, "rental_lost", "warning", message, {
            previous_rentals: previous.current_rentals_running
          }));
        }
      }

      this.db.recordPoll({
        timestamp,
        machines: onlineMachines,
        offlineMachines,
        events,
        alerts
      });

      for (const alert of alerts) {
        await this.alertManager.send(alert);
      }

      console.log(`Poll complete at ${timestamp}: ${rawMachines.length} online machines`);
    } finally {
      this.isPolling = false;
    }
  }
}

function buildChangeSet({ previous, current, timestamp, config }) {
  const nextEvents = [];
  const nextAlerts = [];

  if (!previous || previous.status === "offline") {
    const message = `${current.hostname} came online`;
    nextEvents.push(makeEvent(timestamp, current, "host_up", "info", message, current));
    nextAlerts.push(makeAlert(timestamp, current, "host_up", "info", message, current));
  }

  if (previous) {
    if ((previous.current_rentals_running || 0) === 0 && current.current_rentals_running > 0) {
      nextEvents.push(makeEvent(timestamp, current, "rental_started", "info", `${current.hostname} started rental activity`, {
        current_rentals_running: current.current_rentals_running
      }));
    }

    if ((previous.current_rentals_running || 0) > 0 && current.current_rentals_running === 0) {
      nextEvents.push(makeEvent(timestamp, current, "rental_lost", "warning", `${current.hostname} lost rental activity`, {
        previous_rentals: previous.current_rentals_running
      }));
    }
  }

  if (current.reports_changed && previous && !previous.reports_changed) {
    const diff = current.num_reports - (previous.prev_day_reports || 0);
    const message = `${current.hostname} has ${diff > 0 ? diff : current.num_reports} new report(s) (total: ${current.num_reports})`;
    nextAlerts.push(makeAlert(timestamp, current, "new_reports", "warning", message, {
      num_reports: current.num_reports,
      prev_day_reports: current.prev_day_reports,
      num_recent_reports: current.num_recent_reports
    }));
  }

  if ((current.gpu_max_cur_temp ?? 0) >= config.alertTempThreshold && !previous?.temp_alert_active) {
    const message = `${current.hostname} GPU temperature reached ${current.gpu_max_cur_temp}C`;
    nextAlerts.push(makeAlert(timestamp, current, "high_temp", "warning", message, {
      threshold: config.alertTempThreshold,
      gpu_max_cur_temp: current.gpu_max_cur_temp
    }));
  }

  const idleHours = getIdleHours(current.idle_since, timestamp);
  if (idleHours >= config.alertIdleHours && !previous?.idle_alert_active && current.status === "online") {
    const message = `${current.hostname} has been idle for ${idleHours.toFixed(1)} hours`;
    nextAlerts.push(makeAlert(timestamp, current, "idle", "warning", message, {
      idle_hours: Number(idleHours.toFixed(2))
    }));
  }

  return { nextEvents, nextAlerts };
}

function resolveIdleSince(previous, current, timestamp) {
  if (current.current_rentals_running > 0) {
    return null;
  }

  if (previous?.current_rentals_running === 0 && previous?.idle_since) {
    return previous.idle_since;
  }

  return timestamp;
}

function shouldKeepTempAlert(previous, current, threshold) {
  if ((current.gpu_max_cur_temp ?? 0) >= threshold) {
    return true;
  }
  return false;
}

function shouldKeepIdleAlert(previous, current, idleHoursThreshold, timestamp) {
  if (current.current_rentals_running > 0) {
    return false;
  }

  const idleSince = resolveIdleSince(previous, current, timestamp);
  return getIdleHours(idleSince, timestamp) >= idleHoursThreshold;
}

function getIdleHours(idleSince, timestamp) {
  if (!idleSince) {
    return 0;
  }

  return (Date.parse(timestamp) - Date.parse(idleSince)) / (1000 * 60 * 60);
}

function resolveReportTracking(previous, current, timestamp) {
  const currentReports = current.num_reports || 0;

  if (!previous) {
    // First time seeing this machine — set baseline, no change flag
    return { prev_day_reports: currentReports, reports_changed: 0 };
  }

  let prevDayReports = previous.prev_day_reports || 0;

  // Reset prev_day_reports at midnight (if we crossed into a new day)
  const prevDate = previous.updated_at ? previous.updated_at.slice(0, 10) : null;
  const currentDate = timestamp.slice(0, 10);
  if (prevDate && prevDate !== currentDate) {
    // New day — snapshot current count as baseline for today
    prevDayReports = previous.num_reports || 0;
  }

  const reportsChanged = currentReports > prevDayReports ? 1 : 0;

  return { prev_day_reports: prevDayReports, reports_changed: reportsChanged };
}

function makeEvent(createdAt, machine, eventType, severity, message, payload) {
  return {
    created_at: createdAt,
    machine_id: machine.machine_id,
    hostname: machine.hostname,
    event_type: eventType,
    severity,
    message,
    payload_json: JSON.stringify(payload)
  };
}

function makeAlert(createdAt, machine, alertType, severity, message, payload) {
  return {
    created_at: createdAt,
    machine_id: machine.machine_id,
    hostname: machine.hostname,
    alert_type: alertType,
    severity,
    message,
    payload_json: JSON.stringify(payload)
  };
}
