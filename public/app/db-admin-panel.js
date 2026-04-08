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
  vacuumError = "",
  rebuildResult = null,
  rebuildLoading = false,
  rebuildError = "",
  confirmAction = ""
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
  const maintenance = database.maintenance || {};
  const platformBenchmark = dbHealth.platform_benchmark || {};
  const statusBadges = [
    buildStatusBadge("Admin", "ok"),
    buildStatusBadge("Retention", (database.retention?.snapshot_days || database.retention?.alert_days || database.retention?.event_days) ? "ok" : "warn"),
    buildStatusBadge(maintenance.in_progress ? `Busy: ${maintenance.in_progress.action}` : "Idle", maintenance.in_progress ? "warn" : "ok"),
    buildStatusBadge(
      platformBenchmark.ok
        ? (platformBenchmark.stale ? "Benchmark Cached" : "Benchmark Live")
        : "Benchmark Unavailable",
      platformBenchmark.ok && !platformBenchmark.stale ? "ok" : "warn"
    )
  ].join("");
  const warningMarkup = buildWarningMarkup({ database, maintenance, platformBenchmark });
  const cards = [
    ["DB Size", formatDbSize(database.file_size_bytes)],
    ["Fleet Ver", database.derived_state?.fleet_snapshot_state_version || "-"],
    ["Polls", rowCounts.polls ?? 0],
    ["Fleet Raw/Roll", `${rowCounts.fleet_snapshots ?? 0} / ${rowCounts.fleet_snapshot_hourly_rollups ?? 0}`],
    ["Machine Raw/Roll", `${rowCounts.machine_snapshots ?? 0} / ${rowCounts.machine_snapshot_hourly_rollups ?? 0}`],
    ["GPU Util Roll", rowCounts.gpu_type_utilization_hourly_rollups ?? 0],
    ["GPU Price Roll", rowCounts.gpu_type_price_hourly_rollups ?? 0],
    ["Benchmark Raw/Roll", `${rowCounts.platform_gpu_metric_snapshots ?? 0} / ${rowCounts.platform_gpu_metric_hourly_rollups ?? 0}`],
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

  const isConfirmingVacuum = confirmAction === "vacuum";
  const isConfirmingRebuild = confirmAction === "rebuild-derived";

  return {
    meta: `Version updated ${database.derived_state?.fleet_snapshot_state_updated_at ? formatChartTimestamp(database.derived_state.fleet_snapshot_state_updated_at) : "unknown"}`,
    markup: `
      <div class="db-admin-actions">
        <button class="settings-inline-button" type="button" data-db-admin-action="analyze"${analyzeLoading ? " disabled" : ""}>
          ${analyzeLoading ? "Analyzing..." : "Analyze"}
        </button>
        <button class="settings-inline-button settings-inline-button-warn${isConfirmingVacuum ? " settings-inline-button-danger" : ""}" type="button" data-db-admin-action="vacuum"${vacuumLoading ? " disabled" : ""}>
          ${vacuumLoading ? "Vacuuming..." : isConfirmingVacuum ? "Confirm Vacuum" : "Vacuum"}
        </button>
        <button class="settings-inline-button settings-inline-button-warn${isConfirmingRebuild ? " settings-inline-button-danger" : ""}" type="button" data-db-admin-action="rebuild-derived"${rebuildLoading ? " disabled" : ""}>
          ${rebuildLoading ? "Rebuilding..." : isConfirmingRebuild ? "Confirm Rebuild" : "Rebuild Derived"}
        </button>
        <button class="settings-inline-button" type="button" data-db-admin-action="retention-preview"${retentionPreviewLoading ? " disabled" : ""}>
          ${retentionPreviewLoading ? "Loading..." : "Preview Retention"}
        </button>
        <button class="settings-inline-button" type="button" data-db-admin-action="copy-diagnostics">Copy JSON</button>
        <button class="settings-inline-button" type="button" data-db-admin-action="download-diagnostics">Download JSON</button>
        ${retentionPreview ? '<button class="settings-inline-button" type="button" data-db-admin-action="clear-retention-preview">Clear Preview</button>' : ""}
        ${(isConfirmingVacuum || isConfirmingRebuild) ? '<button class="settings-inline-button" type="button" data-db-admin-action="cancel-confirm">Cancel</button>' : ""}
      </div>
      <div class="db-admin-badges">${statusBadges}</div>
      ${warningMarkup}
      ${buildConfirmationMarkup(confirmAction)}
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
        <div class="db-admin-path">Last Derived Rebuild: ${escapeHtml(formatMaintenanceTimestamp(metadata.derived_rebuild_last_run_at?.value))}</div>
        <div class="db-admin-path">Maintenance Active: ${escapeHtml(maintenance.in_progress?.action || "No")}</div>
        <div class="db-admin-path">Benchmark Status: ${escapeHtml(platformBenchmark.ok ? (platformBenchmark.stale ? "Cached" : "Live") : "Unavailable")}</div>
        <div class="db-admin-path">Benchmark Source: ${escapeHtml(platformBenchmark.source || "-")}</div>
        <div class="db-admin-path">Benchmark Fetched: ${escapeHtml(formatMaintenanceTimestamp(platformBenchmark.fetched_at))}</div>
        ${platformBenchmark.error ? `<div class="db-admin-path">Benchmark Error: ${escapeHtml(platformBenchmark.error)}</div>` : ""}
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
      ${buildMaintenanceHistoryMarkup(maintenance)}
      ${buildAnalyzeMarkup(analyzeResult, analyzeError)}
      ${buildVacuumMarkup(vacuumResult, vacuumError)}
      ${buildRebuildMarkup(rebuildResult, rebuildError)}
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

function buildStatusBadge(label, kind) {
  return `<span class="db-admin-badge ${kind === "warn" ? "warn" : "ok"}">${escapeHtml(label)}</span>`;
}

function buildWarningMarkup({ database, maintenance, platformBenchmark }) {
  const warnings = [];
  const retention = database.retention || {};
  const fileSizeBytes = Number(database.file_size_bytes);

  if (!(retention.snapshot_days || retention.alert_days || retention.event_days)) {
    warnings.push("Retention is disabled. DB size will keep growing until retention is configured.");
  }

  if (Number.isFinite(fileSizeBytes) && fileSizeBytes >= 250 * 1024 * 1024) {
    warnings.push(`Database file is large (${formatDbSize(fileSizeBytes)}). Consider retention preview, ANALYZE, or VACUUM during low-traffic periods.`);
  }

  if (maintenance?.in_progress?.action) {
    warnings.push(`Maintenance is currently running: ${maintenance.in_progress.action}. Heavy actions may temporarily affect responsiveness.`);
  }

  if (!platformBenchmark?.ok) {
    warnings.push("External Vast benchmark is currently unavailable. Benchmark cards and comparison lines may be missing or stale.");
  } else if (platformBenchmark.stale) {
    warnings.push("External Vast benchmark is currently served from cached data. Refreshes may lag behind the latest upstream market state.");
  }

  if (!warnings.length) {
    return "";
  }

  return `
    <div class="db-admin-warning-list">
      ${warnings.map((message) => `
        <div class="db-admin-warning">
          <strong>Heads up:</strong> ${escapeHtml(message)}
        </div>
      `).join("")}
    </div>
  `;
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
    ,
    ["Benchmark Rollups", preview.would_upsert_rollups?.platform_gpu_metric_hourly_rollups ?? 0]
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

function buildConfirmationMarkup(confirmAction) {
  if (!confirmAction) {
    return "";
  }

  const label = confirmAction === "vacuum"
    ? "VACUUM rewrites the database file and may temporarily block DB work."
    : "Rebuild Derived recreates fleet snapshots and rollup tables from retained raw history.";

  return `
    <div class="db-admin-preview db-admin-confirm">
      <div class="settings-section-title">Confirm Action</div>
      <div class="db-admin-detail">
        <div class="db-admin-path">${escapeHtml(label)}</div>
        <div class="db-admin-path">Press the highlighted button again to continue, or Cancel.</div>
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

function buildMaintenanceHistoryMarkup(maintenance = {}) {
  const runs = Array.isArray(maintenance.recent_runs) ? maintenance.recent_runs : [];
  if (!runs.length) {
    return "";
  }

  return `
    <div class="table-wrap">
      <table class="db-admin-table">
        <thead>
          <tr>
            <th>Maintenance</th>
            <th>Status</th>
            <th>Started</th>
            <th>Completed</th>
            <th>Duration</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map((run) => `
            <tr>
              <td>${escapeHtml(run.action || "-")}</td>
              <td>${escapeHtml(run.status || "-")}</td>
              <td>${escapeHtml(formatMaintenanceTimestamp(run.started_at))}</td>
              <td>${escapeHtml(formatMaintenanceTimestamp(run.completed_at))}</td>
              <td>${escapeHtml(formatMetricMs(run.duration_ms))}</td>
              <td>${buildMaintenanceRunDetails(run)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildMaintenanceRunDetails(run) {
  const errorText = String(run?.error_text || "").trim();
  if (errorText) {
    return `
      <details class="db-admin-run-details">
        <summary>Error</summary>
        <pre>${escapeHtml(errorText)}</pre>
      </details>
    `;
  }

  if (run?.result) {
    return `
      <details class="db-admin-run-details">
        <summary>Result</summary>
        <pre>${escapeHtml(JSON.stringify(run.result, null, 2))}</pre>
      </details>
    `;
  }

  return '<span class="muted">-</span>';
}

function buildVacuumMarkup(result, error) {
  if (error) {
    return `<div class="section-placeholder"><p class="muted">${escapeHtml(error)}</p></div>`;
  }

  if (result?.queued) {
    return `
      <div class="db-admin-preview">
        <div class="settings-section-title">Vacuum Queued</div>
        <div class="db-admin-detail">
          <div class="db-admin-path">Background vacuum has been queued. The panel will refresh while maintenance is running.</div>
        </div>
      </div>
    `;
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

function buildRebuildMarkup(result, error) {
  if (error) {
    return `<div class="section-placeholder"><p class="muted">${escapeHtml(error)}</p></div>`;
  }

  if (result?.queued) {
    return `
      <div class="db-admin-preview">
        <div class="settings-section-title">Rebuild Queued</div>
        <div class="db-admin-detail">
          <div class="db-admin-path">Background rebuild has been queued. The panel will refresh while maintenance is running.</div>
        </div>
      </div>
    `;
  }

  if (!result) {
    return `
      <div class="db-admin-preview">
        <div class="settings-section-title">Rebuild Derived</div>
        <div class="db-admin-detail">
          <div class="db-admin-path">Rebuilds derived fleet snapshots and rollup tables from currently retained raw snapshot history.</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="db-admin-preview">
      <div class="settings-section-title">Rebuild Result</div>
      <div class="db-admin-detail">
        <div class="db-admin-path">Completed: ${escapeHtml(result.completed_at || "unknown")}</div>
        <div class="db-admin-path">Duration: ${escapeHtml(formatMetricMs(result.duration_ms))}</div>
        <div class="db-admin-path">Fleet snapshots rebuilt: ${escapeHtml(String(result.rebuilt?.fleet_snapshots ?? 0))}</div>
        <div class="db-admin-path">Fleet rollups rebuilt: ${escapeHtml(String(result.rebuilt?.fleet_snapshot_hourly_rollups ?? 0))}</div>
        <div class="db-admin-path">Machine rollups rebuilt: ${escapeHtml(String(result.rebuilt?.machine_snapshot_hourly_rollups ?? 0))}</div>
        <div class="db-admin-path">GPU util/price rollups rebuilt: ${escapeHtml(`${result.rebuilt?.gpu_type_utilization_hourly_rollups ?? 0} / ${result.rebuilt?.gpu_type_price_hourly_rollups ?? 0}`)}</div>
        <div class="db-admin-path">Benchmark rollups rebuilt: ${escapeHtml(`${result.rebuilt?.platform_gpu_metric_hourly_rollups ?? 0}`)}</div>
      </div>
    </div>
  `;
}
