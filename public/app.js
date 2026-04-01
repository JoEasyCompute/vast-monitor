import {
  escapeHtml,
  formatChartTimestamp,
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
import { buildDbAdminPanelMarkup } from "./app/db-admin-panel.js";
import { createDashboardController } from "./app/dashboard-controller.js";
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
  getAvailableGpuTypes,
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
  buildModalAnnotationsMarkup,
  buildCalendarMonthEarningsSummaries,
  buildModalEarningsBreakdownMarkup,
  buildModalSummaryMarkup,
  buildModalTimelineMarkup,
  formatGpuMachineLabel
} from "./app/machine-modal.js";

const dashboard = document.getElementById("dashboard") || createOptionalElement();
const carouselGroups = [
  document.getElementById("carousel-group-primary"),
  document.getElementById("carousel-group-secondary")
].filter(Boolean);
const summaryGrid = document.getElementById("summary-grid");
const summaryCompareGrid = document.getElementById("summary-compare-grid");
const breakdownBody = document.getElementById("breakdown-body");
const machinesBody = document.getElementById("machines-body");
const machinesEmptyState = document.getElementById("machines-empty-state");
const alertsList = document.getElementById("alerts-list");
const alertsMeta = document.getElementById("alerts-meta");
const lastUpdated = document.getElementById("last-updated");
const refreshButton = document.getElementById("refresh-button");
const hourlyChart = document.getElementById("hourly-chart");
const earningsTotal = document.getElementById("earnings-total");
const earningsAvg = document.getElementById("earnings-avg") || createOptionalElement();
const earningsDate = document.getElementById("earnings-date");
const earningsPrevButton = document.getElementById("earnings-prev");
const earningsNextButton = document.getElementById("earnings-next");
const summaryMeta = document.getElementById("summary-meta");
const breakdownMeta = document.getElementById("breakdown-meta");
const earningsMeta = document.getElementById("earnings-meta");
const dashboardNotice = document.getElementById("dashboard-notice");
const dashboardToast = document.getElementById("dashboard-toast");
const staleWarning = document.getElementById("stale-warning");
const healthBadge = document.getElementById("health-badge");
const trendRange = document.getElementById("trend-range");
const fleetTrendsMeta = document.getElementById("fleet-trends-meta");
const trendGpusChart = document.getElementById("trend-gpus-chart");
const trendFleetChart = document.getElementById("trend-fleet-chart");
const trendUtilChart = document.getElementById("trend-util-chart");
const trendUtilGpuSelect = document.getElementById("trend-util-gpu-select");
const trendPriceChart = document.getElementById("trend-price-chart");
const pollMonitorGrid = document.getElementById("poll-monitor-grid");
const pollMonitorMeta = document.getElementById("poll-monitor-meta");
const dbAdminPanel = document.getElementById("db-admin-panel");
const dbAdminMeta = document.getElementById("db-admin-meta");
const filterSearch = document.getElementById("filter-search");
const filterStatus = document.getElementById("filter-status");
const filterListed = document.getElementById("filter-listed");
const filterDc = document.getElementById("filter-dc");
const filterGpuSelect = document.getElementById("filter-gpu-select");
const filterOwner = document.getElementById("filter-owner") || createOptionalElement();
const filterTeam = document.getElementById("filter-team") || createOptionalElement();
const filterErrors = document.getElementById("filter-errors");
const filterReports = document.getElementById("filter-reports");
const filterMaint = document.getElementById("filter-maint");
const filterReset = document.getElementById("filter-reset");
const activeGpuFilterRow = document.getElementById("machine-active-filter-row");
const activeGpuFilterSummary = document.getElementById("machine-active-filter-summary");
const activeGpuFilterList = document.getElementById("machine-active-gpu-filter-list");
const densityToggle = document.getElementById("density-toggle");
const machinesScroll = document.getElementById("machines-scroll");
const machineViewTabs = document.getElementById("machine-view-tabs");
const settingsButton = document.getElementById("settings-button");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsClose = document.getElementById("settings-close");
const settingsDashboardMode = document.getElementById("settings-dashboard-mode") || createOptionalElement();
const settingsDensity = document.getElementById("settings-density");
const settingsReliability = document.getElementById("settings-reliability");
const settingsTemperature = document.getElementById("settings-temperature");
const settingsStaleMinutes = document.getElementById("settings-stale-minutes");
const settingsAdminToken = document.getElementById("settings-admin-token");
const settingsAdminTokenToggle = document.getElementById("settings-admin-token-toggle");
const settingsAdminTokenClear = document.getElementById("settings-admin-token-clear");
const settingsReset = document.getElementById("settings-reset");

const DEFAULT_UI_SETTINGS = {
  dashboardMode: "normal",
  tableDensity: "comfortable",
  lowReliabilityPct: 90,
  highTemperatureC: 85,
  stalePollMinutes: 15,
  adminApiToken: "",
  selectedUtilizationGpuType: "__fleet__"
};
const UI_SETTINGS_KEY = "vast-monitor-ui-settings";
const MACHINE_FILTERS_KEY = "vast-monitor-machine-filters";
const CAROUSEL_INTERVAL_MS = 10 * 1000;
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
let currentGpuTypeBreakdown = [];
let latestFleetHistoryPayload = null;
let latestGpuTypePricePayload = null;
let latestHourlyEarningsPayload = null;
let latestDbHealthPayload = null;
let latestRetentionPreview = null;
let retentionPreviewError = "";
let retentionPreviewLoading = false;
let latestAnalyzeResult = null;
let analyzeError = "";
let analyzeLoading = false;
let latestVacuumResult = null;
let vacuumError = "";
let vacuumLoading = false;
let latestPollMonitorAt = null;
let lastKnownHealth = null;
let selectedUtilizationGpuType = uiSettings.selectedUtilizationGpuType || "__fleet__";
let isAdminTokenVisible = false;
let currentModalMachine = null;
let currentModalHistory = [];
let currentModalEarningsData = null;
let currentModalTab = "charts";
let activeMachineView = "active";
let latestObservability = null;
let activeGpuFilters = [];
const REPORT_LONG_PRESS_MS = 550;
let reportLongPressTimer = null;
let reportLongPressActiveMachineId = null;
let suppressRowClickUntil = 0;
const copyFeedbackTimers = new WeakMap();
let dashboardToastTimer = null;
let manualRefreshInFlight = false;
let dashboardCarouselTimer = null;
let dashboardCarouselRedrawTimer = null;
let activeCarouselGroupIndex = 0;
const loadedExtensionAssets = {
  scripts: new Set(),
  styles: new Set()
};
initializeStateFromUrl();

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
  renderActiveGpuFilters(sorted.length);
  updateFilterResetState();
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
    gpuTypes: [...activeGpuFilters],
    owner: filterOwner.value,
    team: filterTeam.value,
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

function toggleGpuFilter(gpuType) {
  const normalized = String(gpuType || "").trim();
  if (!normalized) {
    return;
  }

  activeGpuFilters = activeGpuFilters.includes(normalized)
    ? activeGpuFilters.filter((value) => value !== normalized)
    : [...activeGpuFilters, normalized];
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

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
}

function renderSummaryMeta(latestPollAt) {
  summaryMeta.textContent = buildSectionMeta("SQLite fleet snapshot", latestPollAt);
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
        <td><button
          type="button"
          class="breakdown-gpu-filter"
          data-gpu-filter="${escapeHtml(row.gpu_type)}"
          aria-pressed="${activeGpuFilters.includes(row.gpu_type)}"
          title="${activeGpuFilters.includes(row.gpu_type) ? `Remove ${escapeHtml(row.gpu_type)} GPU filter` : `Filter machines by ${escapeHtml(row.gpu_type)}`}"
        >${escapeHtml(row.gpu_type)}</button></td>
        <td class="breakdown-num-col">${row.machines}</td>
        <td class="breakdown-gpus-col">${row.listed_gpus}/${row.unlisted_gpus}</td>
        <td><span class="util-chip ${utilClass(row.utilisation_pct)}">${row.utilisation_pct}%</span></td>
        <td class="breakdown-num-col">${row.avg_price == null ? "-" : `$${row.avg_price.toFixed(3)}`}</td>
        <td class="breakdown-num-col">$${row.earnings.toFixed(2)}</td>
      </tr>
    `)
    .join("");

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
}

function renderBreakdownMeta(latestPollAt) {
  breakdownMeta.textContent = buildSectionMeta("Grouped from latest poll", latestPollAt);
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

function renderActiveGpuFilters(resultCount) {
  if (!activeGpuFilterRow || !activeGpuFilterSummary || !activeGpuFilterList) {
    return;
  }

  if (activeGpuFilters.length === 0) {
    activeGpuFilterSummary.textContent = "";
    activeGpuFilterList.innerHTML = "";
    activeGpuFilterRow.classList.add("hidden");
    return;
  }

  const machineLabel = resultCount === 1 ? "machine" : "machines";
  activeGpuFilterSummary.textContent = `GPU filters (${activeGpuFilters.length}) · ${resultCount} ${machineLabel}`;
  activeGpuFilterList.innerHTML = activeGpuFilters
    .map((gpuType) => `
      <button
        type="button"
        class="machine-filter-chip active"
        data-remove-gpu-filter="${escapeHtml(gpuType)}"
        title="Remove GPU filter for ${escapeHtml(gpuType)}"
        aria-label="Remove GPU filter for ${escapeHtml(gpuType)}"
      >
        <span>${escapeHtml(gpuType)}</span>
        <span class="machine-filter-chip-close" aria-hidden="true">&times;</span>
      </button>
    `)
    .join("");
  activeGpuFilterRow.classList.remove("hidden");
}

function updateFilterGpuSelectOptions() {
  if (!filterGpuSelect) {
    return;
  }

  const options = getAvailableGpuTypes(currentMachinesData)
    .map((gpuType) => `<option value="${escapeHtml(gpuType)}">${escapeHtml(gpuType)}</option>`)
    .join("");

  filterGpuSelect.innerHTML = `<option value="">GPU...</option>${options}`;
  filterGpuSelect.disabled = options.length === 0;
  filterGpuSelect.value = "";
}

function getActiveFilterCount() {
  let count = 0;
  if (filterSearch.value.trim()) count += 1;
  if (filterStatus.value !== "all") count += 1;
  if (filterListed.value !== "all") count += 1;
  if (filterDc.value !== "all") count += 1;
  if (filterOwner.value.trim()) count += 1;
  if (filterTeam.value.trim()) count += 1;
  if (filterErrors.checked) count += 1;
  if (filterReports.checked) count += 1;
  if (filterMaint.checked) count += 1;
  count += activeGpuFilters.length;
  return count;
}

function updateFilterResetState() {
  if (!filterReset) {
    return;
  }

  const activeFilterCount = getActiveFilterCount();
  filterReset.textContent = activeFilterCount > 0 ? `Clear (${activeFilterCount})` : "Clear";
  filterReset.classList.toggle("active", activeFilterCount > 0);
  filterReset.setAttribute(
    "title",
    activeFilterCount > 0
      ? `Clear ${activeFilterCount} active machine filter${activeFilterCount === 1 ? "" : "s"}`
      : "Clear all machine-table filters and return to the default filter state."
  );
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

function renderModalSummary(machine, machineHistory = []) {
  modalSummary.innerHTML = buildModalSummaryMarkup(machine, machineHistory);
  const annotationsMarkup = buildModalAnnotationsMarkup(machine);
  modalAnnotations.innerHTML = annotationsMarkup;
  modalAnnotations.classList.toggle("hidden", !annotationsMarkup);
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
  const realizedHours = data.hours.filter((h) => !(isToday && h.hour > currentHour));
  const averageHourlyEarnings = realizedHours.length > 0 ? data.total / realizedHours.length : 0;

  earningsTotal.textContent = `$${data.total.toFixed(2)}`;
  earningsAvg.textContent = `Avg Hourly Earnings: $${averageHourlyEarnings.toFixed(2)}`;
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
  earningsMeta.textContent = buildSectionMeta(`Stored hourly estimate for ${data.date}`, data.generated_at || null);

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
}

function renderHourlyEarningsUnavailable() {
  earningsTotal.textContent = "--";
  earningsAvg.textContent = "Avg Hourly Earnings: --";
  earningsDate.textContent = selectedEarningsDate;
  hourlyChart.innerHTML = '<div class="section-placeholder"><p class="muted">Hourly earnings are temporarily unavailable.</p></div>';
  earningsNextButton.disabled = selectedEarningsDate === todayUtcDateString();
  earningsMeta.textContent = "Stored hourly estimates unavailable";

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
}

function renderAlerts(rows) {
  if (rows.length === 0) {
    alertsList.innerHTML = '<p class="muted">No alerts yet.</p>';
    alertsMeta.textContent = "Source: recent alert history";
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
  alertsMeta.textContent = "Source: recent alert history";
}

function renderAlertsUnavailable() {
  alertsList.innerHTML = '<div class="section-placeholder"><p class="muted">Alerts are temporarily unavailable.</p></div>';
  alertsMeta.textContent = "Recent alert feed unavailable";
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

function renderFleetHistoryUnavailable() {
  renderTrendUnavailable(trendGpusChart, "Fleet trends unavailable");
  renderTrendUnavailable(trendFleetChart, "Fleet trends unavailable");
  renderTrendUnavailable(trendUtilChart, "Utilisation unavailable");

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
}

function renderGpuTypePriceUnavailable() {
  renderTrendUnavailable(trendPriceChart, "GPU pricing unavailable");

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
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
  fleetTrendsMeta.textContent = buildSectionMeta(`SQLite snapshots, ${selectedTrendHours}h window`, payload?.history?.at?.(-1)?.polled_at || null);

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
}

function renderGpuTypePriceTrends(payload) {
  const normalized = normalizeGpuTypePriceHistory(payload);
  if (!normalized.history.length || !normalized.series.length) {
    trendPriceChart.innerHTML = `<text x="360" y="90" text-anchor="middle" class="chart-empty">No GPU-type price history yet</text>`;
    if (isCarouselMode()) {
      syncCarouselGroupHeights();
    }
    return;
  }

  drawMultiSeriesChart(trendPriceChart, normalized.history, normalized.series, {
    formatValue: (value) => formatCurrency(value)
  });

  if (isCarouselMode()) {
    syncCarouselGroupHeights();
  }
}

function renderPollMonitor(observability, latestPollAt, dbHealth = null) {
  latestObservability = observability || null;
  const items = [
    ["Poll", formatMetricDuration(observability?.lastPollDurationMs)],
    ["Fetch", formatMetricDuration(observability?.lastFetchDurationMs)],
    ["Persist", formatMetricDuration(observability?.lastPersistDurationMs)],
    ["Alerts", formatMetricDuration(observability?.lastAlertDispatchDurationMs)],
    ["Online", observability?.lastOnlineMachineCount ?? 0],
    ["Offline", observability?.lastOfflineMachineCount ?? 0],
    ["Events", observability?.lastEventCount ?? 0],
    ["Sent", observability?.lastAlertCount ?? 0]
  ];
  if (dbHealth?.database) {
    items.push(
      ["DB Size", formatDbSize(dbHealth.database.file_size_bytes)],
      ["DB Polls", dbHealth.database.row_counts?.polls ?? 0],
      ["DB Snap", dbHealth.database.row_counts?.machine_snapshots ?? 0],
      ["DB Rollups", (dbHealth.database.row_counts?.machine_snapshot_hourly_rollups ?? 0) + (dbHealth.database.row_counts?.fleet_snapshot_hourly_rollups ?? 0)]
    );
  }

  pollMonitorGrid.innerHTML = items.map(([label, value]) => `
    <article class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(String(value))}</strong>
    </article>
  `).join("");
  const dbHealthNote = dbHealth?.database ? " · DB admin health enabled" : uiSettings.adminApiToken ? " · DB admin health unavailable" : "";
  pollMonitorMeta.textContent = `${buildSectionMeta("Last completed poll", latestPollAt)}${dbHealthNote}`;
}

function renderDbAdminPanel(dbHealth = null) {
  if (!dbAdminPanel || !dbAdminMeta) {
    return;
  }

  const { markup, meta } = buildDbAdminPanelMarkup({
    dbHealth,
    hasAdminToken: Boolean(uiSettings.adminApiToken.trim()),
    retentionPreview: latestRetentionPreview,
    retentionPreviewLoading,
    retentionPreviewError,
    analyzeResult: latestAnalyzeResult,
    analyzeLoading,
    analyzeError,
    vacuumResult: latestVacuumResult,
    vacuumLoading,
    vacuumError
  });
  dbAdminPanel.innerHTML = markup;
  dbAdminMeta.textContent = meta;
}

async function fetchAdminJson(path, init = {}) {
  const token = uiSettings.adminApiToken.trim();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

function formatDbSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 1024) {
    return size ? `${size} B` : "--";
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ensureClientExtensionsLoaded(extensions) {
  const scripts = Array.isArray(extensions?.scripts) ? extensions.scripts : [];
  const styles = Array.isArray(extensions?.styles) ? extensions.styles : [];

  for (const href of styles) {
    if (!href || loadedExtensionAssets.styles.has(href)) {
      continue;
    }

    const existing = document.querySelector(`link[data-plugin-style="${CSS.escape(href)}"]`);
    if (existing) {
      loadedExtensionAssets.styles.add(href);
      continue;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.pluginStyle = href;
    document.head.appendChild(link);
    loadedExtensionAssets.styles.add(href);
  }

  for (const src of scripts) {
    if (!src || loadedExtensionAssets.scripts.has(src)) {
      continue;
    }

    const existing = document.querySelector(`script[data-plugin-script="${CSS.escape(src)}"]`);
    if (existing) {
      loadedExtensionAssets.scripts.add(src);
      continue;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.pluginScript = src;
    document.head.appendChild(script);
    loadedExtensionAssets.scripts.add(src);
  }
}

function buildSectionMeta(sourceLabel, timestamp) {
  if (!timestamp) {
    return `Source: ${sourceLabel}`;
  }

  return `Source: ${sourceLabel}. Updated ${formatChartTimestamp(timestamp)}`;
}

function formatMetricDuration(value) {
  return Number.isFinite(value) ? formatDuration(value) : "-";
}

function createOptionalElement() {
  return {
    value: "",
    checked: false,
    innerHTML: "",
    textContent: "",
    classList: {
      add() {},
      remove() {},
      toggle() { return false; }
    },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return ""; }
  };
}

function isCarouselMode() {
  return uiSettings.dashboardMode === "carousel";
}

function syncCarouselGroupHeights() {
  if (!dashboard || !carouselGroups.length) {
    return;
  }

  if (!isCarouselMode()) {
    carouselGroups.forEach((group) => {
      group.style.minHeight = "";
      group.classList.remove("is-measuring");
    });
    return;
  }

  carouselGroups.forEach((group) => {
    group.style.minHeight = "";
    group.classList.add("is-measuring");
  });

  const maxHeight = Math.max(...carouselGroups.map((group) => group.offsetHeight), 0);

  carouselGroups.forEach((group) => {
    group.classList.remove("is-measuring");
    group.style.minHeight = maxHeight > 0 ? `${maxHeight}px` : "";
  });
}

function queueCarouselChartRedraw() {
  if (dashboardCarouselRedrawTimer) {
    window.clearTimeout(dashboardCarouselRedrawTimer);
  }

  dashboardCarouselRedrawTimer = window.setTimeout(() => {
    dashboardCarouselRedrawTimer = null;

    if (!isCarouselMode()) {
      syncCarouselGroupHeights();
      redrawChartsForCurrentLayout();
      return;
    }

    if (activeCarouselGroupIndex === 0 && latestHourlyEarningsPayload) {
      renderHourlyEarnings(latestHourlyEarningsPayload);
    } else if (activeCarouselGroupIndex === 1) {
      if (latestFleetHistoryPayload) {
        renderFleetTrends(latestFleetHistoryPayload);
      }
      if (latestGpuTypePricePayload) {
        renderGpuTypePriceTrends(latestGpuTypePricePayload);
      }
    }

    syncCarouselGroupHeights();
  }, 60);
}

function applyCarouselMode(animate = false) {
  if (!dashboard || !carouselGroups.length) {
    return;
  }

  const carouselActive = isCarouselMode();
  dashboard.classList.toggle("carousel-mode", carouselActive);

  carouselGroups.forEach((group, index) => {
    const isActive = !carouselActive || index === activeCarouselGroupIndex;
    group.classList.toggle("is-active", isActive);
    group.classList.toggle("is-hidden", carouselActive && !isActive);
    group.classList.remove("carousel-animate");
  });

  if (carouselActive && animate) {
    const activeGroup = carouselGroups[activeCarouselGroupIndex];
    if (activeGroup) {
      void activeGroup.offsetWidth;
      activeGroup.classList.add("carousel-animate");
    }
  }

  queueCarouselChartRedraw();
}

function stopDashboardCarousel() {
  if (dashboardCarouselTimer) {
    window.clearInterval(dashboardCarouselTimer);
    dashboardCarouselTimer = null;
  }
}

function startDashboardCarousel() {
  stopDashboardCarousel();
  if (!isCarouselMode() || carouselGroups.length < 2) {
    return;
  }

  dashboardCarouselTimer = window.setInterval(() => {
    activeCarouselGroupIndex = (activeCarouselGroupIndex + 1) % carouselGroups.length;
    applyCarouselMode(true);
  }, CAROUSEL_INTERVAL_MS);
}

function syncDashboardMode() {
  if (!isCarouselMode()) {
    stopDashboardCarousel();
    activeCarouselGroupIndex = 0;
    applyCarouselMode(false);
    return;
  }

  applyCarouselMode(false);
  startDashboardCarousel();
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
  filterOwner.value = initialState.filterOwner;
  filterTeam.value = initialState.filterTeam;
  activeGpuFilters = [...initialState.filterGpuTypes];
  filterErrors.checked = initialState.filterErrors;
  filterReports.checked = initialState.filterReports;
  filterMaint.checked = initialState.filterMaint;
  activeMachineView = initialState.activeMachineView;

  trendRange.querySelectorAll("[data-hours]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.hours) === selectedTrendHours);
  });

  applyUiSettings();
  saveMachineFilters();
  updateFilterResetState();
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
    filterOwner: filterOwner.value,
    filterTeam: filterTeam.value,
    filterGpuTypes: activeGpuFilters,
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
    owner: filterOwner.value,
    team: filterTeam.value,
    gpuTypes: activeGpuFilters,
    errors: filterErrors.checked,
    reports: filterReports.checked,
    maint: filterMaint.checked,
    machineTab: activeMachineView
  });
}

function applyUiSettings() {
  settingsDashboardMode.value = uiSettings.dashboardMode === "carousel" ? "carousel" : "normal";
  machinesScroll.classList.toggle("compact-density", uiSettings.tableDensity === "compact");
  densityToggle.querySelectorAll("[data-density]").forEach((button) => {
    button.classList.toggle("active", button.dataset.density === uiSettings.tableDensity);
  });
  settingsDensity.value = uiSettings.tableDensity;
  settingsReliability.value = String(uiSettings.lowReliabilityPct);
  settingsTemperature.value = String(uiSettings.highTemperatureC);
  settingsStaleMinutes.value = String(uiSettings.stalePollMinutes);
  settingsAdminToken.value = uiSettings.adminApiToken;
  settingsAdminToken.type = isAdminTokenVisible ? "text" : "password";
  settingsAdminTokenToggle.textContent = isAdminTokenVisible ? "Hide" : "Show";
}

function updateUiSettings(nextSettings) {
  uiSettings = {
    ...uiSettings,
    ...nextSettings
  };
  selectedUtilizationGpuType = uiSettings.selectedUtilizationGpuType || "__fleet__";
  persistUiSettings(UI_SETTINGS_KEY, uiSettings);
  applyUiSettings();
  syncDashboardMode();
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

updateSortHeaders();

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
const modalAnnotations = document.getElementById("modal-annotations") || createOptionalElement();
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
    modalAnnotations,
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

const dashboardController = createDashboardController({
  getSelectedEarningsDate: () => selectedEarningsDate,
  getSelectedTrendHours: () => selectedTrendHours,
  getAdminApiToken: () => uiSettings.adminApiToken,
  fetchDashboardPayload,
  renderDashboardNotice,
  applyStatusPayload: (status) => {
    ensureClientExtensionsLoaded(status.extensions);
    currentMachinesData = Array.isArray(status.machines) ? status.machines : [];
    currentGpuTypeBreakdown = Array.isArray(status.gpuTypeBreakdown) ? status.gpuTypeBreakdown : [];
    latestPollMonitorAt = status.latestPollAt || null;
    updateFilterGpuSelectOptions();
    renderSummary(status.summary);
    renderSummaryMeta(status.latestPollAt);
    renderSummaryComparison(status.summary?.comparison24h);
    renderBreakdown(currentGpuTypeBreakdown);
    renderBreakdownMeta(status.latestPollAt);
    renderMachinesSorted();
    lastKnownHealth = status.health;
    renderHealth(status.health);
    renderPollMonitor(status.observability, latestPollMonitorAt, latestDbHealthPayload);
    lastUpdated.textContent = status.latestPollAt
      ? `Last updated ${new Date(status.latestPollAt).toLocaleString()}`
      : "No poll data yet";
  },
  applyDbHealthPayload: (payload) => {
    latestDbHealthPayload = payload;
    renderPollMonitor(latestObservability, latestPollMonitorAt, latestDbHealthPayload);
    renderDbAdminPanel(latestDbHealthPayload);
  },
  applyFleetHistoryPayload: (payload) => {
    latestFleetHistoryPayload = payload;
    renderFleetTrends(payload);
  },
  applyGpuTypePricePayload: (payload) => {
    latestGpuTypePricePayload = payload;
    renderGpuTypePriceTrends(payload);
  },
  applyHourlyEarningsPayload: (payload) => {
    latestHourlyEarningsPayload = payload;
    renderHourlyEarnings(payload);
  },
  applyAlertsPayload: (payload) => {
    renderAlerts(Array.isArray(payload.alerts) ? payload.alerts : []);
  },
  renderFleetHistoryUnavailable,
  renderGpuTypePriceUnavailable,
  renderHourlyEarningsUnavailable,
  renderAlertsUnavailable,
  hasFleetHistoryPayload: () => Boolean(latestFleetHistoryPayload),
  hasGpuTypePricePayload: () => Boolean(latestGpuTypePricePayload),
  hasHourlyEarningsPayload: () => Boolean(latestHourlyEarningsPayload),
  hasAlertsRendered: () => Boolean(alertsList.innerHTML),
  isMachineModalOpen: () => !modalBackdrop.classList.contains("hidden"),
  getCurrentMachineHistoryId: () => currentMachineHistoryId,
  refreshCurrentMachineModal: (machineId) => {
    showMachineHistory(machineId, { preserveScroll: true }).catch((error) => console.error(error));
  },
  handleRefreshFailure: (error) => {
    console.error(error);
    renderDashboardNotice([{ label: "dashboard data", critical: true }]);
    healthBadge.className = "health-badge degraded";
    healthBadge.textContent = "Degraded";
    lastUpdated.textContent = "Dashboard refresh incomplete";
  }
});

refreshDashboard();
dashboardController.startAutoRefresh(5 * 60 * 1000);

function refreshDashboard() {
  if (manualRefreshInFlight) {
    return Promise.resolve();
  }

  manualRefreshInFlight = true;
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
  }

  return dashboardController.refreshDashboard().finally(() => {
    renderDbAdminPanel(latestDbHealthPayload);
    manualRefreshInFlight = false;
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  });
}

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
  showDashboardToast("Copied");

  const timer = window.setTimeout(() => {
    button.classList.remove("copied");
    button.setAttribute("title", button.dataset.copyTitle || "");
    copyFeedbackTimers.delete(button);
  }, 1200);

  copyFeedbackTimers.set(button, timer);
}

function showDashboardToast(message) {
  if (!dashboardToast) {
    return;
  }

  if (dashboardToastTimer) {
    window.clearTimeout(dashboardToastTimer);
  }

  dashboardToast.textContent = message;
  dashboardToast.classList.add("visible");
  dashboardToast.classList.remove("hidden");

  dashboardToastTimer = window.setTimeout(() => {
    dashboardToast.classList.remove("visible");
    dashboardToast.classList.add("hidden");
  }, 1400);
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

syncDashboardMode();

bindWindowResize({
  onResize: () => {
    if (isCarouselMode()) {
      queueCarouselChartRedraw();
      return;
    }

    redrawChartsForCurrentLayout();
  }
});

bindDashboardControls({
  machineViewTabs,
  densityToggle,
  settingsButton,
  settingsBackdrop,
  settingsClose,
  settingsDashboardMode,
  settingsDensity,
  settingsReliability,
  settingsTemperature,
  settingsStaleMinutes,
  settingsAdminToken,
  settingsAdminTokenToggle,
  settingsAdminTokenClear,
  settingsReset,
  trendRange,
  trendUtilGpuSelect,
  breakdownBody,
  activeGpuFilterList,
  filterGpuSelect,
  filterControls: [
    filterSearch,
    filterStatus,
    filterListed,
    filterDc,
    filterOwner,
    filterTeam,
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
  onSettingsDashboardModeChange: () => {
    updateUiSettings({ dashboardMode: settingsDashboardMode.value === "carousel" ? "carousel" : "normal" });
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
  onSettingsAdminTokenChange: () => {
    updateUiSettings({ adminApiToken: settingsAdminToken.value.trim() });
    latestDbHealthPayload = null;
    latestRetentionPreview = null;
    retentionPreviewError = "";
    retentionPreviewLoading = false;
    latestAnalyzeResult = null;
    analyzeError = "";
    analyzeLoading = false;
    latestVacuumResult = null;
    vacuumError = "";
    vacuumLoading = false;
    renderPollMonitor(latestObservability, latestPollMonitorAt, latestDbHealthPayload);
    renderDbAdminPanel(latestDbHealthPayload);
    refreshDashboard().catch((error) => console.error(error));
  },
  onToggleAdminTokenVisibility: () => {
    isAdminTokenVisible = !isAdminTokenVisible;
    applyUiSettings();
    settingsAdminToken.focus();
  },
  onClearAdminToken: () => {
    isAdminTokenVisible = false;
    updateUiSettings({ adminApiToken: "" });
    latestDbHealthPayload = null;
    latestRetentionPreview = null;
    retentionPreviewError = "";
    retentionPreviewLoading = false;
    latestAnalyzeResult = null;
    analyzeError = "";
    analyzeLoading = false;
    latestVacuumResult = null;
    vacuumError = "";
    vacuumLoading = false;
    renderPollMonitor(latestObservability, latestPollMonitorAt, latestDbHealthPayload);
    renderDbAdminPanel(latestDbHealthPayload);
    refreshDashboard().catch((error) => console.error(error));
    settingsAdminToken.focus();
  },
  onSettingsReset: () => {
    uiSettings = { ...DEFAULT_UI_SETTINGS };
    selectedUtilizationGpuType = uiSettings.selectedUtilizationGpuType;
    latestDbHealthPayload = null;
    latestRetentionPreview = null;
    retentionPreviewError = "";
    retentionPreviewLoading = false;
    latestAnalyzeResult = null;
    analyzeError = "";
    analyzeLoading = false;
    latestVacuumResult = null;
    vacuumError = "";
    vacuumLoading = false;
    isAdminTokenVisible = false;
    persistUiSettings(UI_SETTINGS_KEY, uiSettings);
    applyUiSettings();
    syncDashboardMode();
    renderPollMonitor(latestObservability, latestPollMonitorAt, latestDbHealthPayload);
    renderDbAdminPanel(latestDbHealthPayload);
    renderMachinesSorted();
    if (lastKnownHealth) {
      renderHealth(lastKnownHealth);
    }
    if (latestFleetHistoryPayload) {
      renderFleetTrends(latestFleetHistoryPayload);
    }
    refreshDashboard().catch((error) => console.error(error));
  },
  onSort: handleSort,
  onTrendRangeChange: (hours, button) => {
    selectedTrendHours = hours;
    trendRange.querySelectorAll("[data-hours]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    persistStateToUrl();
    refreshDashboard().catch((error) => console.error(error));
  },
  onTrendGpuChange: () => {
    selectedUtilizationGpuType = trendUtilGpuSelect.value || "__fleet__";
    updateUiSettings({ selectedUtilizationGpuType });
    if (latestFleetHistoryPayload) {
      renderFleetTrends(latestFleetHistoryPayload);
    }
  },
  onGpuFilterSelect: () => {
    const nextGpuType = filterGpuSelect.value || "";
    if (!nextGpuType) {
      return;
    }
    toggleGpuFilter(nextGpuType);
    filterGpuSelect.value = "";
    persistStateToUrl();
    renderBreakdown(currentGpuTypeBreakdown);
    renderMachinesSorted();
    filterGpuSelect.focus();
  },
  onBreakdownGpuClick: (gpuType) => {
    toggleGpuFilter(gpuType);
    persistStateToUrl();
    renderBreakdown(currentGpuTypeBreakdown);
    renderMachinesSorted();
  },
  onRemoveGpuFilter: (gpuType) => {
    if (!gpuType) {
      return;
    }
    activeGpuFilters = activeGpuFilters.filter((value) => value !== gpuType);
    persistStateToUrl();
    renderBreakdown(currentGpuTypeBreakdown);
    renderMachinesSorted();
    filterGpuSelect.value = "";
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
    if (filterGpuSelect) {
      filterGpuSelect.value = "";
    }
    activeGpuFilters = [];
    filterOwner.value = "";
    filterTeam.value = "";
    filterErrors.checked = false;
    filterReports.checked = false;
    filterMaint.checked = false;
    persistStateToUrl();
    renderBreakdown(currentGpuTypeBreakdown);
    renderMachinesSorted();
  },
  onEarningsPrev: () => {
    selectedEarningsDate = shiftUtcDate(selectedEarningsDate, -1);
    persistStateToUrl();
    refreshDashboard().catch((error) => console.error(error));
  },
  onEarningsNext: () => {
    const nextDate = shiftUtcDate(selectedEarningsDate, 1);
    if (nextDate > todayUtcDateString()) {
      return;
    }

    selectedEarningsDate = nextDate;
    persistStateToUrl();
    refreshDashboard().catch((error) => console.error(error));
  }
});

dbAdminPanel?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const actionButton = target.closest("[data-db-admin-action]");
  if (!actionButton) {
    return;
  }

  const action = actionButton.getAttribute("data-db-admin-action") || "";
  if (action === "analyze") {
    analyzeLoading = true;
    analyzeError = "";
    renderDbAdminPanel(latestDbHealthPayload);

    fetchAdminJson("/api/admin/analyze", { method: "POST" })
      .then((payload) => {
        latestAnalyzeResult = payload.analyze || null;
        analyzeError = "";
      })
      .catch((error) => {
        latestAnalyzeResult = null;
        analyzeError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        analyzeLoading = false;
        renderDbAdminPanel(latestDbHealthPayload);
        refreshDashboard().catch((refreshError) => console.error(refreshError));
      });
    return;
  }

  if (action === "vacuum") {
    vacuumLoading = true;
    vacuumError = "";
    renderDbAdminPanel(latestDbHealthPayload);

    fetchAdminJson("/api/admin/vacuum", { method: "POST" })
      .then((payload) => {
        latestVacuumResult = payload.vacuum || null;
        vacuumError = "";
      })
      .catch((error) => {
        latestVacuumResult = null;
        vacuumError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        vacuumLoading = false;
        renderDbAdminPanel(latestDbHealthPayload);
        refreshDashboard().catch((refreshError) => console.error(refreshError));
      });
    return;
  }

  if (action === "clear-retention-preview") {
    latestRetentionPreview = null;
    retentionPreviewError = "";
    retentionPreviewLoading = false;
    renderDbAdminPanel(latestDbHealthPayload);
    return;
  }

  if (action !== "retention-preview") {
    return;
  }

  retentionPreviewLoading = true;
  retentionPreviewError = "";
  renderDbAdminPanel(latestDbHealthPayload);

  fetchAdminJson("/api/admin/retention-preview")
    .then((payload) => {
      latestRetentionPreview = payload.preview || null;
      retentionPreviewError = "";
    })
    .catch((error) => {
      latestRetentionPreview = null;
      retentionPreviewError = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      retentionPreviewLoading = false;
      renderDbAdminPanel(latestDbHealthPayload);
    });
});

refreshButton?.addEventListener("click", () => {
  refreshDashboard().catch((error) => console.error(error));
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
