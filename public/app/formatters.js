export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function capitalize(value) {
  return String(value ?? "").charAt(0).toUpperCase() + String(value ?? "").slice(1);
}

export function formatDateWindow(start, end) {
  if (!start || !end) {
    return "unknown window";
  }

  return `${formatShortDate(start)} - ${formatShortDateExclusiveEnd(end)}`;
}

export function formatShortDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

export function formatShortDateExclusiveEnd(value) {
  const endDate = new Date(Date.parse(value) - 1);
  return formatShortDate(endDate);
}

export function monthKeyUtc(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabelUtc(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

export function formatChartTimestamp(value) {
  if (!value) {
    return "Unknown time";
  }
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatCurrency(value) {
  return `$${Number(value).toFixed(3)}`;
}

export function formatPriceShort(value) {
  return `$${Number(value).toFixed(2)}`;
}

export function formatSignedCurrency(value) {
  const amount = Math.abs(Number(value));
  const sign = Number(value) >= 0 ? "+" : "-";
  return `${sign}$${amount.toFixed(3)}`;
}

export function formatDuration(durationMs) {
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatReportTimestamp(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-GB", { month: "short" });
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${day} ${month}, ${year} ${hours}:${minutes}:${seconds}`;
}

export function formatMaintenanceWindows(windows) {
  const unique = new Map();
  for (const item of windows) {
    const start = Number(item.start_time);
    const durationHours = Number(item.duration_hours);
    const key = `${start}:${durationHours}`;
    if (!unique.has(key)) {
      unique.set(key, { start, durationHours });
    }
  }

  return Array.from(unique.values())
    .map(({ start, durationHours }) => {
      const startDate = formatReportTimestamp(start);
      const endDate = formatReportTimestamp(start + (durationHours * 60 * 60));
      return `Maintenance: ${startDate} - ${endDate} (${durationHours}h)`;
    })
    .join("\n");
}

export function todayUtcDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function shiftUtcDate(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getPriceChangePoints(history) {
  const changePoints = [];
  let previousPrice = null;

  for (const row of history) {
    if (typeof row.listed_gpu_cost !== "number") {
      continue;
    }

    if (previousPrice != null && row.listed_gpu_cost !== previousPrice) {
      const timeMs = Date.parse(row.polled_at);
      if (Number.isFinite(timeMs)) {
        changePoints.push({
          timeMs,
          value: row.listed_gpu_cost
        });
      }
    }

    previousPrice = row.listed_gpu_cost;
  }

  return changePoints.slice(-8);
}
