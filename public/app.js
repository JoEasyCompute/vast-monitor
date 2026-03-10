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

let currentMachinesData = [];
let sortCol = "hostname";
let sortDesc = false;
let selectedEarningsDate = todayUtcDateString();
let currentReports = [];
let currentReportIndex = 0;

async function loadDashboard() {
  const [statusResponse, alertsResponse, earningsResponse] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/alerts?limit=10"),
    fetch(`/api/earnings/hourly?date=${selectedEarningsDate}`)
  ]);

  const status = await statusResponse.json();
  const alertsPayload = await alertsResponse.json();
  const earningsPayload = await earningsResponse.json();

  currentMachinesData = status.machines;

  renderSummary(status.summary);
  renderBreakdown(status.gpuTypeBreakdown);
  renderHourlyEarnings(earningsPayload);
  renderMachinesSorted();
  renderAlerts(alertsPayload.alerts);
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
  const sorted = [...currentMachinesData].sort((a, b) => {
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

    drawChart(history);
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

function drawChart(history) {
  if (history.length < 2) return;

  // Set width dynamically or fallback to 600
  const width = renterChart.clientWidth || 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 30 };

  const minTime = new Date(history[0].polled_at).getTime();
  const maxTime = new Date(history[history.length - 1].polled_at).getTime();
  
  const maxRentals = Math.max(1, ...history.map(d => d.current_rentals_running || 0));
  
  // Prevent division by zero if minTime === maxTime
  const timeSpan = Math.max(1, maxTime - minTime);
  
  const scaleX = (time) => padding.left + ((time - minTime) / timeSpan) * (width - padding.left - padding.right);
  const scaleY = (rentals) => height - padding.bottom - (rentals / maxRentals) * (height - padding.top - padding.bottom);

  let pathData = "";
  let areaData = "";

  for (let i = 0; i < history.length; i++) {
    const d = history[i];
    const x = scaleX(new Date(d.polled_at).getTime());
    const y = scaleY(d.current_rentals_running || 0);
    
    if (i === 0) {
      pathData += `M ${x} ${y}`;
      areaData += `M ${x} ${scaleY(0)} L ${x} ${y}`;
    } else {
      const prevY = scaleY(history[i-1].current_rentals_running || 0);
      pathData += ` L ${x} ${prevY} L ${x} ${y}`;
      areaData += ` L ${x} ${prevY} L ${x} ${y}`;
    }
  }

  areaData += ` L ${scaleX(maxTime)} ${scaleY(0)} Z`;

  let svgContent = `<path d="${areaData}" class="chart-area" />`;
  svgContent += `<path d="${pathData}" class="chart-line" />`;
  
  // Generate a reasonable number of Y-axis ticks
  const ticksCount = Math.min(maxRentals, 5);
  for (let i = 0; i <= ticksCount; i++) {
    const val = Math.round((i / ticksCount) * maxRentals);
    const y = scaleY(val);
    svgContent += `<g class="chart-axis">
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke-dasharray="2,2" />
      <text x="${padding.left - 5}" y="${y + 4}" text-anchor="end">${val}</text>
    </g>`;
  }

  svgContent += `<g class="chart-axis">
    <text x="${padding.left}" y="${height - 5}" text-anchor="start">${new Date(minTime).toLocaleDateString()}</text>
    <text x="${width - padding.right}" y="${height - 5}" text-anchor="end">Now</text>
  </g>`;

  renterChart.innerHTML = svgContent;
}

function todayUtcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function shiftUtcDate(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
