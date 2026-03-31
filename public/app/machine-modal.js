import {
  capitalize,
  escapeHtml,
  formatChartTimestamp,
  formatCurrency,
  formatDateWindow,
  formatMonthLabelUtc,
  formatPriceShort,
  formatSignedCurrency,
  monthKeyUtc
} from "./formatters.js";

export function formatGpuMachineLabel(machine) {
  const gpuCount = machine?.num_gpus ?? null;
  const gpuType = machine?.gpu_type || "Unknown";
  return Number.isFinite(gpuCount) ? `${gpuCount}x${gpuType}` : gpuType;
}

export function buildModalSummaryMarkup(machine, machineHistory = []) {
  const operationalItems = [
    ["Status", renderModalStatus(machine)],
    ["Renter Total / Rentals", renderModalRenterSummary(machine, machineHistory)],
    ["Reliability", machine.reliability == null ? "-" : renderModalReliability(machine)],
    ["Temp", escapeHtml(machine.gpu_max_cur_temp == null ? "-" : `${machine.gpu_max_cur_temp}C`)],
    ["Uptime 24h", escapeHtml(machine.uptime?.["24h"] == null ? "-" : `${machine.uptime["24h"]}%`)]
  ];
  if (machine.owner_name) {
    operationalItems.push(["Owner", escapeHtml(machine.owner_name)]);
  }
  if (machine.team_name) {
    operationalItems.push(["Team", escapeHtml(machine.team_name)]);
  }
  const commercialItems = [
    ["Price", machine.listed_gpu_cost == null ? "-" : renderSummaryPrice(machine)],
    ["Earn/day", escapeHtml(machine.earn_day == null ? "-" : formatPriceShort(machine.earn_day))]
  ];

  return `
    ${renderModalSummarySection("Operational", operationalItems)}
    ${renderModalSummarySection("Commercial", commercialItems)}
  `;
}

export function buildModalAnnotationsMarkup(machine) {
  const annotations = Array.isArray(machine?.company_annotations)
    ? machine.company_annotations.filter((value) => String(value ?? "").trim())
    : [];

  if (!annotations.length) {
    return "";
  }

  return `
    <div class="modal-summary-section-title">Annotations</div>
    ${annotations.map((value) => `
      <article class="modal-summary-card">
        <span>${escapeHtml(value)}</span>
      </article>
    `).join("")}
  `;
}

export function buildCalendarMonthEarningsSummaries(machineHistory = [], monthlySummary = null, now = new Date()) {
  const realizedMonths = Array.isArray(monthlySummary?.months) ? monthlySummary.months : [];
  if (realizedMonths.length > 0) {
    return realizedMonths.map((month) => ({
      label: month.label,
      total: Number.isFinite(Number(month.total)) ? Number(month.total) : null,
      badge: "Real.",
      badgeClass: "realized",
      comparisonLabel: month.comparison_label || null,
      comparisonMetric: month.comparison || null,
      title: `Source: Vast CLI per_machine total. Window: ${formatDateWindow(month.start, month.end)}. Comparison window: ${formatDateWindow(month.comparison_start, month.comparison_end)}`
    }));
  }

  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const estimatedTotals = aggregateEstimatedCalendarMonthRows(machineHistory, [previousMonthStart, currentMonthStart]);

  return [previousMonthStart, currentMonthStart].map((monthStart) => {
    const key = monthKeyUtc(monthStart);
    const estimatedTotal = estimatedTotals.get(key);

    return {
      label: `${formatMonthLabelUtc(monthStart)} (est)`,
      total: estimatedTotal,
      badge: "Est.",
      badgeClass: "estimated",
      comparisonLabel: null,
      comparisonMetric: null,
      title: "Source: local machine snapshot earn_day history"
    };
  });
}

export function buildModalTimelineEvents(history) {
  const events = [];

  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];

    if (current.status !== previous.status) {
      events.push({
        time: current.polled_at,
        label: current.status === "online" ? "Back online" : "Went offline",
        detail: `Status changed from ${previous.status} to ${current.status}`,
        severity: current.status === "online" ? "good" : "warn"
      });
    }

    if (current.current_rentals_running !== previous.current_rentals_running) {
      events.push({
        time: current.polled_at,
        label: "Renter count changed",
        detail: `${previous.current_rentals_running ?? 0} -> ${current.current_rentals_running ?? 0} renters`,
        severity: (current.current_rentals_running ?? 0) > (previous.current_rentals_running ?? 0) ? "good" : "neutral"
      });
    }

    if (typeof current.listed_gpu_cost === "number" && typeof previous.listed_gpu_cost === "number" && current.listed_gpu_cost !== previous.listed_gpu_cost) {
      events.push({
        time: current.polled_at,
        label: "Price changed",
        detail: `${formatCurrency(previous.listed_gpu_cost)} -> ${formatCurrency(current.listed_gpu_cost)} per GPU`,
        severity: current.listed_gpu_cost > previous.listed_gpu_cost ? "good" : "neutral"
      });
    }

    if (typeof current.reliability === "number" && typeof previous.reliability === "number") {
      const delta = Number(((current.reliability - previous.reliability) * 100).toFixed(1));
      if (Math.abs(delta) >= 0.5) {
        events.push({
          time: current.polled_at,
          label: "Reliability changed",
          detail: `${(previous.reliability * 100).toFixed(1)}% -> ${(current.reliability * 100).toFixed(1)}%`,
          severity: delta > 0 ? "good" : "warn"
        });
      }
    }
  }

  return events
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, 8);
}

export function buildModalTimelineMarkup(history) {
  const events = buildModalTimelineEvents(history);
  if (!events.length) {
    return "";
  }

  return `
    <div class="modal-timeline-title">Recent Events</div>
    <div class="modal-timeline-list">
      ${events.map((event) => `
        <article class="timeline-item">
          <time>${escapeHtml(formatChartTimestamp(event.time))}</time>
          <strong class="timeline-${event.severity}">${escapeHtml(event.label)}</strong>
          <p>${escapeHtml(event.detail)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

export function buildModalEarningsBreakdownMarkup(earningsData) {
  const items = [
    ["GPU", earningsData?.gpu_earn],
    ["Storage", earningsData?.sto_earn],
    ["BW Up/Down", sumBandwidthEarnings(earningsData)]
  ].filter(([, value]) => Number.isFinite(value));

  if (!items.length) {
    return "";
  }

  return items
    .map(([label, value]) => `
      <article class="modal-summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatPriceShort(value))}</strong>
      </article>
    `)
    .join("");
}

export function sumBandwidthEarnings(earningsData) {
  const up = Number(earningsData?.bwu_earn);
  const down = Number(earningsData?.bwd_earn);
  const total = (Number.isFinite(up) ? up : 0) + (Number.isFinite(down) ? down : 0);
  return Number.isFinite(total) ? total : null;
}

export function buildDependencyFailureMessage(payload, prefix) {
  return [
    prefix,
    payload?.dependency?.health?.detail,
    summarizeDependencyDetail(payload?.detail || payload?.error)
  ].filter(Boolean).join(" ");
}

export function summarizeDependencyDetail(detail) {
  const text = String(detail ?? "").trim();
  if (!text) {
    return "";
  }

  const tracebackIndex = text.indexOf("Traceback");
  const withoutTraceback = tracebackIndex >= 0 ? text.slice(0, tracebackIndex).trim() : text;
  const firstLine = withoutTraceback.split("\n").map((line) => line.trim()).find(Boolean) || text.split("\n").map((line) => line.trim()).find(Boolean) || "";
  return firstLine;
}

export function hasLocalEstimatedEarningsHistory(machineHistory) {
  return Array.isArray(machineHistory) && machineHistory.some((row) => typeof row?.earn_day === "number");
}

export function computeRenterTotal(machineHistory = []) {
  const history = Array.isArray(machineHistory) ? machineHistory : [];
  if (!history.length) {
    return null;
  }

  const normalized = history
    .map((row) => ({
      polledAtMs: Date.parse(row?.polled_at),
      renters: Number(row?.current_rentals_running)
    }))
    .filter((row) => Number.isFinite(row.polledAtMs) && Number.isFinite(row.renters))
    .sort((a, b) => a.polledAtMs - b.polledAtMs);

  if (!normalized.length) {
    return null;
  }

  let total = normalized[0].renters;
  for (let index = 1; index < normalized.length; index += 1) {
    const delta = normalized[index].renters - normalized[index - 1].renters;
    if (delta > 0) {
      total += delta;
    }
  }

  return total;
}

function formatRenterTotal(machineHistory) {
  const value = computeRenterTotal(machineHistory);
  return value == null ? "-" : String(value);
}

function renderSummaryPrice(machine) {
  const currentPrice = formatCurrency(machine.listed_gpu_cost);
  if (machine.price_change_direction === "none" || typeof machine.previous_listed_gpu_cost !== "number") {
    return currentPrice;
  }

  return `${currentPrice} ${machine.price_change_direction === "up" ? "↑" : "↓"} ${formatSignedCurrency(machine.listed_gpu_cost - machine.previous_listed_gpu_cost)}`;
}

function renderModalSummarySection(title, items) {
  return `
    <div class="modal-summary-section-title">${escapeHtml(title)}</div>
    ${items.map(([label, value]) => `
      <article class="modal-summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${value}</strong>
      </article>
    `).join("")}
  `;
}

function renderModalStatus(machine) {
  return `<span class="modal-inline-value">
    <span class="status-pill ${machine.status}">${escapeHtml(machine.status || "-")}</span>
    ${renderModalDeltaText(machine.status_change_direction, machine.previous_status, machine.status, "status")}
  </span>`;
}

function renderModalRentals(machine) {
  return `<span class="modal-inline-value">
    <span>${machine.current_rentals_running ?? 0}</span>
    ${renderModalDeltaText(
      machine.rentals_change_direction,
      machine.previous_rentals,
      machine.current_rentals_running,
      "renters"
    )}
  </span>`;
}

function renderModalRenterSummary(machine, machineHistory) {
  const renterTotal = formatRenterTotal(machineHistory);
  return `<span class="modal-inline-value">
    <span>${escapeHtml(renterTotal)}</span>
    <span class="modal-inline-value">
      <span>${machine.current_rentals_running ?? 0}</span>
      ${renderModalDeltaText(
        machine.rentals_change_direction,
        machine.previous_rentals,
        machine.current_rentals_running,
        "renters"
      )}
    </span>
  </span>`;
}

function renderModalReliability(machine) {
  const current = machine.reliability * 100;
  const previous = typeof machine.previous_reliability === "number" ? machine.previous_reliability * 100 : null;
  return `<span class="modal-inline-value">
    <span>${current.toFixed(1)}%</span>
    ${renderModalDeltaText(
      machine.reliability_change_direction,
      previous,
      current,
      "reliability",
      (value) => `${Number(value).toFixed(1)}%`
    )}
  </span>`;
}

function renderModalDeltaText(direction, previousValue, currentValue, label, formatter = (value) => String(value)) {
  if (direction === "none" || previousValue == null || currentValue == null) {
    return '<small class="modal-delta-text modal-delta-flat">stable</small>';
  }

  return `<small class="modal-delta-text modal-delta-${direction}">
    ${direction === "up" ? "↑" : "↓"} ${escapeHtml(formatter(previousValue))} -> ${escapeHtml(formatter(currentValue))}
  </small>`;
}

function aggregateEstimatedCalendarMonthRows(machineHistory, monthStarts) {
  const totals = new Map(monthStarts.map((date) => [monthKeyUtc(date), null]));
  const latestByDay = new Map();

  for (const row of Array.isArray(machineHistory) ? machineHistory : []) {
    const timeMs = Date.parse(row.polled_at);
    const earnDay = Number(row.earn_day);
    if (!Number.isFinite(timeMs) || !Number.isFinite(earnDay)) {
      continue;
    }

    const dayKey = new Date(timeMs).toISOString().slice(0, 10);
    const existing = latestByDay.get(dayKey);
    if (!existing || timeMs > existing.timeMs) {
      latestByDay.set(dayKey, { timeMs, earnDay });
    }
  }

  for (const [dayKey, value] of latestByDay.entries()) {
    const timeMs = Date.parse(`${dayKey}T00:00:00.000Z`);
    const pointDate = new Date(timeMs);
    const monthStart = new Date(Date.UTC(pointDate.getUTCFullYear(), pointDate.getUTCMonth(), 1));
    const monthKey = monthKeyUtc(monthStart);
    if (!totals.has(monthKey)) {
      continue;
    }

    const current = totals.get(monthKey) ?? 0;
    totals.set(monthKey, Number((current + value.earnDay).toFixed(4)));
  }

  return totals;
}
