import {
  capitalize,
  escapeHtml,
  formatChartTimestamp,
  formatPriceShort,
  formatSignedCurrency
} from "./formatters.js";

const ARCHIVE_OFFLINE_MS = 24 * 60 * 60 * 1000;

export function utilClass(value) {
  if (value > 80) return "high";
  if (value >= 50) return "medium";
  return "low";
}

export function resolveOfflineSinceMs(row) {
  const candidates = [row.last_online_at, row.last_seen_at, row.updated_at];
  for (const value of candidates) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function isArchivedMachine(row, nowMs = Date.now()) {
  if (row.status !== "offline") {
    return false;
  }

  const offlineSinceMs = resolveOfflineSinceMs(row);
  if (!Number.isFinite(offlineSinceMs)) {
    return false;
  }

  return (nowMs - offlineSinceMs) > ARCHIVE_OFFLINE_MS;
}

export function getMachinesForActiveView(machines, activeMachineView, nowMs = Date.now()) {
  return machines.filter((row) => isArchivedMachine(row, nowMs) === (activeMachineView === "archived"));
}

export function getAvailableGpuTypes(machines) {
  return Array.from(new Set(
    machines
      .map((row) => String(row.gpu_type || "").trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

export function getFilteredMachines(machines, filters, activeMachineView, nowMs = Date.now()) {
  const searchTerm = filters.search.trim().toLowerCase();
  const ownerTerm = String(filters.owner || "").trim().toLowerCase();
  const teamTerm = String(filters.team || "").trim().toLowerCase();
  const gpuTypeFilters = new Set(
    Array.isArray(filters.gpuTypes)
      ? filters.gpuTypes.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
      : []
  );

  return getMachinesForActiveView(machines, activeMachineView, nowMs).filter((row) => {
    if (searchTerm) {
      const haystack = [
        row.hostname,
        row.gpu_type,
        row.machine_id,
        row.owner_name,
        row.team_name
      ].join(" ").toLowerCase();

      if (!haystack.includes(searchTerm)) {
        return false;
      }
    }

    if (gpuTypeFilters.size > 0 && !gpuTypeFilters.has(String(row.gpu_type || "").trim().toLowerCase())) {
      return false;
    }

    if (filters.status !== "all" && row.status !== filters.status) {
      return false;
    }

    if (filters.listed === "listed" && !row.listed) {
      return false;
    }

    if (filters.listed === "unlisted" && row.listed) {
      return false;
    }

    if (filters.dc === "dc" && !row.is_datacenter) {
      return false;
    }

    if (filters.dc === "non-dc" && row.is_datacenter) {
      return false;
    }

    if (ownerTerm && !String(row.owner_name || "").toLowerCase().includes(ownerTerm)) {
      return false;
    }

    if (teamTerm && !String(row.team_name || "").toLowerCase().includes(teamTerm)) {
      return false;
    }

    if (filters.errors && !row.error_message) {
      return false;
    }

    if (filters.reports && !row.has_new_report_72h) {
      return false;
    }

    if (filters.maint && (!Array.isArray(row.machine_maintenance) || row.machine_maintenance.length === 0)) {
      return false;
    }

    return true;
  });
}

export function getSortedMachines(machines, filters, activeMachineView, sortCol, sortDesc, nowMs = Date.now()) {
  return [...getFilteredMachines(machines, filters, activeMachineView, nowMs)].sort((a, b) => {
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

export function getMachineViewCounts(machines, nowMs = Date.now()) {
  const activeCount = machines.filter((row) => !isArchivedMachine(row, nowMs)).length;
  const archivedCount = machines.length - activeCount;
  return { activeCount, archivedCount };
}

function isMachineUnverified(row) {
  if (row?.verified === false) {
    return true;
  }

  return String(row?.verification || "").trim().toLowerCase() === "unverified";
}

export function buildMachineRowsMarkup(rows, uiSettings) {
  return rows
    .map((row, index) => {
      const reliabilityScore = row.reliability != null ? row.reliability * 100 : null;
      const isLowReliability = reliabilityScore != null && reliabilityScore < uiSettings.lowReliabilityPct;
      const isHot = row.gpu_max_cur_temp != null && row.gpu_max_cur_temp >= uiSettings.highTemperatureC;
      const hasError = Boolean(row.error_message);
      const isUnverified = isMachineUnverified(row);
      const rowClass = [hasError ? "machine-error" : "", isLowReliability ? "low-reliability" : "", isHot ? "high-temperature" : "", isUnverified ? "machine-unverified" : ""]
        .filter(Boolean)
        .join(" ");

      return `
      <tr class="machine-row ${rowClass}" data-machine-row="1" data-machine-id="${row.machine_id}">
        <td class="muted">${index + 1}</td>
        <td class="muted machine-col-id">#${row.machine_id}</td>
        <td class="dc-cell">${renderDatacenter(row)}</td>
        <td class="listed-cell">${renderListed(row)}</td>
        <td class="maint-cell">${renderMaintenanceCheckbox(row)}</td>
        <td class="machine-col-hostname">${renderHostnameCell(row)}</td>
        <td class="machine-col-gpu">${escapeHtml(row.gpu_type)}</td>
        <td>${row.num_gpus}</td>
        <td class="machine-col-occupancy">${renderOccupancy(row)}</td>
        <td class="machine-col-price">${renderPriceCell(row)}</td>
        <td class="machine-col-rentals">${renderRentalsCell(row)}</td>
        <td class="machine-col-temp">${row.gpu_max_cur_temp == null ? "-" : `${row.gpu_max_cur_temp}C`}</td>
        <td class="machine-col-reports">${renderReports(row)}</td>
        <td class="machine-col-reliability">${renderReliabilityCell(row, reliabilityScore)}</td>
        <td class="machine-col-uptime">${row.uptime?.["24h"] == null ? "-" : `${row.uptime["24h"]}%`}</td>
        <td>${renderStatusCell(row)}</td>
      </tr>
    `;
    })
    .join("");
}

export function buildMachineEmptyStateMessage(count, filters, activeMachineView) {
  if (count > 0) {
    return "";
  }

  const hasFilters = Boolean(
    filters.search.trim()
    || filters.status !== "all"
    || filters.listed !== "all"
    || filters.dc !== "all"
    || (Array.isArray(filters.gpuTypes) && filters.gpuTypes.length > 0)
    || String(filters.owner || "").trim()
    || String(filters.team || "").trim()
    || filters.errors
    || filters.reports
    || filters.maint
  );

  if (!hasFilters) {
    return activeMachineView === "archived"
      ? "No archived machines yet. Machines move here after being offline for more than 24 hours."
      : "No machines in the main view.";
  }

  const hints = [];
  if (filters.search.trim()) {
    hints.push("clear the search");
  }
  if (Array.isArray(filters.gpuTypes) && filters.gpuTypes.length > 0) {
    hints.push("remove GPU filters");
  }
  if (filters.status !== "all" || filters.listed !== "all" || filters.dc !== "all") {
    hints.push("broaden quick filters");
  }
  if (filters.errors || filters.reports || filters.maint) {
    hints.push("untoggle filter chips");
  }

  const hintText = hints.length > 0
    ? ` Try ${hints.slice(0, 2).join(" or ")}.`
    : "";

  return `No ${activeMachineView === "archived" ? "archived" : "main-view"} machines match the current filters.${hintText}`;
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

function renderHostnameCell(row) {
  const assignment = [row.owner_name, row.team_name].filter(Boolean).join(" / ");
  if (!assignment) {
    return escapeHtml(row.hostname);
  }

  return `
    <div class="machine-hostname-cell">
      <div>${escapeHtml(row.hostname)}</div>
      <div class="machine-submeta">${escapeHtml(assignment)}</div>
    </div>
  `;
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
  const interactionHint = "Click row for history. Ctrl/Cmd-click or long-press for reports.";
  if (count === 0) return '<span class="muted">0</span>';
  if (row.reports_changed) {
    return `<span class="report-badge changed" data-report-trigger="1" data-machine-id="${row.machine_id}" title="New reports since yesterday. ${interactionHint}">⚠ ${count}</span>`;
  }
  return `<span class="report-badge" data-report-trigger="1" data-machine-id="${row.machine_id}" title="${interactionHint}">${count}</span>`;
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
