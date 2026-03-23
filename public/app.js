import {
  escapeHtml,
  formatCurrency,
  formatDateWindow,
  formatDuration,
  formatMaintenanceWindows,
  formatPriceShort,
  formatSignedCurrency,
  shiftUtcDate,
  todayUtcDateString
} from "./app/formatters.js";
import { copyTextToClipboard } from "./app/clipboard.js";
import {
  buildDashboardNoticeMessage,
  fetchDashboardPayload
} from "./app/dashboard-loader.js";
import {
  clearChartSyncGroup,
  drawGpuCountChart,
  drawMachineEarningsChart,
  drawMultiSeriesChart,
  drawPriceChart,
  drawReliabilityChart,
  drawRenterChart,
  normalizeGpuTypePriceHistory,
  normalizeGpuTypeUtilizationHistory,
  syncUtilizationSelector
} from "./app/charts.js";
import {
  bindDashboardControls,
  bindMachineInteractions,
  bindModalControls,
  bindReportGestureHandlers,
  bindWindowResize
} from "./app/event-wiring.js";
import {
  createMachineModalController,
  createReportsController
} from "./app/modal-controllers.js";
import {
  buildMachineEmptyStateMessage,
  buildMachineRowsMarkup,
  getFilteredMachines as getFilteredMachineRows,
  getMachineViewCounts,
  getSortedMachines as getSortedMachineRows,
  utilClass
} from "./app/machine-table.js";
import {
  loadMachineFilters as loadStoredMachineFilters,
  loadUiSettings as loadStoredUiSettings,
  normalizeSettingNumber,
  persistViewStateToUrl,
  readInitialViewState,
  saveMachineFilters as persistMachineFilters,
  saveUiSettings as persistUiSettings
} from "./app/ui-state.js";
import {
  buildCalendarMonthEarningsSummaries,
  buildModalEarningsBreakdownMarkup,
  buildModalSummaryMarkup,
  buildModalTimelineMarkup,
  formatGpuMachineLabel
} from "./app/machine-modal.js";

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
const dashboardNotice = document.getElementById("dashboard-notice");
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
let uiSettings = loadStoredUiSettings(UI_SETTINGS_KEY, DEFAULT_UI_SETTINGS);

let currentMachinesData = [];
let sortCol = "hostname";
let sortDesc = false;
let selectedEarningsDate = todayUtcDateString();
let selectedTrendHours = 168;
let currentMachineHistoryId = null;
let currentMachineHistoryHours = 168;
let currentReports = [];
let currentReportIndex = 0;
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
const REPORT_LONG_PRESS_MS = 550;
let reportLongPressTimer = null;
let reportLongPressActiveMachineId = null;
let suppressRowClickUntil = 0;
const copyFeedbackTimers = new WeakMap();
initializeStateFromUrl();

async function loadDashboard() {
  const result = await fetchDashboardPayload({
    selectedEarningsDate,
    selectedTrendHours
  });
  renderDashboardNotice(result.failures);

  const status = result.payload.status;
  if (status) {
    currentMachinesData = Array.isArray(status.machines) ? status.machines : [];
    renderSummary(status.summary);
    renderSummaryComparison(status.summary?.comparison24h);
    renderBreakdown(Array.isArray(status.gpuTypeBreakdown) ? status.gpuTypeBreakdown : []);
    renderMachinesSorted();
    lastKnownHealth = status.health;
    renderHealth(status.health);
    lastUpdated.textContent = status.latestPollAt
      ? `Last updated ${new Date(status.latestPollAt).toLocaleString()}`
      : "No poll data yet";
  } else if (!lastKnownHealth) {
    healthBadge.className = "health-badge degraded";
    healthBadge.textContent = "Degraded";
    lastUpdated.textContent = "Dashboard refresh incomplete";
  }

  if (result.payload.fleetHistory) {
    latestFleetHistoryPayload = result.payload.fleetHistory;
    renderFleetTrends(latestFleetHistoryPayload);
  } else if (!latestFleetHistoryPayload) {
    renderTrendUnavailable(trendGpusChart, "Fleet trends unavailable");
    renderTrendUnavailable(trendFleetChart, "Fleet trends unavailable");
    renderTrendUnavailable(trendUtilChart, "Utilisation unavailable");
  }

  if (result.payload.gpuTypePrice) {
    latestGpuTypePricePayload = result.payload.gpuTypePrice;
    renderGpuTypePriceTrends(latestGpuTypePricePayload);
  } else if (!latestGpuTypePricePayload) {
    renderTrendUnavailable(trendPriceChart, "GPU pricing unavailable");
  }

  if (result.payload.earnings) {
    latestHourlyEarningsPayload = result.payload.earnings;
    renderHourlyEarnings(latestHourlyEarningsPayload);
  } else if (!latestHourlyEarningsPayload) {
    renderHourlyEarningsUnavailable();
  }

  if (result.payload.alerts) {
    renderAlerts(Array.isArray(result.payload.alerts.alerts) ? result.payload.alerts.alerts : []);
  } else if (!alertsList.innerHTML) {
    renderAlertsUnavailable();
  }

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

function getMachineFilterState() {
  return {
    search: filterSearch.value,
    status: filterStatus.value,
    listed: filterListed.value,
    dc: filterDc.value,
    errors: filterErrors.checked,
    reports: filterReports.checked,
    maint: filterMaint.checked
  };
}

function getFilteredMachines() {
  return getFilteredMachineRows(currentMachinesData, getMachineFilterState(), activeMachineView);
}

function getSortedMachines() {
  return getSortedMachineRows(currentMachinesData, getMachineFilterState(), activeMachineView, sortCol, sortDesc);
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
  machinesBody.innerHTML = buildMachineRowsMarkup(rows, uiSettings);
}

function renderMachineEmptyState(count) {
  if (!machinesEmptyState) {
    return;
  }

  const message = buildMachineEmptyStateMessage(count, getMachineFilterState(), activeMachineView);
  if (message) {
    machinesEmptyState.textContent = message;
    machinesEmptyState.classList.remove("hidden");
    return;
  }

  if (count > 0) {
    machinesEmptyState.textContent = "";
    machinesEmptyState.classList.add("hidden");
  }
}

function updateMachineViewTabs() {
  if (!machineViewTabs) {
    return;
  }

  const { activeCount, archivedCount } = getMachineViewCounts(currentMachinesData);

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

function renderModalSummary(machine) {
  modalSummary.innerHTML = buildModalSummaryMarkup(machine);
}

function renderModalHeader(machineId, machine = null) {
  const machineIdTag = `<button class="modal-header-id" type="button" title="Tap to copy machine ID" data-copy-machine-id="${escapeHtml(String(machineId))}">Machine #${escapeHtml(String(machineId))}</button>`;
  const dcTag = machine?.is_datacenter ? ' <span class="dc-pill">DC</span>' : "";
  const gpuTag = machine ? ` <span class="modal-header-gpu">${escapeHtml(formatGpuMachineLabel(machine))}</span>` : "";
  const ipTag = machine?.public_ipaddr
    ? ` <button class="modal-header-ip" type="button" title="Tap to copy IP address" data-copy-ip-address="${escapeHtml(machine.public_ipaddr)}">${escapeHtml(machine.public_ipaddr)}</button>`
    : "";
  modalTitle.innerHTML = `${machineIdTag}${dcTag}${gpuTag}${ipTag}`;
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

  cards.push(...buildCalendarMonthEarningsSummaries(machineHistory, monthlySummary).map((item) => ({
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

function renderModalTimeline(history) {
  if (!modalTimeline) {
    return;
  }

  const markup = buildModalTimelineMarkup(history);
  if (!markup) {
    modalTimeline.innerHTML = "";
    modalTimeline.classList.add("hidden");
    return;
  }

  modalTimeline.innerHTML = markup;
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

  const markup = buildModalEarningsBreakdownMarkup(earningsData);
  if (!markup) {
    modalEarningsBreakdown.innerHTML = "";
    return;
  }

  modalEarningsBreakdown.innerHTML = markup;
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

function renderHourlyEarningsUnavailable() {
  earningsTotal.textContent = "--";
  earningsDate.textContent = selectedEarningsDate;
  hourlyChart.innerHTML = '<p class="muted">Hourly earnings are temporarily unavailable.</p>';
  earningsNextButton.disabled = selectedEarningsDate === todayUtcDateString();
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

function renderAlertsUnavailable() {
  alertsList.innerHTML = '<p class="muted">Alerts are temporarily unavailable.</p>';
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

function renderDashboardNotice(failures) {
  const message = buildDashboardNoticeMessage(failures);
  if (!message) {
    dashboardNotice.classList.add("hidden");
    dashboardNotice.textContent = "";
    return;
  }

  dashboardNotice.textContent = message;
  dashboardNotice.classList.remove("hidden");
}

function renderTrendUnavailable(chartElement, message) {
  chartElement.innerHTML = `<text x="360" y="90" text-anchor="middle" class="chart-empty">${escapeHtml(message)}</text>`;
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
  selectedUtilizationGpuType = syncUtilizationSelector(
    trendUtilGpuSelect,
    utilizationHistory,
    selectedUtilizationGpuType
  );

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

function initializeStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const savedMachineFilters = loadStoredMachineFilters(MACHINE_FILTERS_KEY);
  const initialState = readInitialViewState({
    currentSortCol: sortCol,
    defaultTrendHours: selectedTrendHours,
    defaultEarningsDate: selectedEarningsDate,
    savedMachineFilters,
    searchParams: params
  });

  sortCol = initialState.sortCol;
  sortDesc = initialState.sortDesc;
  selectedTrendHours = initialState.selectedTrendHours;
  selectedEarningsDate = initialState.selectedEarningsDate;
  filterSearch.value = initialState.filterSearch;
  filterStatus.value = initialState.filterStatus;
  filterListed.value = initialState.filterListed;
  filterDc.value = initialState.filterDc;
  filterErrors.checked = initialState.filterErrors;
  filterReports.checked = initialState.filterReports;
  filterMaint.checked = initialState.filterMaint;
  activeMachineView = initialState.activeMachineView;

  trendRange.querySelectorAll("[data-hours]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.hours) === selectedTrendHours);
  });

  applyUiSettings();
  saveMachineFilters();
}

function persistStateToUrl() {
  persistViewStateToUrl({
    sortCol,
    sortDesc,
    selectedTrendHours,
    selectedEarningsDate,
    todayUtcDate: todayUtcDateString(),
    filterSearch: filterSearch.value,
    filterStatus: filterStatus.value,
    filterListed: filterListed.value,
    filterDc: filterDc.value,
    filterErrors: filterErrors.checked,
    filterReports: filterReports.checked,
    filterMaint: filterMaint.checked,
    activeMachineView
  });
  saveMachineFilters();
}

function saveMachineFilters() {
  persistMachineFilters(MACHINE_FILTERS_KEY, {
    search: filterSearch.value,
    status: filterStatus.value,
    listed: filterListed.value,
    dc: filterDc.value,
    errors: filterErrors.checked,
    reports: filterReports.checked,
    maint: filterMaint.checked,
    machineTab: activeMachineView
  });
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
  persistUiSettings(UI_SETTINGS_KEY, uiSettings);
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
    drawRenterChart(renterChart, currentModalHistory);
    drawReliabilityChart(reliabilityChart, currentModalHistory);
    drawPriceChart(priceChart, currentModalHistory);
    drawGpuCountChart(gpuCountChart, currentModalHistory);
    drawMachineEarningsChart(earningsChart, currentModalEarningsData || { days: [], total: null }, currentModalHistory);
    updateModalEarningsPresentation(currentModalEarningsData || { days: [] });
  }
}

loadDashboard().catch((error) => {
  console.error(error);
  renderDashboardNotice([{ label: "dashboard data", critical: true }]);
  healthBadge.className = "health-badge degraded";
  healthBadge.textContent = "Degraded";
  lastUpdated.textContent = "Dashboard refresh incomplete";
});

updateSortHeaders();

setInterval(() => {
  loadDashboard().catch((error) => console.error(error));
}, 5 * 60 * 1000);

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

const machineModalController = createMachineModalController({
  elements: {
    modalBackdrop,
    modalSummary,
    modalEarningsBreakdown,
    modalEarningsStatus,
    modalLiveNote,
    modalTimeline,
    modalStats,
    modalError,
    modalMaintenance,
    earningsChartTitle,
    earningsChartNote,
    renterChart,
    reliabilityChart,
    priceChart,
    gpuCountChart,
    earningsChart,
    modalPrev,
    modalNext
  },
  getMachines: () => currentMachinesData,
  getMachineHistoryHours: () => currentMachineHistoryHours,
  getCurrentMachineHistoryId: () => currentMachineHistoryId,
  getCurrentModalTab: () => currentModalTab,
  setCurrentMachineHistoryId: (value) => {
    currentMachineHistoryId = value;
  },
  setCurrentModalMachine: (value) => {
    currentModalMachine = value;
  },
  setCurrentModalHistory: (value) => {
    currentModalHistory = value;
  },
  setCurrentModalEarningsData: (value) => {
    currentModalEarningsData = value;
  },
  setModalTab,
  renderModalHeader,
  renderModalSummary,
  renderModalEarningsBreakdown,
  updateModalEarningsPresentation,
  renderModalTimeline,
  updateModalEarningsSummary,
  clearChartSyncGroup,
  drawRenterChart,
  drawReliabilityChart,
  drawPriceChart,
  drawGpuCountChart,
  drawMachineEarningsChart,
  formatMaintenanceWindows,
  getSortedMachines
});

const reportsController = createReportsController({
  elements: {
    reportsModalBackdrop,
    reportsModalTitle,
    reportsModalCounter,
    reportsPrevButton,
    reportsNextButton,
    reportsProblem,
    reportsTime,
    reportsLiveNote,
    reportsMessage
  },
  getMachines: () => currentMachinesData,
  getCurrentReports: () => currentReports,
  setCurrentReports: (value) => {
    currentReports = value;
  },
  getCurrentReportIndex: () => currentReportIndex,
  setCurrentReportIndex: (value) => {
    currentReportIndex = value;
  }
});

function handleMachineRowClick(event, machineId) {
  if (Date.now() < suppressRowClickUntil) {
    return;
  }

  if ((event.ctrlKey || event.metaKey) && hasReports(machineId)) {
    showMachineReports(machineId).catch((error) => console.error(error));
    return;
  }

  showMachineHistory(machineId);
}

async function copyMachineIpAddress(ipAddress, button = null) {
  try {
    await copyTextToClipboard(ipAddress);
    flashCopyFeedback(button);
  } catch (error) {
    console.error("Failed to copy IP address:", error);
  }
}

async function copyMachineId(machineId, button = null) {
  try {
    await copyTextToClipboard(machineId);
    flashCopyFeedback(button);
  } catch (error) {
    console.error("Failed to copy machine ID:", error);
  }
}

function flashCopyFeedback(button) {
  if (!button) {
    return;
  }

  if (!button.dataset.copyTitle) {
    button.dataset.copyTitle = button.getAttribute("title") || "";
  }

  const priorTimer = copyFeedbackTimers.get(button);
  if (priorTimer) {
    window.clearTimeout(priorTimer);
  }

  button.classList.add("copied");
  button.setAttribute("title", "Copied");

  const timer = window.setTimeout(() => {
    button.classList.remove("copied");
    button.setAttribute("title", button.dataset.copyTitle || "");
    copyFeedbackTimers.delete(button);
  }, 1200);

  copyFeedbackTimers.set(button, timer);
}

async function showMachineHistory(machineId, options = {}) {
  return machineModalController.showMachineHistory(machineId, options);
}

async function showMachineReports(machineId) {
  return reportsController.showMachineReports(machineId);
}

function renderCurrentReport() {
  return reportsController.renderCurrentReport();
}

function hasReports(machineId) {
  return reportsController.hasReports(machineId);
}

function getReportTriggerFromEventTarget(target) {
  return reportsController.getReportTriggerFromEventTarget(target);
}

function clearReportLongPress() {
  if (reportLongPressTimer) {
    window.clearTimeout(reportLongPressTimer);
    reportLongPressTimer = null;
  }
  reportLongPressActiveMachineId = null;
}

function beginReportLongPress(event) {
  const trigger = getReportTriggerFromEventTarget(event.target);
  if (!trigger) {
    return;
  }

  if (event.pointerType !== "touch" && event.pointerType !== "pen") {
    return;
  }

  const machineId = Number(trigger.dataset.machineId);
  if (!Number.isFinite(machineId) || !hasReports(machineId)) {
    return;
  }

  clearReportLongPress();
  reportLongPressActiveMachineId = machineId;
  reportLongPressTimer = window.setTimeout(() => {
    suppressRowClickUntil = Date.now() + 750;
    clearReportLongPress();
    showMachineReports(machineId).catch((error) => console.error(error));
  }, REPORT_LONG_PRESS_MS);
}

function cancelReportLongPress() {
  clearReportLongPress();
}

function updateModalNavigation() {
  return machineModalController.updateModalNavigation();
}

function navigateMachineHistory(direction) {
  return machineModalController.navigateMachineHistory(direction);
}

bindWindowResize({
  onResize: redrawChartsForCurrentLayout
});

bindDashboardControls({
  machineViewTabs,
  densityToggle,
  settingsButton,
  settingsBackdrop,
  settingsClose,
  settingsDensity,
  settingsReliability,
  settingsTemperature,
  settingsStaleMinutes,
  settingsReset,
  trendRange,
  trendUtilGpuSelect,
  filterControls: [
    filterSearch,
    filterStatus,
    filterListed,
    filterDc,
    filterErrors,
    filterReports,
    filterMaint
  ],
  filterReset,
  earningsPrevButton,
  earningsNextButton,
  onMachineViewChange: (nextView) => {
    if (nextView === activeMachineView) {
      return;
    }

    activeMachineView = nextView;
    persistStateToUrl();
    renderMachinesSorted();
  },
  onDensityChange: (density) => {
    updateUiSettings({ tableDensity: density });
  },
  onOpenSettings: () => {
    applyUiSettings();
    settingsBackdrop.classList.remove("hidden");
  },
  onCloseSettings: () => {
    settingsBackdrop.classList.add("hidden");
  },
  onSettingsDensityChange: () => {
    updateUiSettings({ tableDensity: settingsDensity.value === "compact" ? "compact" : "comfortable" });
  },
  onSettingsReliabilityChange: () => {
    updateUiSettings({ lowReliabilityPct: normalizeSettingNumber(settingsReliability.value, DEFAULT_UI_SETTINGS.lowReliabilityPct, 0, 100) });
  },
  onSettingsTemperatureChange: () => {
    updateUiSettings({ highTemperatureC: normalizeSettingNumber(settingsTemperature.value, DEFAULT_UI_SETTINGS.highTemperatureC, 0, 150) });
  },
  onSettingsStaleMinutesChange: () => {
    updateUiSettings({ stalePollMinutes: normalizeSettingNumber(settingsStaleMinutes.value, DEFAULT_UI_SETTINGS.stalePollMinutes, 1, 1440) });
  },
  onSettingsReset: () => {
    uiSettings = { ...DEFAULT_UI_SETTINGS };
    selectedUtilizationGpuType = uiSettings.selectedUtilizationGpuType;
    persistUiSettings(UI_SETTINGS_KEY, uiSettings);
    applyUiSettings();
    renderMachinesSorted();
    if (lastKnownHealth) {
      renderHealth(lastKnownHealth);
    }
    if (latestFleetHistoryPayload) {
      renderFleetTrends(latestFleetHistoryPayload);
    }
  },
  onSort: handleSort,
  onTrendRangeChange: (hours, button) => {
    selectedTrendHours = hours;
    trendRange.querySelectorAll("[data-hours]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    persistStateToUrl();
    loadDashboard().catch((error) => console.error(error));
  },
  onTrendGpuChange: () => {
    selectedUtilizationGpuType = trendUtilGpuSelect.value || "__fleet__";
    updateUiSettings({ selectedUtilizationGpuType });
    if (latestFleetHistoryPayload) {
      renderFleetTrends(latestFleetHistoryPayload);
    }
  },
  onFiltersChanged: () => {
    persistStateToUrl();
    renderMachinesSorted();
  },
  onFilterReset: () => {
    filterSearch.value = "";
    filterStatus.value = "all";
    filterListed.value = "all";
    filterDc.value = "all";
    filterErrors.checked = false;
    filterReports.checked = false;
    filterMaint.checked = false;
    persistStateToUrl();
    renderMachinesSorted();
  },
  onEarningsPrev: () => {
    selectedEarningsDate = shiftUtcDate(selectedEarningsDate, -1);
    persistStateToUrl();
    loadDashboard().catch((error) => console.error(error));
  },
  onEarningsNext: () => {
    const nextDate = shiftUtcDate(selectedEarningsDate, 1);
    if (nextDate > todayUtcDateString()) {
      return;
    }

    selectedEarningsDate = nextDate;
    persistStateToUrl();
    loadDashboard().catch((error) => console.error(error));
  }
});

bindMachineInteractions({
  machinesBody,
  modalTitle,
  onMachineRowClick: handleMachineRowClick,
  onCopyMachineId: (machineId, button) => {
    copyMachineId(machineId, button).catch((error) => console.error(error));
  },
  onCopyIpAddress: (ipAddress, button) => {
    copyMachineIpAddress(ipAddress, button).catch((error) => console.error(error));
  }
});

bindModalControls({
  modalBackdrop,
  modalClose,
  modalPrev,
  modalNext,
  modalTabs,
  modalHistoryRange,
  reportsModalBackdrop,
  reportsModalClose,
  reportsPrevButton,
  reportsNextButton,
  onCloseMachineModal: () => {
    clearChartSyncGroup("machine-modal");
    modalBackdrop.classList.add("hidden");
  },
  onPrevMachine: () => {
    navigateMachineHistory(-1);
  },
  onNextMachine: () => {
    navigateMachineHistory(1);
  },
  onSetModalTab: setModalTab,
  onModalHistoryRangeChange: (hours, button) => {
    currentMachineHistoryHours = hours;
    modalHistoryRange.querySelectorAll("[data-hours]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    if (currentMachineHistoryId != null) {
      showMachineHistory(currentMachineHistoryId).catch((error) => console.error(error));
    }
  },
  onCloseReportsModal: () => {
    reportsModalBackdrop.classList.add("hidden");
  },
  onPrevReport: () => {
    if (currentReportIndex <= 0) {
      return;
    }

    currentReportIndex -= 1;
    renderCurrentReport();
  },
  onNextReport: () => {
    if (currentReportIndex >= currentReports.length - 1) {
      return;
    }

    currentReportIndex += 1;
    renderCurrentReport();
  },
  isSettingsOpen: () => !settingsBackdrop.classList.contains("hidden"),
  closeSettings: () => {
    settingsBackdrop.classList.add("hidden");
  },
  isMachineModalOpen: () => !modalBackdrop.classList.contains("hidden"),
  isReportsModalOpen: () => !reportsModalBackdrop.classList.contains("hidden"),
  canGoPrevMachine: () => !modalPrev.disabled,
  canGoNextMachine: () => !modalNext.disabled,
  canGoPrevReport: () => !reportsPrevButton.disabled,
  canGoNextReport: () => !reportsNextButton.disabled
});

bindReportGestureHandlers({
  machinesBody,
  onBeginLongPress: beginReportLongPress,
  onCancelLongPress: cancelReportLongPress,
  shouldPreventContextMenu: (event) => {
    const trigger = getReportTriggerFromEventTarget(event.target);
    if (!trigger) {
      return false;
    }

    return reportLongPressActiveMachineId != null || Date.now() < suppressRowClickUntil;
  }
});
