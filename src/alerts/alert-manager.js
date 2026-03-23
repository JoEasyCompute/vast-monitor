export class AlertManager {
  constructor(channels = [], options = {}) {
    this.channels = channels;
    this.defaultCooldownMs = minutesToMs(options.defaultCooldownMinutes ?? 60);
    this.hostnameCollisionCooldownMs = minutesToMs(options.hostnameCollisionCooldownMinutes ?? 360);
    this.lastSentByKey = new Map();
  }

  async send(alert) {
    if (!this.shouldSend(alert)) {
      return false;
    }

    for (const channel of this.channels) {
      await channel.send(alert);
    }

    this.markSent(alert);
    return true;
  }

  shouldSend(alert) {
    const cooldownMs = this.getCooldownMs(alert);
    if (!cooldownMs) {
      return true;
    }

    const key = buildAlertDedupKey(alert);
    if (!key) {
      return true;
    }

    const sentAtMs = this.lastSentByKey.get(key);
    const createdAtMs = Date.parse(alert?.created_at || "");
    const nowMs = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();

    return !Number.isFinite(sentAtMs) || (nowMs - sentAtMs) >= cooldownMs;
  }

  markSent(alert) {
    const cooldownMs = this.getCooldownMs(alert);
    if (!cooldownMs) {
      return;
    }

    const key = buildAlertDedupKey(alert);
    if (!key) {
      return;
    }

    const createdAtMs = Date.parse(alert?.created_at || "");
    this.lastSentByKey.set(key, Number.isFinite(createdAtMs) ? createdAtMs : Date.now());
  }

  getCooldownMs(alert) {
    if (alert?.alert_type === "hostname_collision") {
      return this.hostnameCollisionCooldownMs;
    }

    if (RATE_LIMITED_ALERT_TYPES.has(alert?.alert_type)) {
      return this.defaultCooldownMs;
    }

    return 0;
  }
}

const RATE_LIMITED_ALERT_TYPES = new Set([
  "new_reports",
  "high_temp",
  "idle"
]);

function buildAlertDedupKey(alert) {
  const type = alert?.alert_type || "";
  const machineId = alert?.machine_id ?? "";
  const hostname = alert?.hostname || "";
  const message = alert?.message || "";
  if (!type || (!machineId && !hostname && !message)) {
    return null;
  }

  return [type, machineId, hostname, message].join("|");
}

function minutesToMs(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 0;
  }

  return minutes * 60 * 1000;
}
