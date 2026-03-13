const summaryGrid = document.getElementById("summary-grid");
const breakdownBody = document.getElementById("breakdown-body");
const machinesBody = document.getElementById("machines-body");
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
const filterSearch = document.getElementById("filter-search");
const filterStatus = document.getElementById("filter-status");
const filterListed = document.getElementById("filter-listed");
const filterDc = document.getElementById("filter-dc");
const filterErrors = document.getElementById("filter-errors");
const filterReports = document.getElementById("filter-reports");
const filterMaint = document.getElementById("filter-maint");
const filterReset = document.getElementById("filter-reset");

let currentMachinesData = [];
let sortCol = "hostname";
let sortDesc = false;
let selectedEarningsDate = todayUtcDateString();
let selectedTrendHours = 168;
let currentReports = [];
let currentReportIndex = 0;

async function loadDashboard() {
  const [statusResponse, alertsResponse, earningsResponse, fleetHistoryResponse] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/alerts?limit=10"),
    fetch(`/api/earnings/hourly?date=${selectedEarningsDate}`),
    fetch(`/api/fleet/history?hours=${selectedTrendHours}`)
  ]);

  const status = await statusResponse.json();
  const alertsPayload = await alertsResponse.json();
  const earningsPayload = await earningsResponse.json();
  const fleetHistoryPayload = await fleetHistoryResponse.json();

  currentMachinesData = status.machines;

  renderSummary(status.summary);
  renderBreakdown(status.gpuTypeBreakdown);
  renderFleetTrends(fleetHistoryPayload.history || []);
  renderHourlyEarnings(earningsPayload);
  renderMachinesSorted();
  renderAlerts(alertsPayload.alerts);
  renderHealth(status.health);
  lastUpdated.textContent = status.latestPollAt
    ? `Last updated ${new Date(status.latestPollAt).toLocaleString()}`
    : "No poll data yet";
}

function handleSort(col) {
  if (sortCol === col) {
    sortDesc = !sortDesc;
  } else {
    sortCol = col;
    sortDesc = false;
  }
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
  const sorted = [...getFilteredMachines()].sort((a, b) => {
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

  renderMachines(sorted);
}

function getFilteredMachines() {
  const searchTerm = filterSearch.value.trim().toLowerCase();

  return currentMachinesData.filter((row) => {
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

    if (filterReports.checked && (row.num_reports || 0) === 0) {
      return false;
    }

    if (filterMaint.checked && (!Array.isArray(row.machine_maintenance) || row.machine_maintenance.length === 0)) {
      return false;
    }

    return true;
  });
}

function renderSummary(summary) {
  const items = [
    ["Total machines", summary.totalMachines],
    ["DC Tagged", summary.datacenterMachines],
    ["Unlisted", summary.unlistedMachines],
    ["Listed GPUs", summary.listedGpus],
    ["Unlisted GPUs", summary.unlistedGpus],
    ["Occupied GPUs", summary.occupiedGpus],
    ["Utilisation", `${summary.utilisationPct}%`],
    ["Daily earnings", `$${summary.totalDailyEarnings.toFixed(2)}`]
  ];

  summaryGrid.innerHTML = items
    .map(([label, value]) => `
      <article class="stat-card">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `)
    .join("");
}

function renderBreakdown(rows) {
  breakdownBody.innerHTML = rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.gpu_type)}</td>
        <td>${row.machines}</td>
        <td>${row.listed_gpus}</td>
        <td>${row.unlisted_gpus}</td>
        <td><span class="util-chip ${utilClass(row.utilisation_pct)}">${row.utilisation_pct}%</span></td>
        <td>${row.avg_price == null ? "-" : `$${row.avg_price.toFixed(3)}`}</td>
        <td>$${row.earnings.toFixed(2)}</td>
      </tr>
    `)
    .join("");
}

function renderMachines(rows) {
  machinesBody.innerHTML = rows
    .map((row, index) => {
      const reliabilityScore = row.reliability != null ? row.reliability * 100 : null;
      const isLowReliability = reliabilityScore != null && reliabilityScore < 90;
      const hasError = Boolean(row.error_message);
      const rowClass = [hasError ? "machine-error" : "", isLowReliability ? "low-reliability" : ""]
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
        <td>${row.listed_gpu_cost == null ? "-" : `$${Number(row.listed_gpu_cost).toFixed(2)}`}</td>
        <td>${row.current_rentals_running}</td>
        <td>${row.gpu_max_cur_temp == null ? "-" : `${row.gpu_max_cur_temp}C`}</td>
        <td>${renderReports(row)}</td>
        <td>${reliabilityScore == null ? "-" : `${reliabilityScore.toFixed(1)}%`}</td>
        <td>${row.uptime?.["24h"] == null ? "-" : `${row.uptime["24h"]}%`}</td>
        <td><span class="status-pill ${row.status}" title="${getStatusTooltip(row)}">${row.status}</span></td>
      </tr>
    `})
    .join("");
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
          <div class="${barClass}" style="height: ${isFuture ? 0 : Math.max(pct, 1.5)}%"></div>
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

  if (health?.isStale) {
    healthBadge.textContent = "Stale";
    healthBadge.classList.add("stale");
  } else if (health?.pollAgeMs != null && health.pollAgeMs < 30 * 1000) {
    healthBadge.textContent = "Polling";
    healthBadge.classList.add("polling");
  } else {
    healthBadge.textContent = "Healthy";
    healthBadge.classList.add("healthy");
  }

  if (!health?.isStale) {
    staleWarning.classList.add("hidden");
    staleWarning.textContent = "";
    return;
  }

  const ageText = health.pollAgeMs == null
    ? "No successful poll has completed yet."
    : `Last successful poll is ${formatDuration(health.pollAgeMs)} old.`;
  staleWarning.textContent = `Stale data warning. ${ageText}`;
  staleWarning.classList.remove("hidden");
}

function renderFleetTrends(history) {
  drawMultiSeriesChart(trendGpusChart, history, [
    { key: "listed_gpus", label: "Listed GPUs", color: "#60a5fa" },
    { key: "unlisted_gpus", label: "Unlisted GPUs", color: "#f59e0b" }
  ], { formatValue: (value) => `${Math.round(value)}` });

  drawMultiSeriesChart(trendFleetChart, history, [
    { key: "total_machines", label: "Machines", color: "#22c55e" },
    { key: "unlisted_machines", label: "Unlisted", color: "#f59e0b" },
    { key: "datacenter_machines", label: "DC", color: "#60a5fa" }
  ], { formatValue: (value) => `${Math.round(value)}` });

  drawMultiSeriesChart(trendUtilChart, history, [
    { key: "utilisation_pct", label: "Utilisation", color: "#f43f5e" }
  ], { min: 0, max: 100, formatValue: (value) => `${Math.round(value)}%` });
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
  const values = points.flatMap((row) => series.map((item) => Number(row[item.key]) || 0));
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
    const path = buildLinePath(
      points,
      (row) => scaleX(row.timeMs),
      (row) => scaleY(Number(row[item.key]) || 0)
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
      getValue: (row) => Number(row[item.key]) || 0,
      getY: (row) => scaleY(Number(row[item.key]) || 0),
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

loadDashboard().catch((error) => {
  console.error(error);
  lastUpdated.textContent = "Failed to load dashboard";
});

setInterval(() => {
  loadDashboard().catch((error) => console.error(error));
}, 5 * 60 * 1000);

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => handleSort(th.dataset.sort));
});

trendRange.querySelectorAll("[data-hours]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTrendHours = Number(button.dataset.hours) || 168;
    trendRange.querySelectorAll("[data-hours]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    loadDashboard().catch((error) => console.error(error));
  });
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
  control.addEventListener("input", () => renderMachinesSorted());
  control.addEventListener("change", () => renderMachinesSorted());
});

filterReset.addEventListener("click", () => {
  filterSearch.value = "";
  filterStatus.value = "all";
  filterListed.value = "all";
  filterDc.value = "all";
  filterErrors.checked = false;
  filterReports.checked = false;
  filterMaint.checked = false;
  renderMachinesSorted();
});

earningsPrevButton.addEventListener("click", () => {
  selectedEarningsDate = shiftUtcDate(selectedEarningsDate, -1);
  loadDashboard().catch((error) => console.error(error));
});

earningsNextButton.addEventListener("click", () => {
  const nextDate = shiftUtcDate(selectedEarningsDate, 1);
  if (nextDate > todayUtcDateString()) {
    return;
  }

  selectedEarningsDate = nextDate;
  loadDashboard().catch((error) => console.error(error));
});

const modalBackdrop = document.getElementById("modal-backdrop");
const modalClose = document.getElementById("modal-close");
const modalTitle = document.getElementById("modal-title");
const modalStats = document.getElementById("modal-stats");
const modalError = document.getElementById("modal-error");
const modalMaintenance = document.getElementById("modal-maintenance");
const renterChart = document.getElementById("renter-chart");
const reliabilityChart = document.getElementById("reliability-chart");
const priceChart = document.getElementById("price-chart");
const reportsModalBackdrop = document.getElementById("reports-modal-backdrop");
const reportsModalClose = document.getElementById("reports-modal-close");
const reportsModalTitle = document.getElementById("reports-modal-title");
const reportsModalCounter = document.getElementById("reports-modal-counter");
const reportsPrevButton = document.getElementById("reports-prev");
const reportsNextButton = document.getElementById("reports-next");
const reportsProblem = document.getElementById("reports-problem");
const reportsTime = document.getElementById("reports-time");
const reportsMessage = document.getElementById("reports-message");

modalClose.addEventListener("click", () => {
  modalBackdrop.classList.add("hidden");
});

window.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) {
    modalBackdrop.classList.add("hidden");
  }
  if (e.target === reportsModalBackdrop) {
    reportsModalBackdrop.classList.add("hidden");
  }
});

window.addEventListener("keydown", (event) => {
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

async function showMachineHistory(machineId) {
  modalTitle.textContent = `Machine #${machineId} History`;
  modalStats.textContent = "Loading...";
  document.getElementById("modal-ip").textContent = "";
  modalError.textContent = "";
  modalError.classList.add("hidden");
  modalMaintenance.textContent = "";
  modalMaintenance.classList.add("hidden");
  renterChart.innerHTML = "";
  reliabilityChart.innerHTML = "";
  priceChart.innerHTML = "";
  modalBackdrop.classList.remove("hidden");

  try {
    const response = await fetch(`/api/history?machine_id=${machineId}&hours=168`);
    const data = await response.json();
    
    // Find IP from current machine data
    const machine = currentMachinesData.find(m => m.machine_id === machineId);
    if (machine && machine.public_ipaddr) {
      document.getElementById("modal-ip").textContent = `IP: ${machine.public_ipaddr}`;
    }
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
      return;
    }

    const history = data.history;
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
  reportsMessage.textContent = "";
  reportsModalBackdrop.classList.remove("hidden");
  reportsNextButton.focus();

  const response = await fetch(`/api/reports?machine_id=${machineId}`);
  const data = await response.json();
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

function hasReports(machineId) {
  const machine = currentMachinesData.find((row) => row.machine_id === machineId);
  return Boolean(machine && (machine.num_reports || 0) > 0);
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
    formatAxisValue: (value) => `${Math.round(value)}%`,
    formatHoverValue: (value) => `${value.toFixed(1)}%`,
    emptyMessage: "No reliability history yet"
  });
}

function drawPriceChart(history) {
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
    autoPadRange: true
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
    autoPadRange = false
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
  const { width, height, padding, points, scaleX, series } = options;
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

  svg.onmouseleave = clearHover;
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

    renderHover(nearestIndex);
  };
}

function formatChartTimestamp(value) {
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
