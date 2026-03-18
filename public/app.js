const summaryGrid = document.getElementById("summary-grid");
const summaryCompareGrid = document.getElementById("summary-compare-grid");
const breakdownBody = document.getElementById("breakdown-body");
const machinesBody = document.getElementById("machines-body");
const machinesEmptyState = document.getElementById("machines-empty-state");
const alertsList = document.getElementById("alerts-list");
const lastUpdated = document.getElementById("last-updated");
const hourlyChart = document.getElementById("hourly-chart");
const earningsTotal = document.getElementById("earnings-total");
const earningsDate = document.getElementById("earnings-date");
const earningsPrevButton = document.getElementById("earnings-prev");
const earningsNextButton = document.getElementById("earnings-next");
const staleWarning = document.getElementById("stale-warning");
const healthBadge = document.getElementById("health-badge");
const trendRange = document.getElementById("trend-range");
const trendGpusChart = document.getElementById("trend-gpus-chart");
const trendFleetChart = document.getElementById("trend-fleet-chart");
const trendUtilChart = document.getElementById("trend-util-chart");
const trendUtilGpuSelect = document.getElementById("trend-util-gpu-select");
const trendPriceChart = document.getElementById("trend-price-chart");
const filterSearch = document.getElementById("filter-search");
const filterStatus = document.getElementById("filter-status");
const filterListed = document.getElementById("filter-listed");
const filterDc = document.getElementById("filter-dc");
const filterErrors = document.getElementById("filter-errors");
const filterReports = document.getElementById("filter-reports");
const filterMaint = document.getElementById("filter-maint");
const filterReset = document.getElementById("filter-reset");
const densityToggle = document.getElementById("density-toggle");
const machinesScroll = document.getElementById("machines-scroll");
const machineViewTabs = document.getElementById("machine-view-tabs");
const settingsButton = document.getElementById("settings-button");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsClose = document.getElementById("settings-close");
const settingsDensity = document.getElementById("settings-density");
const settingsReliability = document.getElementById("settings-reliability");
const settingsTemperature = document.getElementById("settings-temperature");
const settingsStaleMinutes = document.getElementById("settings-stale-minutes");
const settingsReset = document.getElementById("settings-reset");

const DEFAULT_UI_SETTINGS = {
  tableDensity: "comfortable",
  lowReliabilityPct: 90,
  highTemperatureC: 85,
  stalePollMinutes: 15,
  selectedUtilizationGpuType: "__fleet__"
};
const UI_SETTINGS_KEY = "vast-monitor-ui-settings";
const MACHINE_FILTERS_KEY = "vast-monitor-machine-filters";
let uiSettings = loadUiSettings();

let currentMachinesData = [];
let sortCol = "hostname";
let sortDesc = false;
let selectedEarningsDate = todayUtcDateString();
let selectedTrendHours = 168;
let currentMachineHistoryId = null;
let currentMachineHistoryHours = 168;
let currentReports = [];
let currentReportIndex = 0;
const chartSyncGroups = new Map();
let latestFleetHistoryPayload = null;
let latestGpuTypePricePayload = null;
let latestHourlyEarningsPayload = null;
let lastKnownHealth = null;
let selectedUtilizationGpuType = uiSettings.selectedUtilizationGpuType || "__fleet__";
let currentModalMachine = null;
let currentModalHistory = [];
let currentModalEarningsData = null;
let currentModalTab = "charts";
let activeMachineView = "active";
initializeStateFromUrl();

async function loadDashboard() {
  const [statusResponse, alertsResponse, earningsResponse, fleetHistoryResponse, gpuTypePriceResponse] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/alerts?limit=10"),
    fetch(`/api/earnings/hourly?date=${selectedEarningsDate}`),
    fetch(`/api/fleet/history?hours=${selectedTrendHours}`),
    fetch(`/api/gpu-type/price-history?hours=${selectedTrendHours}&top=6`)
  ]);

  const status = await statusResponse.json();
  const alertsPayload = await alertsResponse.json();
  const earningsPayload = await earningsResponse.json();
  const fleetHistoryPayload = await fleetHistoryResponse.json();
  const gpuTypePricePayload = await gpuTypePriceResponse.json();
  latestHourlyEarningsPayload = earningsPayload;
  latestFleetHistoryPayload = fleetHistoryPayload;
  latestGpuTypePricePayload = gpuTypePricePayload;

  currentMachinesData = status.machines;

  renderSummary(status.summary);
  renderSummaryComparison(status.summary?.comparison24h);
  renderBreakdown(status.gpuTypeBreakdown);
  renderFleetTrends(latestFleetHistoryPayload);
  renderGpuTypePriceTrends(latestGpuTypePricePayload);
  renderHourlyEarnings(latestHourlyEarningsPayload);
  renderMachinesSorted();
  renderAlerts(alertsPayload.alerts);
  lastKnownHealth = status.health;
  renderHealth(status.health);
  lastUpdated.textContent = status.latestPollAt
    ? `Last updated ${new Date(status.latestPollAt).toLocaleString()}`
    : "No poll data yet";

  if (currentMachineHistoryId != null && !modalBackdrop.classList.contains("hidden")) {
    showMachineHistory(currentMachineHistoryId, { preserveScroll: true }).catch((error) => console.error(error));
  }
}

function handleSort(col) {
  if (sortCol === col) {
    sortDesc = !sortDesc;
  } else {
    sortCol = col;
    sortDesc = false;
  }
  persistStateToUrl();
  updateSortHeaders();
  renderMachinesSorted();
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === sortCol) {
      th.classList.add(sortDesc ? "sort-desc" : "sort-asc");
    }
  });
}

function renderMachinesSorted() {
  const sorted = getSortedMachines();
  renderMachines(sorted);
  renderMachineEmptyState(sorted.length);
  updateMachineViewTabs();
  updateModalNavigation();
}

function getFilteredMachines() {
  const searchTerm = filterSearch.value.trim().toLowerCase();

  return getMachinesForActiveView().filter((row) => {
    if (searchTerm) {
      const haystack = [
        row.hostname,
        row.gpu_type,
        row.machine_id
      ].join(" ").toLowerCase();

      if (!haystack.includes(searchTerm)) {
        return false;
      }
    }

    if (filterStatus.value !== "all" && row.status !== filterStatus.value) {
      return false;
    }

    if (filterListed.value === "listed" && !row.listed) {
      return false;
    }

    if (filterListed.value === "unlisted" && row.listed) {
      return false;
    }

    if (filterDc.value === "dc" && !row.is_datacenter) {
      return false;
    }

    if (filterDc.value === "non-dc" && row.is_datacenter) {
      return false;
    }

    if (filterErrors.checked && !row.error_message) {
      return false;
    }

    if (filterReports.checked && !row.has_new_report_72h) {
      return false;
    }

    if (filterMaint.checked && (!Array.isArray(row.machine_maintenance) || row.machine_maintenance.length === 0)) {
      return false;
    }

    return true;
  });
}

function getMachinesForActiveView() {
  return currentMachinesData.filter((row) => isArchivedMachine(row) === (activeMachineView === "archived"));
}

function isArchivedMachine(row) {
  if (row.status !== "offline") {
    return false;
  }

  const offlineSinceMs = resolveOfflineSinceMs(row);
  if (!Number.isFinite(offlineSinceMs)) {
    return false;
  }

  return (Date.now() - offlineSinceMs) > (24 * 60 * 60 * 1000);
}

function resolveOfflineSinceMs(row) {
  const candidates = [row.last_online_at, row.last_seen_at, row.updated_at];
  for (const value of candidates) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getSortedMachines() {
  return [...getFilteredMachines()].sort((a, b) => {
    let valA = a[sortCol];
    let valB = b[sortCol];

    if (sortCol === "uptime") {
      valA = a.uptime?.["24h"] ?? -1;
      valB = b.uptime?.["24h"] ?? -1;
    }

    if (valA == null) valA = "";
    if (valB == null) valB = "";

    if (typeof valA === "string" && typeof valB === "string") {
      return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
    }

    return sortDesc ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
  });
}

function renderSummary(summary) {
  const comparison = summary?.comparison24h ?? null;
  const items = [
    { label: "Total machines", value: summary.totalMachines },
    { label: "DC Tagged", value: summary.datacenterMachines },
    { label: "Unlisted", value: summary.unlistedMachines },
    { label: "Listed GPUs", value: summary.listedGpus, comparisonLabel: "Listed GPUs vs 24h", comparisonMetric: comparison?.listed_gpus },
    { label: "Unlisted GPUs", value: summary.unlistedGpus },
    { label: "Occupied GPUs", value: summary.occupiedGpus },
    { label: "Utilisation", value: `${summary.utilisationPct}%`, comparisonLabel: "Utilisation vs 24h", comparisonMetric: comparison?.utilisation_pct },
    { label: "Daily earnings", value: `$${summary.totalDailyEarnings.toFixed(2)}`, comparisonLabel: "Daily earnings vs 24h", comparisonMetric: comparison?.total_daily_earnings }
  ];

  summaryGrid.innerHTML = items
    .map((item) => `
      <article class="stat-card ${item.comparisonMetric ? "stat-card-compare" : ""}">
        <span class="stat-label">${escapeHtml(item.label)}</span>
        <strong class="stat-value">${escapeHtml(String(item.value))}</strong>
        ${item.comparisonMetric ? `
          <div class="stat-compare compare-${getComparisonDirection(item.comparisonMetric.delta)}">
            <span class="stat-compare-label">${escapeHtml(item.comparisonLabel)}</span>
            <strong class="stat-compare-value">${escapeHtml(formatComparisonDelta(item.label, item.comparisonMetric.delta))}</strong>
            ${item.comparisonMetric.pct_delta == null ? "" : `<small class="stat-compare-pct">${escapeHtml(`${item.comparisonMetric.pct_delta > 0 ? "+" : ""}${item.comparisonMetric.pct_delta}%`)}</small>`}
          </div>
        ` : ""}
      </article>
    `)
    .join("");
}

function renderSummaryComparison(comparison) {
  if (summaryCompareGrid) {
    summaryCompareGrid.innerHTML = "";
  }
}

function formatComparisonDelta(label, delta) {
  if (delta == null) {
    return "No comparison";
  }

  if (label === "Avg Listed Price" || label === "Daily Earnings") {
    return formatSignedCurrency(delta);
  }

  if (label === "Utilisation") {
    return `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%`;
  }

  return `${delta > 0 ? "+" : ""}${Math.round(delta)}`;
}

function getComparisonDirection(delta) {
  if (delta == null || delta === 0) {
    return "flat";
  }
  return delta > 0 ? "up" : "down";
}

function renderBreakdown(rows) {
  breakdownBody.innerHTML = rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.gpu_type)}</td>
        <td class="breakdown-num-col">${row.machines}</td>
        <td class="breakdown-gpus-col">${row.listed_gpus}/${row.unlisted_gpus}</td>
        <td><span class="util-chip ${utilClass(row.utilisation_pct)}">${row.utilisation_pct}%</span></td>
        <td class="breakdown-num-col">${row.avg_price == null ? "-" : `$${row.avg_price.toFixed(3)}`}</td>
        <td class="breakdown-num-col">$${row.earnings.toFixed(2)}</td>
      </tr>
    `)
    .join("");
}

function renderMachines(rows) {
  machinesBody.innerHTML = rows
    .map((row, index) => {
      const reliabilityScore = row.reliability != null ? row.reliability * 100 : null;
      const isLowReliability = reliabilityScore != null && reliabilityScore < uiSettings.lowReliabilityPct;
      const isHot = row.gpu_max_cur_temp != null && row.gpu_max_cur_temp >= uiSettings.highTemperatureC;
      const hasError = Boolean(row.error_message);
      const rowClass = [hasError ? "machine-error" : "", isLowReliability ? "low-reliability" : "", isHot ? "high-temperature" : ""]
        .filter(Boolean)
        .join(" ");
      
      return `
      <tr class="machine-row ${rowClass}" onclick="showMachineRow(event, ${row.machine_id})">
        <td class="muted">${index + 1}</td>
        <td class="muted">#${row.machine_id}</td>
        <td class="dc-cell">${renderDatacenter(row)}</td>
        <td class="listed-cell">${renderListed(row)}</td>
        <td class="maint-cell">${renderMaintenanceCheckbox(row)}</td>
        <td>${escapeHtml(row.hostname)}</td>
        <td>${escapeHtml(row.gpu_type)}</td>
        <td>${row.num_gpus}</td>
        <td>${renderOccupancy(row)}</td>
        <td>${renderPriceCell(row)}</td>
        <td>${renderRentalsCell(row)}</td>
        <td>${row.gpu_max_cur_temp == null ? "-" : `${row.gpu_max_cur_temp}C`}</td>
        <td>${renderReports(row)}</td>
        <td>${renderReliabilityCell(row, reliabilityScore)}</td>
        <td>${row.uptime?.["24h"] == null ? "-" : `${row.uptime["24h"]}%`}</td>
        <td>${renderStatusCell(row)}</td>
      </tr>
    `})
    .join("");
}

function renderMachineEmptyState(count) {
  if (!machinesEmptyState) {
    return;
  }

  if (count > 0) {
    machinesEmptyState.textContent = "";
    machinesEmptyState.classList.add("hidden");
    return;
  }

  const hasFilters = Boolean(
    filterSearch.value.trim()
    || filterStatus.value !== "all"
    || filterListed.value !== "all"
    || filterDc.value !== "all"
    || filterErrors.checked
    || filterReports.checked
    || filterMaint.checked
  );

  machinesEmptyState.textContent = hasFilters
    ? `No ${activeMachineView === "archived" ? "archived" : "main-view"} machines match the current filters.`
    : activeMachineView === "archived"
      ? "No archived machines yet."
      : "No machines in the main view.";
  machinesEmptyState.classList.remove("hidden");
}

function updateMachineViewTabs() {
  if (!machineViewTabs) {
    return;
  }

  const activeCount = currentMachinesData.filter((row) => !isArchivedMachine(row)).length;
  const archivedCount = currentMachinesData.length - activeCount;

  machineViewTabs.querySelectorAll("[data-tab]").forEach((button) => {
    const isActive = button.dataset.tab === activeMachineView;
    button.classList.toggle("active", isActive);

    if (button.dataset.tab === "archived") {
      button.textContent = `Archived (${archivedCount})`;
    } else {
      button.textContent = `Main View (${activeCount})`;
    }
  });
}

function renderPriceCell(row) {
  if (row.listed_gpu_cost == null) {
    return "-";
  }

  const direction = row.price_change_direction;
  const delta = typeof row.previous_listed_gpu_cost === "number"
    ? row.listed_gpu_cost - row.previous_listed_gpu_cost
    : null;
  const changeLabel = direction === "up" ? "↑" : direction === "down" ? "↓" : "•";
  const changeClass = direction === "up" ? "price-up" : direction === "down" ? "price-down" : "price-flat";
  const title = delta == null || direction === "none"
    ? "No recent price change"
    : `Changed ${direction === "up" ? "up" : "down"} ${formatSignedCurrency(delta)} since ${formatChartTimestamp(row.price_changed_at)}`;

  return `<span class="price-cell">
    <span>${formatPriceShort(row.listed_gpu_cost)}</span>
    <span class="price-chip ${changeClass}" title="${escapeHtml(title)}">${changeLabel}</span>
  </span>`;
}

function renderRentalsCell(row) {
  return `<span class="delta-cell">
    <span>${row.current_rentals_running ?? 0}</span>
    ${renderDeltaChip(
      row.rentals_change_direction,
      row.previous_rentals,
      row.current_rentals_running,
      row.rentals_changed_at,
      "renters"
    )}
  </span>`;
}

function renderReliabilityCell(row, reliabilityScore) {
  if (reliabilityScore == null) {
    return "-";
  }

  const previous = typeof row.previous_reliability === "number" ? row.previous_reliability * 100 : null;
  return `<span class="delta-cell">
    <span>${reliabilityScore.toFixed(1)}%</span>
    ${renderDeltaChip(
      row.reliability_change_direction,
      previous,
      reliabilityScore,
      row.reliability_changed_at,
      "reliability",
      (value) => `${Number(value).toFixed(1)}%`
    )}
  </span>`;
}

function renderStatusCell(row) {
  return `<span class="delta-cell" title="${escapeHtml(getStatusTooltip(row))}">
    <span class="status-pill ${row.status}">${row.status}</span>
    ${renderDeltaChip(
      row.status_change_direction,
      row.previous_status,
      row.status,
      row.status_changed_at,
      "status"
    )}
  </span>`;
}

function renderDeltaChip(direction, previousValue, currentValue, changedAt, label, formatter = (value) => String(value)) {
  const changeLabel = direction === "up" ? "↑" : direction === "down" ? "↓" : "•";
  const changeClass = direction === "up" ? "delta-up" : direction === "down" ? "delta-down" : "delta-flat";
  const title = !changedAt
    ? `No recent ${label} change`
    : `${capitalize(label)} changed from ${formatter(previousValue)} to ${formatter(currentValue)} at ${formatChartTimestamp(changedAt)}`;

  return `<span class="price-chip ${changeClass}" title="${escapeHtml(title)}">${changeLabel}</span>`;
}

function renderModalSummary(machine) {
  const operationalItems = [
    ["Status", renderModalStatus(machine)],
    ["Rentals", renderModalRentals(machine)],
    ["Reliability", machine.reliability == null ? "-" : renderModalReliability(machine)],
    ["Temp", escapeHtml(machine.gpu_max_cur_temp == null ? "-" : `${machine.gpu_max_cur_temp}C`)],
    ["Uptime 24h", escapeHtml(machine.uptime?.["24h"] == null ? "-" : `${machine.uptime["24h"]}%`)]
  ];
  const commercialItems = [
    ["Price", machine.listed_gpu_cost == null ? "-" : renderSummaryPrice(machine)],
    ["Earn/day", escapeHtml(machine.earn_day == null ? "-" : formatPriceShort(machine.earn_day))]
  ];

  modalSummary.innerHTML = `
    ${renderModalSummarySection("Operational", operationalItems)}
    ${renderModalSummarySection("Commercial", commercialItems)}
  `;
}

function formatGpuMachineLabel(machine) {
  const gpuCount = machine?.num_gpus ?? null;
  const gpuType = machine?.gpu_type || "Unknown";
  return Number.isFinite(gpuCount) ? `${gpuCount}x${gpuType}` : gpuType;
}

function renderModalHeader(machineId, machine = null) {
  const dcTag = machine?.is_datacenter ? ' <span class="dc-pill">DC</span>' : "";
  const gpuTag = machine ? ` <span class="modal-header-gpu">${escapeHtml(formatGpuMachineLabel(machine))}</span>` : "";
  const ipTag = machine?.public_ipaddr
    ? ` <button class="modal-header-ip" type="button" title="Copy IP address" onclick="copyMachineIpAddress('${escapeHtml(machine.public_ipaddr)}')">${escapeHtml(machine.public_ipaddr)}</button>`
    : "";
  modalTitle.innerHTML = `Machine #${escapeHtml(String(machineId))}${dcTag}${gpuTag}${ipTag}`;
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

function updateModalEarningsSummary(machine, earningsData, machineHistory = [], monthlySummary = null) {
  if (!machine) {
    return;
  }

  const cards = [];
  if (earningsData && Number.isFinite(earningsData.total)) {
    const baseLabel = currentMachineHistoryHours <= 24 ? "24H EARN" : currentMachineHistoryHours <= 168 ? "7D EARN" : "30D EARN";
    cards.push({
      label: baseLabel,
      value: formatPriceShort(earningsData.total),
      badge: earningsData.source === "estimated" ? "Est." : "Real.",
      badgeClass: earningsData.source === "estimated" ? "estimated" : "realized",
      title: earningsData.source === "estimated"
        ? "Source: local machine snapshot earn_day history"
        : `Source: Vast CLI earnings response for ${formatDateWindow(earningsData.start, earningsData.end)}`
    });
  }

  cards.push(...buildCalendarMonthEarningsSummaries(earningsData, machineHistory, monthlySummary).map((item) => ({
    label: item.label,
    value: item.total == null ? "-" : formatPriceShort(item.total),
    badge: item.badge,
    badgeClass: item.badgeClass,
    comparisonLabel: item.comparisonLabel,
    comparisonMetric: item.comparisonMetric,
    title: item.title
  })));

  if (!cards.length) {
    return;
  }

  modalSummary.insertAdjacentHTML("beforeend", cards.map((card) => renderModalSummaryCard(card)).join(""));
}

function buildCalendarMonthEarningsSummaries(_earningsData, machineHistory = [], monthlySummary = null) {
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

  const now = new Date();
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

function renderModalSummaryCard({ label, value, badge = null, badgeClass = "", comparisonLabel = null, comparisonMetric = null, title = "" }) {
  if (!comparisonMetric) {
    return `
      <article class="modal-summary-card" title="${escapeHtml(title)}">
        <span>${escapeHtml(label)}${badge ? ` <em class="summary-badge ${escapeHtml(badgeClass)}">${escapeHtml(badge)}</em>` : ""}</span>
        <strong>${escapeHtml(value)}</strong>
      </article>
    `;
  }

  return `
    <article class="modal-summary-card modal-summary-card-compare" title="${escapeHtml(title)}">
      <span class="stat-label">${escapeHtml(label)}${badge ? ` <em class="summary-badge ${escapeHtml(badgeClass)}">${escapeHtml(badge)}</em>` : ""}</span>
      <strong class="stat-value">${escapeHtml(value)}</strong>
      <div class="stat-compare compare-${getComparisonDirection(comparisonMetric.delta)}">
        <span class="stat-compare-label">${escapeHtml(comparisonLabel)}</span>
        <strong class="stat-compare-value">${escapeHtml(formatComparisonDelta("Daily Earnings", comparisonMetric.delta))}</strong>
        ${comparisonMetric.pct_delta == null ? "" : `<small class="stat-compare-pct">${escapeHtml(`${comparisonMetric.pct_delta > 0 ? "+" : ""}${comparisonMetric.pct_delta}%`)}</small>`}
      </div>
    </article>
  `;
}

function formatDateWindow(start, end) {
  if (!start || !end) {
    return "unknown window";
  }

  return `${formatShortDate(start)} - ${formatShortDateExclusiveEnd(end)}`;
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatShortDateExclusiveEnd(value) {
  const endDate = new Date(Date.parse(value) - 1);
  return formatShortDate(endDate);
}

function monthKeyUtc(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabelUtc(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
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

function renderModalTimeline(history) {
  if (!modalTimeline) {
    return;
  }

  const events = buildMachineTimeline(history);
  if (!events.length) {
    modalTimeline.innerHTML = "";
    modalTimeline.classList.add("hidden");
    return;
  }

  modalTimeline.innerHTML = `
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
  modalTimeline.classList.remove("hidden");
}

function setModalTab(tabName) {
  currentModalTab = tabName === "events" ? "events" : "charts";
  modalTabs.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === currentModalTab);
  });
  modalTabCharts.classList.toggle("active", currentModalTab === "charts");
  modalTabEvents.classList.toggle("active", currentModalTab === "events");

  if (currentModalTab === "charts") {
    redrawChartsForCurrentLayout();
  }
}

function buildMachineTimeline(history) {
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

function updateModalEarningsPresentation(earningsData) {
  const isRealized = Array.isArray(earningsData?.days) && earningsData.days.length > 0;
  const title = isRealized ? "Historical Earnings" : "Historical Earnings (Estimated)";
  const note = isRealized
    ? "Realized daily earnings from Vast"
    : "Estimated from stored earn/day snapshots";

  earningsChartTitle.textContent = title;
  earningsChartNote.textContent = note;
}

function renderModalEarningsBreakdown(earningsData) {
  if (!modalEarningsBreakdown) {
    return;
  }

  const items = [
    ["GPU", earningsData?.gpu_earn],
    ["Storage", earningsData?.sto_earn],
    ["BW Up/Down", sumBandwidthEarnings(earningsData)]
  ].filter(([, value]) => Number.isFinite(value));

  if (!items.length) {
    modalEarningsBreakdown.innerHTML = "";
    return;
  }

  modalEarningsBreakdown.innerHTML = items
    .map(([label, value]) => `
      <article class="modal-summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatPriceShort(value))}</strong>
      </article>
    `)
    .join("");
}

function sumBandwidthEarnings(earningsData) {
  const up = Number(earningsData?.bwu_earn);
  const down = Number(earningsData?.bwd_earn);
  const total = (Number.isFinite(up) ? up : 0) + (Number.isFinite(down) ? down : 0);
  return Number.isFinite(total) ? total : null;
}

function getStatusTooltip(row) {
  if (row.status === "online") return "Online";
  if (!row.last_online_at) return "Offline (duration unknown)";
  
  const diffMs = Date.now() - new Date(row.last_online_at).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `Offline for ${diffMins} min`;
  
  const diffHours = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  if (diffHours < 24) return `Offline for ${diffHours}h ${remMins}m`;
  
  const diffDays = Math.floor(diffHours / 24);
  const remHours = diffHours % 24;
  return `Offline for ${diffDays}d ${remHours}h`;
}

function renderHourlyEarnings(data) {
  const currentHour = new Date().getUTCHours();
  const maxEarnings = Math.max(...data.hours.map((h) => h.earnings), 0.01);
  const isToday = data.date === todayUtcDateString();

  earningsTotal.textContent = `$${data.total.toFixed(2)}`;
  earningsDate.textContent = data.date;
  earningsNextButton.disabled = isToday;

  hourlyChart.innerHTML = data.hours
    .map((h) => {
      const pct = Math.max((h.earnings / maxEarnings) * 100, 0);
      const isFuture = isToday && h.hour > currentHour;
      const barClass = isFuture ? "hour-bar future" : "hour-bar";
      return `
        <div class="hour-bar-wrap">
          <span class="hour-amount">$${h.earnings.toFixed(2)}</span>
          <div class="hour-bar-track">
            <div class="${barClass}" style="height: ${isFuture ? 0 : Math.max(pct, 1.5)}%"></div>
          </div>
          <span class="hour-label">${String(h.hour).padStart(2, "0")}</span>
        </div>
      `;
    })
    .join("");
}

function renderAlerts(rows) {
  if (rows.length === 0) {
    alertsList.innerHTML = '<p class="muted">No alerts yet.</p>';
    return;
  }

  alertsList.innerHTML = rows
    .map((row) => `
      <article class="alert-item ${row.severity}">
        <div>
          <strong>${escapeHtml(row.hostname || "fleet")}</strong>
          <p>${escapeHtml(row.message)}</p>
        </div>
        <time>${new Date(row.created_at).toLocaleString()}</time>
      </article>
    `)
    .join("");
}

function renderHealth(health) {
  healthBadge.className = "health-badge";
  const staleThresholdMs = uiSettings.stalePollMinutes * 60 * 1000;
  const isStale = health?.pollAgeMs != null ? health.pollAgeMs >= staleThresholdMs : Boolean(health?.isStale);

  if (isStale) {
    healthBadge.textContent = "Stale";
    healthBadge.classList.add("stale");
  } else if (health?.liveOperationsOk === false) {
    healthBadge.textContent = "Degraded";
    healthBadge.classList.add("degraded");
  } else if (health?.pollAgeMs != null && health.pollAgeMs < 30 * 1000) {
    healthBadge.textContent = "Polling";
    healthBadge.classList.add("polling");
  } else {
    healthBadge.textContent = "Healthy";
    healthBadge.classList.add("healthy");
  }

  if (!isStale) {
    staleWarning.classList.add("hidden");
    staleWarning.textContent = "";
    return;
  }

  const ageText = health.pollAgeMs == null
    ? "No successful poll has completed yet."
    : `Last successful poll is ${formatDuration(health.pollAgeMs)} old (threshold ${uiSettings.stalePollMinutes} min).`;
  staleWarning.textContent = `Stale data warning. ${ageText}`;
  staleWarning.classList.remove("hidden");
}

function renderFleetTrends(payload) {
  const history = Array.isArray(payload?.history) ? payload.history : [];
  drawMultiSeriesChart(trendGpusChart, history, [
    { key: "listed_gpus", label: "Listed GPUs", color: "#60a5fa" },
    { key: "unlisted_gpus", label: "Unlisted GPUs", color: "#f59e0b" }
  ], { formatValue: (value) => `${Math.round(value)}` });

  drawMultiSeriesChart(trendFleetChart, history, [
    { key: "total_machines", label: "Machines", color: "#22c55e" },
    { key: "unlisted_machines", label: "Unlisted", color: "#f59e0b" },
    { key: "datacenter_machines", label: "DC", color: "#60a5fa" }
  ], { formatValue: (value) => `${Math.round(value)}` });

  const utilizationHistory = normalizeGpuTypeUtilizationHistory(payload);
  updateUtilizationSelector(utilizationHistory);

  const selectedSeries = utilizationHistory.series.find((item) => item.key === selectedUtilizationGpuType)
    || utilizationHistory.series[0]
    || { key: "utilisation_pct", label: "Fleet", color: "#f43f5e" };

  drawMultiSeriesChart(trendUtilChart, utilizationHistory.history, [selectedSeries], {
    min: 0,
    max: 100,
    formatValue: (value) => `${Math.round(value)}%`
  });
}

function renderGpuTypePriceTrends(payload) {
  const normalized = normalizeGpuTypePriceHistory(payload);
  if (!normalized.history.length || !normalized.series.length) {
    trendPriceChart.innerHTML = `<text x="360" y="90" text-anchor="middle" class="chart-empty">No GPU-type price history yet</text>`;
    return;
  }

  drawMultiSeriesChart(trendPriceChart, normalized.history, normalized.series, {
    formatValue: (value) => formatCurrency(value)
  });
}

function normalizeGpuTypePriceHistory(payload) {
  const palette = ["#34d399", "#60a5fa", "#f59e0b", "#f43f5e", "#a78bfa", "#f97316"];
  const rowsByBucket = new Map();
  const series = Array.isArray(payload?.series) ? payload.series : [];

  series.forEach((item, index) => {
    const key = `gpu_type_price_${index}`;
    item.points.forEach((point) => {
      const row = rowsByBucket.get(point.bucket_start) || { polled_at: point.bucket_start };
      row[key] = point.avg_price;
      rowsByBucket.set(point.bucket_start, row);
    });
  });

  const history = [...rowsByBucket.values()].sort((a, b) => Date.parse(a.polled_at) - Date.parse(b.polled_at));
  const chartSeries = series.map((item, index) => ({
    key: `gpu_type_price_${index}`,
    label: item.gpu_type,
    color: palette[index % palette.length]
  }));

  return { history, series: chartSeries };
}

function normalizeGpuTypeUtilizationHistory(payload) {
  const historyRows = Array.isArray(payload?.history) ? payload.history : [];
  const gpuTypeSeries = Array.isArray(payload?.gpu_type_utilization) ? payload.gpu_type_utilization : [];
  const rowsByTimestamp = new Map(
    historyRows.map((row) => [row.polled_at, { polled_at: row.polled_at, utilisation_pct: row.utilisation_pct }])
  );
  const palette = ["#34d399", "#60a5fa", "#f59e0b", "#a78bfa", "#f97316"];

  gpuTypeSeries.forEach((series, index) => {
    const key = `gpu_type_util_${index}`;
    series.points.forEach((point) => {
      const row = rowsByTimestamp.get(point.polled_at) || { polled_at: point.polled_at };
      row[key] = point.utilisation_pct;
      rowsByTimestamp.set(point.polled_at, row);
    });
  });

  const history = [...rowsByTimestamp.values()].sort((a, b) => Date.parse(a.polled_at) - Date.parse(b.polled_at));
  const series = [
    { key: "__fleet__", sourceKey: "utilisation_pct", label: "Total fleet", color: "#f43f5e" },
    ...gpuTypeSeries.map((item, index) => ({
      key: `gpu_type_util_${index}`,
      label: item.gpu_type,
      sourceKey: `gpu_type_util_${index}`,
      color: palette[index % palette.length]
    }))
  ];

  return { history, series };
}

function updateUtilizationSelector(utilizationHistory) {
  if (!trendUtilGpuSelect) {
    return;
  }

  const series = Array.isArray(utilizationHistory?.series) ? utilizationHistory.series : [];
  const availableKeys = new Set(series.map((item) => item.key));
  if (!availableKeys.has(selectedUtilizationGpuType)) {
    selectedUtilizationGpuType = "__fleet__";
  }

  trendUtilGpuSelect.innerHTML = series
    .map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`)
    .join("");

  trendUtilGpuSelect.value = selectedUtilizationGpuType;
}

function drawMultiSeriesChart(svg, history, series, options = {}) {
  const width = 720;
  const height = 180;
  const padding = { top: 18, right: 16, bottom: 24, left: 34 };

  if (!history.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">No data yet</text>`;
    return;
  }

  const points = history
    .map((row) => ({ ...row, timeMs: Date.parse(row.polled_at) }))
    .filter((row) => Number.isFinite(row.timeMs));

  if (!points.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">No data yet</text>`;
    return;
  }

  const minTime = points[0].timeMs;
  const maxTime = points[points.length - 1].timeMs;
  const timeSpan = Math.max(1, maxTime - minTime);
  const values = points.flatMap((row) => series
    .map((item) => Number(row[item.sourceKey || item.key]))
    .filter((value) => Number.isFinite(value)));
  const minValue = options.min ?? 0;
  const maxValue = options.max ?? Math.max(1, ...values);
  const valueSpan = Math.max(1, maxValue - minValue);
  const scaleX = (timeMs) => padding.left + ((timeMs - minTime) / timeSpan) * (width - padding.left - padding.right);
  const scaleY = (value) => height - padding.bottom - ((value - minValue) / valueSpan) * (height - padding.top - padding.bottom);

  const tickCount = 4;
  let svgContent = "";

  for (let index = 0; index <= tickCount; index += 1) {
    const value = minValue + (valueSpan * index) / tickCount;
    const y = scaleY(value);
    svgContent += `<g class="trend-axis">
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />
      <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(options.formatValue ? options.formatValue(value) : value.toFixed(0))}</text>
    </g>`;
  }

  for (const item of series) {
    const valueKey = item.sourceKey || item.key;
    const seriesPoints = points.filter((row) => Number.isFinite(Number(row[valueKey])));
    if (!seriesPoints.length) {
      continue;
    }
    const path = buildLinePath(
      seriesPoints,
      (row) => scaleX(row.timeMs),
      (row) => scaleY(Number(row[valueKey]))
    );

    svgContent += `<path d="${path}" class="trend-line" style="stroke:${item.color}" />`;
  }

  const startLabel = new Date(minTime).toLocaleDateString();
  const endLabel = new Date(maxTime).toLocaleDateString();
  svgContent += `<g class="trend-axis">
    <text x="${padding.left}" y="${height - 4}" text-anchor="start">${escapeHtml(startLabel)}</text>
    <text x="${width - padding.right}" y="${height - 4}" text-anchor="end">${escapeHtml(endLabel)}</text>
  </g>`;

  svgContent += `<g class="trend-legend">`;
  series.forEach((item, index) => {
    const x = padding.left + (index * 150);
    svgContent += `<g transform="translate(${x}, 10)">
      <rect x="0" y="-8" width="14" height="3" rx="2" fill="${item.color}" />
      <text x="20" y="-4">${escapeHtml(item.label)}</text>
    </g>`;
  });
  svgContent += `</g>`;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = svgContent;
  attachChartHover(svg, {
    width,
    height,
    padding,
    points,
    scaleX: (row) => scaleX(row.timeMs),
    series: series.map((item) => ({
      label: item.label,
      color: item.color,
      getValue: (row) => {
        const value = Number(row[item.sourceKey || item.key]);
        return Number.isFinite(value) ? value : null;
      },
      getY: (row) => {
        const value = Number(row[item.sourceKey || item.key]);
        return Number.isFinite(value) ? scaleY(value) : null;
      },
      formatValue: (value) => options.formatValue ? options.formatValue(value) : value.toFixed(0)
    }))
  });
}

function renderOccupancy(row) {
  if (!row.occupancy) {
    if (row.status === "offline") {
      return '<span class="muted">offline</span>';
    }

    if ((row.current_rentals_running || 0) > 0) {
      return `<span class="muted">${row.current_rentals_running} rental${row.current_rentals_running === 1 ? "" : "s"}</span>`;
    }

    return '<span class="muted">-</span>';
  }

  return row.occupancy
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `<span class="gpu-slot ${token === "D" ? "occupied" : "free"}">${escapeHtml(token)}</span>`)
    .join("");
}

function renderReports(row) {
  const count = row.num_reports || 0;
  if (count === 0) return '<span class="muted">0</span>';
  if (row.reports_changed) {
    return `<span class="report-badge changed" title="New reports since yesterday">⚠ ${count}</span>`;
  }
  return `<span class="report-badge">${count}</span>`;
}

function renderDatacenter(row) {
  if (row.is_datacenter) {
    return '<span class="dc-pill">DC</span>';
  }

  return "";
}

function renderMaintenanceCheckbox(row) {
  const checked = Array.isArray(row.machine_maintenance) && row.machine_maintenance.length > 0 ? "checked" : "";
  return `<input class="maint-checkbox" type="checkbox" disabled ${checked} />`;
}

function renderListed(row) {
  if (row.listed) {
    return '<span class="listed-pill">On</span>';
  }

  return '<span class="muted">-</span>';
}

function utilClass(value) {
  if (value > 80) return "high";
  if (value >= 50) return "medium";
  return "low";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function initializeStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const savedMachineFilters = loadMachineFilters();

  sortCol = params.get("sort") || sortCol;
  sortDesc = params.get("desc") === "1";

  const trendHours = Number(params.get("trend_hours"));
  if (Number.isFinite(trendHours) && trendHours > 0) {
    selectedTrendHours = trendHours;
  }

  const earningsDate = params.get("earnings_date");
  if (earningsDate && /^\d{4}-\d{2}-\d{2}$/.test(earningsDate)) {
    selectedEarningsDate = earningsDate;
  }

  filterSearch.value = params.has("search") ? (params.get("search") || "") : savedMachineFilters.search;
  filterStatus.value = params.has("status") ? (params.get("status") || "all") : savedMachineFilters.status;
  filterListed.value = params.has("listed") ? (params.get("listed") || "all") : savedMachineFilters.listed;
  filterDc.value = params.has("dc") ? (params.get("dc") || "all") : savedMachineFilters.dc;
  filterErrors.checked = params.has("errors") ? params.get("errors") === "1" : savedMachineFilters.errors;
  filterReports.checked = params.has("reports") ? params.get("reports") === "1" : savedMachineFilters.reports;
  filterMaint.checked = params.has("maint") ? params.get("maint") === "1" : savedMachineFilters.maint;
  activeMachineView = params.has("machine_tab")
    ? (params.get("machine_tab") === "archived" ? "archived" : "active")
    : savedMachineFilters.machineTab;

  trendRange.querySelectorAll("[data-hours]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.hours) === selectedTrendHours);
  });

  applyUiSettings();
  saveMachineFilters();
}

function persistStateToUrl() {
  const params = new URLSearchParams();
  if (sortCol && sortCol !== "hostname") params.set("sort", sortCol);
  if (sortDesc) params.set("desc", "1");
  if (selectedTrendHours !== 168) params.set("trend_hours", String(selectedTrendHours));
  if (selectedEarningsDate !== todayUtcDateString()) params.set("earnings_date", selectedEarningsDate);
  if (filterSearch.value.trim()) params.set("search", filterSearch.value.trim());
  if (filterStatus.value !== "all") params.set("status", filterStatus.value);
  if (filterListed.value !== "all") params.set("listed", filterListed.value);
  if (filterDc.value !== "all") params.set("dc", filterDc.value);
  if (filterErrors.checked) params.set("errors", "1");
  if (filterReports.checked) params.set("reports", "1");
  if (filterMaint.checked) params.set("maint", "1");
  if (activeMachineView !== "active") params.set("machine_tab", activeMachineView);

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
  saveMachineFilters();
}

function capitalize(value) {
  return String(value ?? "").charAt(0).toUpperCase() + String(value ?? "").slice(1);
}

function loadUiSettings() {
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      tableDensity: parsed.tableDensity === "compact" ? "compact" : DEFAULT_UI_SETTINGS.tableDensity,
      lowReliabilityPct: normalizeSettingNumber(parsed.lowReliabilityPct, DEFAULT_UI_SETTINGS.lowReliabilityPct, 0, 100),
      highTemperatureC: normalizeSettingNumber(parsed.highTemperatureC, DEFAULT_UI_SETTINGS.highTemperatureC, 0, 150),
      stalePollMinutes: normalizeSettingNumber(parsed.stalePollMinutes, DEFAULT_UI_SETTINGS.stalePollMinutes, 1, 1440),
      selectedUtilizationGpuType: typeof parsed.selectedUtilizationGpuType === "string" && parsed.selectedUtilizationGpuType
        ? parsed.selectedUtilizationGpuType
        : DEFAULT_UI_SETTINGS.selectedUtilizationGpuType
    };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

function saveUiSettings() {
  window.localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(uiSettings));
}

function loadMachineFilters() {
  try {
    const raw = window.localStorage.getItem(MACHINE_FILTERS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      status: ["all", "online", "offline"].includes(parsed.status) ? parsed.status : "all",
      listed: ["all", "listed", "unlisted"].includes(parsed.listed) ? parsed.listed : "all",
      dc: ["all", "dc", "non-dc"].includes(parsed.dc) ? parsed.dc : "all",
      errors: parsed.errors === true,
      reports: parsed.reports === true,
      maint: parsed.maint === true,
      machineTab: parsed.machineTab === "archived" ? "archived" : "active"
    };
  } catch {
    return {
      search: "",
      status: "all",
      listed: "all",
      dc: "all",
      errors: false,
      reports: false,
      maint: false,
      machineTab: "active"
    };
  }
}

function saveMachineFilters() {
  window.localStorage.setItem(MACHINE_FILTERS_KEY, JSON.stringify({
    search: filterSearch.value,
    status: filterStatus.value,
    listed: filterListed.value,
    dc: filterDc.value,
    errors: filterErrors.checked,
    reports: filterReports.checked,
    maint: filterMaint.checked,
    machineTab: activeMachineView
  }));
}

function normalizeSettingNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function applyUiSettings() {
  machinesScroll.classList.toggle("compact-density", uiSettings.tableDensity === "compact");
  densityToggle.querySelectorAll("[data-density]").forEach((button) => {
    button.classList.toggle("active", button.dataset.density === uiSettings.tableDensity);
  });
  settingsDensity.value = uiSettings.tableDensity;
  settingsReliability.value = String(uiSettings.lowReliabilityPct);
  settingsTemperature.value = String(uiSettings.highTemperatureC);
  settingsStaleMinutes.value = String(uiSettings.stalePollMinutes);
}

function updateUiSettings(nextSettings) {
  uiSettings = {
    ...uiSettings,
    ...nextSettings
  };
  selectedUtilizationGpuType = uiSettings.selectedUtilizationGpuType || "__fleet__";
  saveUiSettings();
  applyUiSettings();
  renderMachinesSorted();
  if (lastKnownHealth) {
    renderHealth(lastKnownHealth);
  }
  if (latestFleetHistoryPayload) {
    renderFleetTrends(latestFleetHistoryPayload);
  }
}

function redrawChartsForCurrentLayout() {
  if (latestHourlyEarningsPayload) {
    renderHourlyEarnings(latestHourlyEarningsPayload);
  }
  if (latestFleetHistoryPayload) {
    renderFleetTrends(latestFleetHistoryPayload);
  }
  if (latestGpuTypePricePayload) {
    renderGpuTypePriceTrends(latestGpuTypePricePayload);
  }

  if (!modalBackdrop.classList.contains("hidden") && currentModalHistory.length && currentModalTab === "charts") {
    clearChartSyncGroup("machine-modal");
    drawRenterChart(currentModalHistory);
    drawReliabilityChart(currentModalHistory);
    drawPriceChart(currentModalHistory);
    drawGpuCountChart(currentModalHistory);
    drawMachineEarningsChart(currentModalEarningsData || { days: [], total: null }, currentModalHistory);
    updateModalEarningsPresentation(currentModalEarningsData || { days: [] });
  }
}

loadDashboard().catch((error) => {
  console.error(error);
  lastUpdated.textContent = "Failed to load dashboard";
});

updateSortHeaders();

setInterval(() => {
  loadDashboard().catch((error) => console.error(error));
}, 5 * 60 * 1000);

let resizeRedrawTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeRedrawTimer);
  resizeRedrawTimer = window.setTimeout(() => {
    redrawChartsForCurrentLayout();
  }, 120);
});

machineViewTabs?.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextView = button.dataset.tab === "archived" ? "archived" : "active";
    if (nextView === activeMachineView) {
      return;
    }

    activeMachineView = nextView;
    persistStateToUrl();
    renderMachinesSorted();
  });
});

densityToggle.querySelectorAll("[data-density]").forEach((button) => {
  button.addEventListener("click", () => {
    updateUiSettings({ tableDensity: button.dataset.density === "compact" ? "compact" : "comfortable" });
  });
});

settingsButton.addEventListener("click", () => {
  applyUiSettings();
  settingsBackdrop.classList.remove("hidden");
});

settingsClose.addEventListener("click", () => {
  settingsBackdrop.classList.add("hidden");
});

settingsDensity.addEventListener("change", () => {
  updateUiSettings({ tableDensity: settingsDensity.value === "compact" ? "compact" : "comfortable" });
});

settingsReliability.addEventListener("change", () => {
  updateUiSettings({ lowReliabilityPct: normalizeSettingNumber(settingsReliability.value, DEFAULT_UI_SETTINGS.lowReliabilityPct, 0, 100) });
});

settingsTemperature.addEventListener("change", () => {
  updateUiSettings({ highTemperatureC: normalizeSettingNumber(settingsTemperature.value, DEFAULT_UI_SETTINGS.highTemperatureC, 0, 150) });
});

settingsStaleMinutes.addEventListener("change", () => {
  updateUiSettings({ stalePollMinutes: normalizeSettingNumber(settingsStaleMinutes.value, DEFAULT_UI_SETTINGS.stalePollMinutes, 1, 1440) });
});

settingsReset.addEventListener("click", () => {
  uiSettings = { ...DEFAULT_UI_SETTINGS };
  selectedUtilizationGpuType = uiSettings.selectedUtilizationGpuType;
  saveUiSettings();
  applyUiSettings();
  renderMachinesSorted();
  if (lastKnownHealth) {
    renderHealth(lastKnownHealth);
  }
  if (latestFleetHistoryPayload) {
    renderFleetTrends(latestFleetHistoryPayload);
  }
});

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => handleSort(th.dataset.sort));
});

trendRange.querySelectorAll("[data-hours]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTrendHours = Number(button.dataset.hours) || 168;
    trendRange.querySelectorAll("[data-hours]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    persistStateToUrl();
    loadDashboard().catch((error) => console.error(error));
  });
});

trendUtilGpuSelect.addEventListener("change", () => {
  selectedUtilizationGpuType = trendUtilGpuSelect.value || "__fleet__";
  updateUiSettings({ selectedUtilizationGpuType });
  if (latestFleetHistoryPayload) {
    renderFleetTrends(latestFleetHistoryPayload);
  }
});

[
  filterSearch,
  filterStatus,
  filterListed,
  filterDc,
  filterErrors,
  filterReports,
  filterMaint
].forEach((control) => {
  control.addEventListener("input", () => {
    persistStateToUrl();
    renderMachinesSorted();
  });
  control.addEventListener("change", () => {
    persistStateToUrl();
    renderMachinesSorted();
  });
});

filterReset.addEventListener("click", () => {
  filterSearch.value = "";
  filterStatus.value = "all";
  filterListed.value = "all";
  filterDc.value = "all";
  filterErrors.checked = false;
  filterReports.checked = false;
  filterMaint.checked = false;
  persistStateToUrl();
  renderMachinesSorted();
});

earningsPrevButton.addEventListener("click", () => {
  selectedEarningsDate = shiftUtcDate(selectedEarningsDate, -1);
  persistStateToUrl();
  loadDashboard().catch((error) => console.error(error));
});

earningsNextButton.addEventListener("click", () => {
  const nextDate = shiftUtcDate(selectedEarningsDate, 1);
  if (nextDate > todayUtcDateString()) {
    return;
  }

  selectedEarningsDate = nextDate;
  persistStateToUrl();
  loadDashboard().catch((error) => console.error(error));
});

const modalBackdrop = document.getElementById("modal-backdrop");
const modalClose = document.getElementById("modal-close");
const modalPrev = document.getElementById("modal-prev");
const modalNext = document.getElementById("modal-next");
const modalTitle = document.getElementById("modal-title");
const modalSummary = document.getElementById("modal-summary");
const modalEarningsBreakdown = document.getElementById("modal-earnings-breakdown");
const modalEarningsStatus = document.getElementById("modal-earnings-status");
const modalLiveNote = document.getElementById("modal-live-note");
const modalTimeline = document.getElementById("modal-timeline");
const modalStats = document.getElementById("modal-stats");
const modalError = document.getElementById("modal-error");
const modalMaintenance = document.getElementById("modal-maintenance");
const modalTabs = document.getElementById("modal-tabs");
const modalTabCharts = document.getElementById("modal-tab-charts");
const modalTabEvents = document.getElementById("modal-tab-events");
const modalHistoryRange = document.getElementById("modal-history-range");
const earningsChartTitle = document.getElementById("earnings-chart-title");
const earningsChartNote = document.getElementById("earnings-chart-note");
const renterChart = document.getElementById("renter-chart");
const reliabilityChart = document.getElementById("reliability-chart");
const priceChart = document.getElementById("price-chart");
const gpuCountChart = document.getElementById("gpu-count-chart");
const earningsChart = document.getElementById("earnings-chart");
const reportsModalBackdrop = document.getElementById("reports-modal-backdrop");
const reportsModalClose = document.getElementById("reports-modal-close");
const reportsModalTitle = document.getElementById("reports-modal-title");
const reportsModalCounter = document.getElementById("reports-modal-counter");
const reportsPrevButton = document.getElementById("reports-prev");
const reportsNextButton = document.getElementById("reports-next");
const reportsProblem = document.getElementById("reports-problem");
const reportsTime = document.getElementById("reports-time");
const reportsLiveNote = document.getElementById("reports-live-note");
const reportsMessage = document.getElementById("reports-message");

modalClose.addEventListener("click", () => {
  clearChartSyncGroup("machine-modal");
  modalBackdrop.classList.add("hidden");
});

modalPrev.addEventListener("click", () => {
  navigateMachineHistory(-1);
});

modalNext.addEventListener("click", () => {
  navigateMachineHistory(1);
});

modalTabs.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setModalTab(button.dataset.tab || "charts");
  });
});

modalHistoryRange.querySelectorAll("[data-hours]").forEach((button) => {
  button.addEventListener("click", () => {
    currentMachineHistoryHours = Number(button.dataset.hours) || 168;
    modalHistoryRange.querySelectorAll("[data-hours]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    if (currentMachineHistoryId != null) {
      showMachineHistory(currentMachineHistoryId).catch((error) => console.error(error));
    }
  });
});

window.addEventListener("click", (e) => {
  if (e.target === settingsBackdrop) {
    settingsBackdrop.classList.add("hidden");
  }
  if (e.target === modalBackdrop) {
    clearChartSyncGroup("machine-modal");
    modalBackdrop.classList.add("hidden");
  }
  if (e.target === reportsModalBackdrop) {
    reportsModalBackdrop.classList.add("hidden");
  }
});

window.addEventListener("keydown", (event) => {
  if (!settingsBackdrop.classList.contains("hidden") && event.key === "Escape") {
    event.preventDefault();
    settingsBackdrop.classList.add("hidden");
    return;
  }

  if (!modalBackdrop.classList.contains("hidden")) {
    if (event.key === "Escape") {
      event.preventDefault();
      clearChartSyncGroup("machine-modal");
      modalBackdrop.classList.add("hidden");
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (!modalPrev.disabled) {
        modalPrev.click();
      }
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!modalNext.disabled) {
        modalNext.click();
      }
      return;
    }
  }

  if (reportsModalBackdrop.classList.contains("hidden")) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    reportsModalBackdrop.classList.add("hidden");
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (!reportsPrevButton.disabled) {
      reportsPrevButton.click();
    }
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (!reportsNextButton.disabled) {
      reportsNextButton.click();
    }
  }
});

window.showMachineRow = function (event, machineId) {
  if ((event.ctrlKey || event.metaKey) && hasReports(machineId)) {
    showMachineReports(machineId).catch((error) => console.error(error));
    return;
  }

  showMachineHistory(machineId);
};

window.copyMachineIpAddress = async function (ipAddress) {
  try {
    await navigator.clipboard.writeText(ipAddress);
  } catch (error) {
    console.error("Failed to copy IP address:", error);
  }
};

async function showMachineHistory(machineId, options = {}) {
  const { preserveScroll = false } = options;
  const modalBody = modalBackdrop.querySelector(".modal-body");
  currentMachineHistoryId = machineId;
  currentModalMachine = null;
  currentModalHistory = [];
  currentModalEarningsData = null;
  setModalTab(preserveScroll ? currentModalTab : "charts");
  renderModalHeader(machineId);
  modalStats.textContent = "Loading...";
  modalSummary.innerHTML = "";
  modalEarningsBreakdown.innerHTML = "";
  modalEarningsStatus.innerHTML = "";
  modalEarningsStatus.classList.add("hidden");
  modalLiveNote.textContent = "";
  modalLiveNote.classList.add("hidden");
  modalTimeline.innerHTML = "";
  modalTimeline.classList.add("hidden");
  modalError.textContent = "";
  modalError.classList.add("hidden");
  modalMaintenance.textContent = "";
  modalMaintenance.classList.add("hidden");
  earningsChartTitle.textContent = "Historical Earnings";
  earningsChartNote.textContent = "";
  renterChart.innerHTML = "";
  reliabilityChart.innerHTML = "";
  priceChart.innerHTML = "";
  gpuCountChart.innerHTML = "";
  earningsChart.innerHTML = "";
  clearChartSyncGroup("machine-modal");
  modalBackdrop.classList.remove("hidden");
  updateModalNavigation();
  const previousScrollTop = preserveScroll ? modalBody?.scrollTop ?? 0 : 0;

  try {
    const [historyResponse, earningsResponse, monthlySummaryResponse] = await Promise.all([
      fetch(`/api/history?machine_id=${machineId}&hours=${currentMachineHistoryHours}`),
      fetch(`/api/earnings/machine?machine_id=${machineId}&hours=${currentMachineHistoryHours}`),
      fetch(`/api/earnings/machine/monthly-summary?machine_id=${machineId}`)
    ]);
    if (!historyResponse.ok) {
      throw new Error(`History request failed (${historyResponse.status})`);
    }
    const data = await historyResponse.json();
    const earningsData = await earningsResponse.json().catch(() => ({ days: [], total: null }));
    const monthlySummary = await monthlySummaryResponse.json().catch(() => ({ months: [] }));
    
    const machine = currentMachinesData.find((m) => m.machine_id === machineId);
    currentModalMachine = machine ?? null;
    currentModalHistory = Array.isArray(data.history) ? data.history : [];
    currentModalEarningsData = earningsData;
    renderModalLiveDependencyState(earningsResponse.ok ? earningsData : {
      error: earningsData?.error || "failed to fetch machine earnings",
      detail: earningsData?.detail || `Request failed (${earningsResponse.status})`,
      dependency: earningsData?.dependency || null
    }, currentModalHistory);
    renderModalHeader(machineId, machine);
    if (machine) {
      renderModalSummary(machine);
    }
    renderModalEarningsBreakdown(earningsData);
    updateModalEarningsPresentation(earningsData);
    if (machine && machine.error_message) {
      modalError.textContent = machine.error_message;
      modalError.classList.remove("hidden");
    }
    if (machine && Array.isArray(machine.machine_maintenance) && machine.machine_maintenance.length > 0) {
      modalMaintenance.textContent = formatMaintenanceWindows(machine.machine_maintenance);
      modalMaintenance.classList.remove("hidden");
    }
    
    if (!data.history || data.history.length === 0) {
      modalStats.textContent = "No history available.";
      if (preserveScroll && modalBody) {
        modalBody.scrollTop = previousScrollTop;
      }
      return;
    }

    const history = data.history;
    renderModalTimeline(history);
    const current = history[history.length - 1];
    
    if (current.current_rentals_running > 0) {
      let since = current.polled_at;
      for (let i = history.length - 2; i >= 0; i--) {
        if (history[i].current_rentals_running !== current.current_rentals_running) {
          break;
        }
        since = history[i].polled_at;
      }
      modalStats.textContent = `${current.current_rentals_running} renter(s) since ${new Date(since).toLocaleString()}`;
    } else {
      modalStats.textContent = "No current renters.";
    }

    drawRenterChart(history);
    drawReliabilityChart(history);
    drawPriceChart(history);
    drawGpuCountChart(history);
    drawMachineEarningsChart(currentModalEarningsData, history);
    renderModalEarningsStatus(
      currentModalEarningsData,
      monthlySummaryResponse.ok ? monthlySummary : null,
      earningsResponse.ok
    );
    updateModalEarningsSummary(
      machine,
      currentModalEarningsData,
      history,
      monthlySummaryResponse.ok ? monthlySummary : null
    );
    if (preserveScroll && modalBody) {
      modalBody.scrollTop = previousScrollTop;
    }
  } catch (error) {
    console.error(error);
    modalStats.textContent = "Failed to load history.";
  }
}

async function showMachineReports(machineId) {
  reportsModalTitle.textContent = `#${machineId}:`;
  reportsModalCounter.textContent = "Loading...";
  reportsProblem.textContent = "";
  reportsTime.textContent = "";
  reportsLiveNote.textContent = "";
  reportsLiveNote.classList.add("hidden");
  reportsMessage.textContent = "";
  reportsModalBackdrop.classList.remove("hidden");
  reportsNextButton.focus();

  let response;
  let data;
  try {
    response = await fetch(`/api/reports?machine_id=${machineId}`);
    data = await response.json();
  } catch (error) {
    reportsModalCounter.textContent = "Live fetch failed";
    reportsProblem.textContent = "Unable to load reports";
    reportsLiveNote.textContent = error instanceof Error ? error.message : String(error);
    reportsLiveNote.classList.remove("hidden");
    reportsPrevButton.disabled = true;
    reportsNextButton.disabled = true;
    return;
  }

  if (!response.ok) {
    reportsModalCounter.textContent = "Live fetch failed";
    reportsProblem.textContent = "Unable to load reports";
    reportsLiveNote.textContent = buildDependencyFailureMessage(data, "Reports are fetched live from the Vast CLI.");
    reportsLiveNote.classList.remove("hidden");
    reportsMessage.textContent = data?.detail || data?.error || "";
    reportsPrevButton.disabled = true;
    reportsNextButton.disabled = true;
    return;
  }

  currentReports = Array.isArray(data.reports) ? data.reports : [];
  currentReportIndex = 0;

  if (currentReports.length === 0) {
    reportsModalCounter.textContent = "No reports";
    reportsProblem.textContent = "No reports";
    reportsTime.textContent = "";
    reportsMessage.textContent = "";
    reportsPrevButton.disabled = true;
    reportsNextButton.disabled = true;
    return;
  }

  renderCurrentReport();
}

function renderCurrentReport() {
  const report = currentReports[currentReportIndex];
  reportsModalCounter.textContent = `${currentReportIndex + 1} / ${currentReports.length}`;
  reportsProblem.textContent = report.problem || "Unknown";
  reportsTime.textContent = report.created_at
    ? formatReportTimestamp(report.created_at)
    : "";
  reportsMessage.textContent = report.message || "(no message)";
  reportsPrevButton.disabled = currentReportIndex === 0;
  reportsNextButton.disabled = currentReportIndex >= currentReports.length - 1;
}

function renderModalLiveDependencyState(earningsData, machineHistory = []) {
  if (hasLocalEstimatedEarningsHistory(machineHistory)) {
    modalLiveNote.textContent = "";
    modalLiveNote.classList.add("hidden");
    return;
  }

  if (earningsData?.dependency?.ok === false || earningsData?.error) {
    modalLiveNote.textContent = buildDependencyFailureMessage(
      earningsData,
      "Historical snapshots are still available, but live earnings data from the Vast CLI is unavailable."
    );
    modalLiveNote.classList.remove("hidden");
    return;
  }

  modalLiveNote.textContent = "";
  modalLiveNote.classList.add("hidden");
}

function renderModalEarningsStatus(earningsData, monthlySummary, liveEarningsOk) {
  if (!modalEarningsStatus) {
    return;
  }

  const chartSource = earningsData?.source === "estimated"
    ? "Chart source: local machine earn/day history"
    : `Chart source: Vast CLI daily earnings (${formatDateWindow(earningsData?.start, earningsData?.end)})`;
  const realizedMonths = Array.isArray(monthlySummary?.months) ? monthlySummary.months.filter((month) => Number.isFinite(Number(month.total))) : [];
  const monthSource = realizedMonths.length > 0
    ? `Month cards: realized via Vast CLI per_machine totals`
    : "Month cards: estimated fallback or unavailable";
  const currentMonth = realizedMonths.find((month) => month.key === "current");
  const compareWindow = currentMonth?.comparison_start && currentMonth?.comparison_end
    ? `Current compare window: ${formatDateWindow(currentMonth.start, currentMonth.end)} vs ${formatDateWindow(currentMonth.comparison_start, currentMonth.comparison_end)}`
    : "";
  const badge = liveEarningsOk ? ["Healthy", "healthy"] : ["Degraded", "degraded"];

  modalEarningsStatus.innerHTML = `
    <div class="earnings-status-head">
      <span class="summary-badge ${badge[1]}">${badge[0]}</span>
      <strong>Live Earnings</strong>
    </div>
    <div class="earnings-status-line">${escapeHtml(monthSource)}</div>
    <div class="earnings-status-line">${escapeHtml(chartSource)}</div>
    ${compareWindow ? `<div class="earnings-status-line">${escapeHtml(compareWindow)}</div>` : ""}
  `;
  modalEarningsStatus.classList.remove("hidden");
}

function buildDependencyFailureMessage(payload, prefix) {
  return [
    prefix,
    payload?.dependency?.health?.detail,
    summarizeDependencyDetail(payload?.detail || payload?.error)
  ].filter(Boolean).join(" ");
}

function summarizeDependencyDetail(detail) {
  const text = String(detail ?? "").trim();
  if (!text) {
    return "";
  }

  const tracebackIndex = text.indexOf("Traceback");
  const withoutTraceback = tracebackIndex >= 0 ? text.slice(0, tracebackIndex).trim() : text;
  const firstLine = withoutTraceback.split("\n").map((line) => line.trim()).find(Boolean) || text.split("\n").map((line) => line.trim()).find(Boolean) || "";
  return firstLine;
}

function hasLocalEstimatedEarningsHistory(machineHistory) {
  return Array.isArray(machineHistory) && machineHistory.some((row) => typeof row?.earn_day === "number");
}

function hasReports(machineId) {
  const machine = currentMachinesData.find((row) => row.machine_id === machineId);
  return Boolean(machine && (machine.num_reports || 0) > 0);
}

function updateModalNavigation() {
  if (!modalPrev || !modalNext) {
    return;
  }

  const sorted = getSortedMachines();
  const index = sorted.findIndex((row) => row.machine_id === currentMachineHistoryId);
  const canGoPrev = index > 0;
  const canGoNext = index >= 0 && index < sorted.length - 1;

  modalPrev.disabled = !canGoPrev;
  modalNext.disabled = !canGoNext;
}

function navigateMachineHistory(direction) {
  const sorted = getSortedMachines();
  const index = sorted.findIndex((row) => row.machine_id === currentMachineHistoryId);
  if (index === -1) {
    return;
  }

  const nextMachine = sorted[index + direction];
  if (!nextMachine) {
    return;
  }

  showMachineHistory(nextMachine.machine_id).catch((error) => console.error(error));
}

reportsModalClose.addEventListener("click", () => {
  reportsModalBackdrop.classList.add("hidden");
});

reportsPrevButton.addEventListener("click", () => {
  if (currentReportIndex <= 0) {
    return;
  }

  currentReportIndex -= 1;
  renderCurrentReport();
});

reportsNextButton.addEventListener("click", () => {
  if (currentReportIndex >= currentReports.length - 1) {
    return;
  }

  currentReportIndex += 1;
  renderCurrentReport();
});

function drawRenterChart(history) {
  drawSingleSeriesChart(renterChart, {
    history,
    key: "current_rentals_running",
    label: "Renters",
    color: "#60a5fa",
    width: renterChart.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 30 },
    min: 0,
    max: Math.max(1, ...history.map((row) => row.current_rentals_running || 0)),
    tickCount: Math.min(Math.max(1, Math.max(...history.map((row) => row.current_rentals_running || 0))), 5),
    stepped: true,
    fillArea: true,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => `${Math.round(value)}`,
    formatHoverValue: (value) => `${Math.round(value)} renter${Math.round(value) === 1 ? "" : "s"}`
  });
}

function drawReliabilityChart(history) {
  drawSingleSeriesChart(reliabilityChart, {
    history,
    key: "reliability",
    label: "Reliability",
    color: "#f59e0b",
    width: reliabilityChart.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 40 },
    min: 60,
    max: 100,
    tickCount: 4,
    valueTransform: (value) => typeof value === "number" ? value * 100 : null,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => `${Math.round(value)}%`,
    formatHoverValue: (value) => `${value.toFixed(1)}%`,
    emptyMessage: "No reliability history yet"
  });
}

function drawPriceChart(history) {
  const changePoints = getPriceChangePoints(history);
  drawSingleSeriesChart(priceChart, {
    history,
    key: "listed_gpu_cost",
    label: "Price",
    color: "#34d399",
    width: priceChart.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 52 },
    tickCount: 4,
    valueTransform: (value) => typeof value === "number" ? value : null,
    formatAxisValue: (value) => formatCurrency(value),
    formatHoverValue: (value) => `${formatCurrency(value)} / GPU`,
    emptyMessage: "No price history yet",
    autoPadRange: true,
    syncGroup: "machine-modal",
    annotationPoints: changePoints,
    formatAnnotation: (point) => formatCurrency(point.value)
  });
}

function drawGpuCountChart(history) {
  drawSingleSeriesChart(gpuCountChart, {
    history,
    key: "num_gpus",
    label: "GPUs",
    color: "#a78bfa",
    width: gpuCountChart.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 30 },
    min: 0,
    max: Math.max(1, ...history.map((row) => row.num_gpus || 0)),
    tickCount: Math.min(Math.max(1, Math.max(...history.map((row) => row.num_gpus || 0))), 6),
    stepped: true,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => `${Math.round(value)}`,
    formatHoverValue: (value) => `${Math.round(value)} GPU${Math.round(value) === 1 ? "" : "s"}`,
    emptyMessage: "No GPU count history yet"
  });
}

function drawMachineEarningsChart(earningsData, machineHistory = []) {
  const apiHistory = Array.isArray(earningsData?.days)
    ? earningsData.days.map((row) => ({
      polled_at: row.day,
      earnings: row.earnings
    }))
    : [];
  const estimatedHistory = Array.isArray(machineHistory)
    ? machineHistory
      .map((row) => ({
        polled_at: row.polled_at,
        earn_day: typeof row.earn_day === "number" ? row.earn_day : null
      }))
      .filter((row) => row.earn_day != null)
    : [];

  if (estimatedHistory.length > 0) {
    earningsData.source = "estimated";
    drawSingleSeriesChart(earningsChart, {
      history: estimatedHistory,
      key: "earn_day",
      label: "Earn/day",
      color: "#22c55e",
      width: earningsChart.clientWidth || 600,
      height: 200,
      padding: { top: 20, right: 20, bottom: 30, left: 56 },
      min: 0,
      tickCount: 4,
      valueTransform: (value) => typeof value === "number" ? value : null,
      syncGroup: "machine-modal",
      formatAxisValue: (value) => formatCurrency(value),
      formatHoverValue: (value) => `${formatCurrency(value)} / day`,
      emptyMessage: "No earnings history yet",
      autoPadRange: true,
      fillArea: true
    });
    return;
  }

  if (apiHistory.length > 0) {
    earningsData.source = "realized";
    drawSingleSeriesChart(earningsChart, {
      history: apiHistory,
      key: "earnings",
      label: "Earnings",
      color: "#22c55e",
      width: earningsChart.clientWidth || 600,
      height: 200,
      padding: { top: 20, right: 20, bottom: 30, left: 56 },
      min: 0,
      tickCount: 4,
      valueTransform: (value) => typeof value === "number" ? value : null,
      syncGroup: "machine-modal",
      formatAxisValue: (value) => formatCurrency(value),
      formatHoverValue: (value) => `${formatCurrency(value)} earned`,
      emptyMessage: "No earnings history yet",
      autoPadRange: true,
      fillArea: true
    });
    return;
  }

  earningsData.source = "estimated";
  drawSingleSeriesChart(earningsChart, {
    history: estimatedHistory,
    key: "earn_day",
    label: "Earn/day",
    color: "#22c55e",
    width: earningsChart.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 56 },
    min: 0,
    tickCount: 4,
    valueTransform: (value) => typeof value === "number" ? value : null,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => formatCurrency(value),
    formatHoverValue: (value) => `${formatCurrency(value)} / day`,
    emptyMessage: "No earnings history yet",
    autoPadRange: true,
    fillArea: true
  });
}

function drawSingleSeriesChart(svg, options) {
  const {
    history,
    key,
    label,
    color,
    width,
    height,
    padding,
    min,
    max,
    tickCount = 4,
    stepped = false,
    fillArea = false,
    valueTransform = (value) => typeof value === "number" ? value : null,
    formatAxisValue = (value) => value.toFixed(0),
    formatHoverValue = formatAxisValue,
    emptyMessage = "No data yet",
    autoPadRange = false,
    syncGroup = null,
    annotationPoints = [],
    formatAnnotation = () => ""
  } = options;

  const points = history
    .map((row) => ({
      ...row,
      timeMs: Date.parse(row.polled_at),
      value: valueTransform(row[key])
    }))
    .filter((row) => Number.isFinite(row.timeMs));

  if (!points.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">No data yet</text>`;
    return;
  }

  const validValues = points
    .map((row) => row.value)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  if (!validValues.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">${emptyMessage}</text>`;
    return;
  }

  const minTime = points[0].timeMs;
  const maxTime = points[points.length - 1].timeMs;
  const timeSpan = Math.max(1, maxTime - minTime);
  let minValue = min ?? Math.min(...validValues);
  let maxValue = max ?? Math.max(...validValues);

  if (autoPadRange && min == null && max == null && minValue === maxValue) {
    const pad = Math.max(Math.abs(minValue) * 0.05, 0.01);
    minValue -= pad;
    maxValue += pad;
  }

  const valueSpan = Math.max(1e-6, maxValue - minValue);
  const scaleX = (timeMs) => padding.left + ((timeMs - minTime) / timeSpan) * (width - padding.left - padding.right);
  const scaleY = (value) => height - padding.bottom - ((value - minValue) / valueSpan) * (height - padding.top - padding.bottom);

  let svgContent = "";
  for (let index = 0; index <= tickCount; index += 1) {
    const value = minValue + (valueSpan * index) / tickCount;
    const y = scaleY(value);
    svgContent += `<g class="chart-axis">
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke-dasharray="2,2" />
      <text x="${padding.left - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(formatAxisValue(value))}</text>
    </g>`;
  }

  if (fillArea) {
    const areaPath = buildAreaPath(
      points,
      (row) => scaleX(row.timeMs),
      (row) => row.value == null ? null : scaleY(row.value),
      scaleY(minValue),
      { stepped }
    );
    if (areaPath) {
      svgContent += `<path d="${areaPath}" class="chart-area" />`;
    }
  }

  const linePath = buildLinePath(
    points,
    (row) => scaleX(row.timeMs),
    (row) => row.value == null ? null : scaleY(row.value),
    { stepped }
  );
  svgContent += `<path d="${linePath}" class="chart-line" style="stroke:${color}" />`;
  svgContent += annotationPoints
    .map((point) => {
      const x = scaleX(point.timeMs);
      const y = scaleY(point.value);
      const labelY = Math.max(padding.top + 12, y - 10);
      return `<g class="chart-annotation">
        <circle class="chart-annotation-dot" cx="${x}" cy="${y}" r="4" />
        <text x="${x}" y="${labelY}" text-anchor="middle">${escapeHtml(formatAnnotation(point))}</text>
      </g>`;
    })
    .join("");
  svgContent += `<g class="chart-axis">
    <text x="${padding.left}" y="${height - 5}" text-anchor="start">${escapeHtml(new Date(minTime).toLocaleDateString())}</text>
    <text x="${width - padding.right}" y="${height - 5}" text-anchor="end">${escapeHtml(new Date(maxTime).toLocaleDateString())}</text>
  </g>`;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = svgContent;
  attachChartHover(svg, {
    width,
    height,
    padding,
    points,
    scaleX: (row) => scaleX(row.timeMs),
    syncGroup,
    series: [
      {
        label,
        color,
        getValue: (row) => row.value,
        getY: (row) => row.value == null ? null : scaleY(row.value),
        formatValue: formatHoverValue
      }
    ]
  });
}

function buildLinePath(points, getX, getY, options = {}) {
  const { stepped = false } = options;
  let path = "";
  let previousY = null;
  let started = false;

  for (const point of points) {
    const x = getX(point);
    const y = getY(point);
    if (y == null) {
      started = false;
      previousY = null;
      continue;
    }

    if (!started) {
      path += `${path ? " " : ""}M ${x} ${y}`;
      started = true;
    } else if (stepped) {
      path += ` L ${x} ${previousY} L ${x} ${y}`;
    } else {
      path += ` L ${x} ${y}`;
    }

    previousY = y;
  }

  return path;
}

function buildAreaPath(points, getX, getY, baselineY, options = {}) {
  const { stepped = false } = options;
  const validPoints = points
    .map((point) => ({ x: getX(point), y: getY(point) }))
    .filter((point) => point.y != null);

  if (!validPoints.length) {
    return "";
  }

  let path = `M ${validPoints[0].x} ${baselineY} L ${validPoints[0].x} ${validPoints[0].y}`;
  for (let index = 1; index < validPoints.length; index += 1) {
    const point = validPoints[index];
    const previous = validPoints[index - 1];
    if (stepped) {
      path += ` L ${point.x} ${previous.y} L ${point.x} ${point.y}`;
    } else {
      path += ` L ${point.x} ${point.y}`;
    }
  }

  const last = validPoints[validPoints.length - 1];
  path += ` L ${last.x} ${baselineY} Z`;
  return path;
}

function attachChartHover(svg, options) {
  const { width, height, padding, points, scaleX, series, syncGroup } = options;
  if (!points.length || !series.length) {
    return;
  }

  svg.onmousemove = null;
  svg.onmouseleave = null;

  const left = padding.left;
  const right = width - padding.right;
  const top = padding.top;
  const bottom = height - padding.bottom;
  const pointPositions = points.map((point) => scaleX(point));

  const clearHover = () => {
    svg.querySelector(".chart-hover-layer")?.remove();
  };

  const renderHover = (index) => {
    clearHover();

    const point = points[index];
    if (!point) {
      return;
    }

    const x = pointPositions[index];
    const values = series
      .map((item) => {
        const value = item.getValue(point);
        if (value == null || !Number.isFinite(value)) {
          return null;
        }

        return {
          label: item.label,
          color: item.color,
          valueText: item.formatValue ? item.formatValue(value, point) : `${value}`,
          y: item.getY ? item.getY(point) : null
        };
      })
      .filter(Boolean);

    if (!values.length) {
      return;
    }

    const tooltipWidth = 172;
    const tooltipHeight = 18 + ((values.length + 1) * 16);
    const tooltipX = x > width / 2
      ? Math.max(left, x - tooltipWidth - 10)
      : Math.min(right - tooltipWidth, x + 10);
    const tooltipY = Math.max(top, Math.min(bottom - tooltipHeight, top + 6));

    const markers = values
      .filter((entry) => entry.y != null)
      .map((entry) => `<circle class="chart-hover-dot" cx="${x}" cy="${entry.y}" r="4" fill="${entry.color}" />`)
      .join("");
    const valueLines = values
      .map((entry, lineIndex) => {
        const y = tooltipY + 32 + (lineIndex * 16);
        return `<text x="${tooltipX + 10}" y="${y}" class="chart-tooltip-value">
          <tspan fill="${entry.color}">${escapeHtml(entry.label)}:</tspan>
          <tspan dx="6">${escapeHtml(entry.valueText)}</tspan>
        </text>`;
      })
      .join("");

    svg.innerHTML += `<g class="chart-hover-layer">
      <line class="chart-crosshair" x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" />
      ${markers}
      <rect class="chart-tooltip-box" x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="10" />
      <text x="${tooltipX + 10}" y="${tooltipY + 16}" class="chart-tooltip-time">${escapeHtml(formatChartTimestamp(point.polled_at))}</text>
      ${valueLines}
    </g>`;
  };

  const renderHoverForTime = (timeMs) => {
    if (!Number.isFinite(timeMs)) {
      clearHover();
      return;
    }

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const distance = Math.abs(points[index].timeMs - timeMs);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    renderHover(nearestIndex);
  };

  svg.__chartHoverApi = {
    renderHoverForTime,
    clearHover
  };

  if (syncGroup) {
    const members = chartSyncGroups.get(syncGroup) || new Set();
    members.add(svg);
    chartSyncGroups.set(syncGroup, members);
  }

  svg.onmouseleave = () => {
    if (syncGroup) {
      clearChartSyncGroup(syncGroup);
      return;
    }
    clearHover();
  };
  svg.onmousemove = (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) {
      return;
    }

    const x = ((event.clientX - rect.left) / rect.width) * width;
    const clampedX = Math.max(left, Math.min(right, x));
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < pointPositions.length; index += 1) {
      const distance = Math.abs(pointPositions[index] - clampedX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }

    if (!syncGroup) {
      renderHover(nearestIndex);
      return;
    }

    const timeMs = points[nearestIndex]?.timeMs;
    const members = chartSyncGroups.get(syncGroup) || [];
    members.forEach((member) => member.__chartHoverApi?.renderHoverForTime(timeMs));
  };
}

function clearChartSyncGroup(groupName) {
  const members = chartSyncGroups.get(groupName);
  if (!members) {
    return;
  }

  members.forEach((member) => member.__chartHoverApi?.clearHover());
}

function formatChartTimestamp(value) {
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

function formatCurrency(value) {
  return `$${Number(value).toFixed(3)}`;
}

function formatPriceShort(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatSignedCurrency(value) {
  const amount = Math.abs(Number(value));
  const sign = Number(value) >= 0 ? "+" : "-";
  return `${sign}$${amount.toFixed(3)}`;
}

function getPriceChangePoints(history) {
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

function todayUtcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function shiftUtcDate(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDuration(durationMs) {
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

function formatReportTimestamp(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-GB", { month: "short" });
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${day} ${month}, ${year} ${hours}:${minutes}:${seconds}`;
}

function formatMaintenanceWindows(windows) {
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
