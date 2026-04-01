import { escapeHtml, formatChartTimestamp } from "./formatters.js";

export function buildDbAdminPanelMarkup({
  dbHealth,
  hasAdminToken,
  retentionPreview = null,
  retentionPreviewLoading = false,
  retentionPreviewError = "",
  analyzeResult = null,
  analyzeLoading = false,
  analyzeError = "",
  vacuumResult = null,
  vacuumLoading = false,
  vacuumError = ""
}) {
  if (!hasAdminToken) {
    return {
      meta: "Add token in Settings",
      markup: '<div class="section-placeholder"><p class="muted">Add an admin API token in Settings to enable DB health.</p></div>'
    };
  }

  if (!dbHealth?.database) {
    return {
      meta: "Admin health unavailable",
      markup: '<div class="section-placeholder"><p class="muted">DB admin health is unavailable. Check the admin token and try refresh.</p></div>'
    };
  }

  const database = dbHealth.database;
  const rowCounts = database.row_counts || {};
  const routeMetrics = database.route_metrics || dbHealth.route_metrics || {};
  const metadata = database.metadata || {};
  const cards = [
    ["DB Size", formatDbSize(database.file_size_bytes)],
    ["Fleet Ver", database.derived_state?.fleet_snapshot_state_version || "-"],
    ["Polls", rowCounts.polls ?? 0],
    ["Fleet Raw/Roll", `${rowCounts.fleet_snapshots ?? 0} / ${rowCounts.fleet_snapshot_hourly_rollups ?? 0}`],
    ["Machine Raw/Roll", `${rowCounts.machine_snapshots ?? 0} / ${rowCounts.machine_snapshot_hourly_rollups ?? 0}`],
    ["GPU Util Roll", rowCounts.gpu_type_utilization_hourly_rollups ?? 0],
    ["GPU Price Roll", rowCounts.gpu_type_price_hourly_rollups ?? 0],
    ["Alerts/Events", `${rowCounts.alerts ?? 0} / ${rowCounts.events ?? 0}`],
    ["Retention", buildRetentionLabel(database.retention)]
  ];

  const routeMetricMarkup = Object.entries(routeMetrics)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, metric]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(String(metric.calls ?? 0))}</td>
        <td>${escapeHtml(String(metric.errors ?? 0))}</td>
        <td>${escapeHtml(formatMetricMs(metric.last_duration_ms))}</td>
        <td>${escapeHtml(formatMetricMs(metric.avg_duration_ms))}</td>
        <td>${escapeHtml(formatMetricMs(metric.max_duration_ms))}</td>
        <td>${escapeHtml(String(metric.last_status_code ?? "-"))}</td>
      </tr>
    `)
    .join("");

  return {
    meta: `Version updated ${database.derived_state?.fleet_snapshot_state_updated_at ? formatChartTimestamp(database.derived_state.fleet_snapshot_state_updated_at) : "unknown"}`,
    markup: `
      <div class="db-admin-actions">
        <button class="settings-inline-button" type="button" data-db-admin-action="analyze"${analyzeLoading ? " disabled" : ""}>
          ${analyzeLoading ? "Analyzing..." : "Analyze"}
        </button>
        <button class="settings-inline-button settings-inline-button-warn" type="button" data-db-admin-action="vacuum"${vacuumLoading ? " disabled" : ""}>
          ${vacuumLoading ? "Vacuuming..." : "Vacuum"}
        </button>
        <button class="settings-inline-button" type="button" data-db-admin-action="retention-preview"${retentionPreviewLoading ? " disabled" : ""}>
          ${retentionPreviewLoading ? "Loading..." : "Preview Retention"}
        </button>
        ${retentionPreview ? '<button class="settings-inline-button" type="button" data-db-admin-action="clear-retention-preview">Clear Preview</button>' : ""}
      </div>
      <div class="db-admin-grid">
        ${cards.map(([label, value]) => `
          <article class="stat-card">
            <span class="stat-label">${escapeHtml(label)}</span>
            <strong class="stat-value">${escapeHtml(String(value))}</strong>
          </article>
        `).join("")}
      </div>
      <div class="db-admin-detail">
        <div class="db-admin-path">Path: ${escapeHtml(database.path || "-")}</div>
        <div class="db-admin-path">Last Analyze: ${escapeHtml(formatMaintenanceTimestamp(metadata.analyze_last_run_at?.value))}</div>
        <div class="db-admin-path">Last Vacuum: ${escapeHtml(formatMaintenanceTimestamp(metadata.vacuum_last_run_at?.value))}</div>
      </div>
      <div class="table-wrap">
        <table class="db-admin-table">
          <thead>
            <tr>
              <th>Route</th>
              <th>Calls</th>
              <th>Errors</th>
              <th>Last</th>
              <th>Avg</th>
              <th>Max</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${routeMetricMarkup || '<tr><td colspan="7" class="muted">No route timing data yet.</td></tr>'}</tbody>
        </table>
      </div>
      ${buildAnalyzeMarkup(analyzeResult, analyzeError)}
      ${buildVacuumMarkup(vacuumResult, vacuumError)}
      ${buildRetentionPreviewMarkup(retentionPreview, retentionPreviewError)}
    `
  };
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

function buildRetentionLabel(retention = {}) {
  return `S:${retention.snapshot_days ?? 0} A:${retention.alert_days ?? 0} E:${retention.event_days ?? 0}`;
}

function formatMetricMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : "-";
}

function formatMaintenanceTimestamp(value) {
  if (!value) {
    return "Never";
  }

  try {
    return formatChartTimestamp(value);
  } catch {
    return String(value);
  }
}

function buildRetentionPreviewMarkup(preview, error) {
  if (error) {
    return `<div class="section-placeholder"><p class="muted">${escapeHtml(error)}</p></div>`;
  }

  if (!preview) {
    return "";
  }

  const cards = [
    ["Polls", preview.would_delete?.polls ?? 0],
    ["Fleet Raw", preview.would_delete?.fleet_snapshots ?? 0],
    ["Machine Raw", preview.would_delete?.machine_snapshots ?? 0],
    ["Alerts", preview.would_delete?.alerts ?? 0],
    ["Events", preview.would_delete?.events ?? 0],
    ["Fleet Rollups", preview.would_upsert_rollups?.fleet_snapshot_hourly_rollups ?? 0],
    ["Machine Rollups", preview.would_upsert_rollups?.machine_snapshot_hourly_rollups ?? 0],
    ["GPU Util Rollups", preview.would_upsert_rollups?.gpu_type_utilization_hourly_rollups ?? 0],
    ["GPU Price Rollups", preview.would_upsert_rollups?.gpu_type_price_hourly_rollups ?? 0]
  ];

  return `
    <div class="db-admin-preview">
      <div class="settings-section-title">Retention Preview</div>
      <div class="db-admin-detail">
        <div class="db-admin-path">Snapshot cutoff: ${escapeHtml(preview.cutoffs?.snapshot || "disabled")}</div>
        <div class="db-admin-path">Alert cutoff: ${escapeHtml(preview.cutoffs?.alert || "disabled")}</div>
        <div class="db-admin-path">Event cutoff: ${escapeHtml(preview.cutoffs?.event || "disabled")}</div>
      </div>
      <div class="db-admin-grid">
        ${cards.map(([label, value]) => `
          <article class="stat-card">
            <span class="stat-label">${escapeHtml(label)}</span>
            <strong class="stat-value">${escapeHtml(String(value))}</strong>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function buildAnalyzeMarkup(result, error) {
  if (error) {
    return `<div class="section-placeholder"><p class="muted">${escapeHtml(error)}</p></div>`;
  }

  if (!result) {
    return "";
  }

  return `
    <div class="db-admin-preview">
      <div class="settings-section-title">Analyze Result</div>
      <div class="db-admin-detail">
        <div class="db-admin-path">Completed: ${escapeHtml(result.completed_at || "unknown")}</div>
        <div class="db-admin-path">Duration: ${escapeHtml(formatMetricMs(result.duration_ms))}</div>
      </div>
    </div>
  `;
}

function buildVacuumMarkup(result, error) {
  if (error) {
    return `<div class="section-placeholder"><p class="muted">${escapeHtml(error)}</p></div>`;
  }

  if (!result) {
    return `
      <div class="db-admin-preview">
        <div class="settings-section-title">Vacuum</div>
        <div class="db-admin-detail">
          <div class="db-admin-path">VACUUM can take longer than ANALYZE and may temporarily block DB work. Run it during low-traffic periods.</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="db-admin-preview">
      <div class="settings-section-title">Vacuum Result</div>
      <div class="db-admin-detail">
        <div class="db-admin-path">Completed: ${escapeHtml(result.completed_at || "unknown")}</div>
        <div class="db-admin-path">Duration: ${escapeHtml(formatMetricMs(result.duration_ms))}</div>
        <div class="db-admin-path">DB size: ${escapeHtml(formatDbSize(result.file_size_bytes))}</div>
      </div>
    </div>
  `;
}
