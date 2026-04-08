import test from "node:test";
import assert from "node:assert/strict";

import { buildDbAdminPanelMarkup } from "../public/app/db-admin-panel.js";

test("db admin panel prompts for a token when admin auth is not configured in the browser", () => {
  const result = buildDbAdminPanelMarkup({
    dbHealth: null,
    hasAdminToken: false
  });

  assert.equal(result.meta, "Add token in Settings");
  assert.match(result.markup, /Add an admin API token/i);
});

test("db admin panel shows unavailable state when token exists but db health is missing", () => {
  const result = buildDbAdminPanelMarkup({
    dbHealth: null,
    hasAdminToken: true
  });

  assert.equal(result.meta, "Admin health unavailable");
  assert.match(result.markup, /unavailable/i);
});

test("db admin panel renders database counts and route metrics when health is available", () => {
  const result = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 1048576,
        row_counts: {
          polls: 10,
          fleet_snapshots: 10,
          fleet_snapshot_hourly_rollups: 3,
          machine_snapshots: 50,
          machine_snapshot_hourly_rollups: 12,
          gpu_type_utilization_hourly_rollups: 4,
          gpu_type_price_hourly_rollups: 4,
          platform_gpu_metric_snapshots: 9,
          alerts: 2,
          events: 3
        },
        retention: {
          snapshot_days: 30,
          alert_days: 7,
          event_days: 7
        },
        derived_state: {
          fleet_snapshot_state_version: "1",
          fleet_snapshot_state_updated_at: "2026-04-01T10:00:00.000Z"
        },
        metadata: {
          analyze_last_run_at: {
            value: "2026-04-01T11:00:00.000Z"
          },
          vacuum_last_run_at: {
            value: "2026-04-01T12:00:00.000Z"
          },
          derived_rebuild_last_run_at: {
            value: "2026-04-01T13:00:00.000Z"
          }
        },
        maintenance: {
          in_progress: null,
          recent_runs: [
            {
              action: "analyze",
              status: "succeeded",
              started_at: "2026-04-01T11:00:00.000Z",
              completed_at: "2026-04-01T11:00:42.000Z",
              duration_ms: 42,
              result: {
                completed_at: "2026-04-01T11:00:42.000Z",
                duration_ms: 42
              }
            },
            {
              action: "vacuum",
              status: "failed",
              started_at: "2026-04-01T12:00:00.000Z",
              completed_at: "2026-04-01T12:00:10.000Z",
              duration_ms: 10,
              error_text: "database is locked"
            }
          ]
        },
        route_metrics: {
          status: {
            calls: 4,
            errors: 0,
            last_duration_ms: 18,
            avg_duration_ms: 14.25,
            max_duration_ms: 22,
            last_status_code: 200
          }
        }
      },
      route_metrics: {
        health: {
          calls: 2,
          errors: 0,
          last_duration_ms: 8,
          avg_duration_ms: 7.5,
          max_duration_ms: 9,
          last_status_code: 200
        }
      },
      platform_benchmark: {
        ok: true,
        stale: false,
        fetched_at: "2026-04-01T12:15:00.000Z",
        source: "https://gpu-treemap.replit.app/api/gpu-data"
      }
    }
  });

  assert.match(result.meta, /Version updated/i);
  assert.match(result.markup, /1\.0 MB/);
  assert.match(result.markup, /Fleet Raw\/Roll/);
  assert.match(result.markup, /50 \/ 12/);
  assert.match(result.markup, /Benchmark Snap/);
  assert.match(result.markup, />9</);
  assert.match(result.markup, /status/);
  assert.match(result.markup, /200/);
  assert.match(result.markup, /\/tmp\/vast-monitor\.db/);
  assert.match(result.markup, /Last Analyze:/);
  assert.match(result.markup, /Last Vacuum:/);
  assert.match(result.markup, /Last Derived Rebuild:/);
  assert.match(result.markup, /Maintenance Active: No/);
  assert.match(result.markup, /Benchmark Status: Live/);
  assert.match(result.markup, /Benchmark Source:/);
  assert.match(result.markup, /gpu-treemap\.replit\.app\/api\/gpu-data/);
  assert.match(result.markup, /analyze/);
  assert.match(result.markup, /<summary>Result<\/summary>/);
  assert.match(result.markup, /duration_ms/);
  assert.match(result.markup, /<summary>Error<\/summary>/);
  assert.match(result.markup, /database is locked/);
});

test("db admin panel renders operator warnings for disabled retention, large DBs, and active maintenance", () => {
  const result = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 300 * 1024 * 1024,
        row_counts: {},
        retention: { snapshot_days: 0, alert_days: 0, event_days: 0 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null },
        maintenance: {
          in_progress: {
            action: "vacuum"
          },
          recent_runs: []
        }
      },
      platform_benchmark: {
        ok: false,
        stale: false,
        fetched_at: null,
        source: "https://gpu-treemap.replit.app/api/gpu-data",
        error: "upstream unavailable"
      }
    }
  });

  assert.match(result.markup, /Retention is disabled/i);
  assert.match(result.markup, /Database file is large/i);
  assert.match(result.markup, /Maintenance is currently running: vacuum/i);
  assert.match(result.markup, /External Vast benchmark is currently unavailable/i);
});

test("db admin panel renders retention preview actions and preview details", () => {
  const result = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    },
    retentionPreview: {
      cutoffs: {
        snapshot: "2026-03-01T00:00:00.000Z",
        alert: "2026-03-24T00:00:00.000Z",
        event: "2026-03-24T00:00:00.000Z"
      },
      would_delete: {
        polls: 12,
        fleet_snapshots: 12,
        machine_snapshots: 120,
        alerts: 4,
        events: 5
      },
      would_upsert_rollups: {
        fleet_snapshot_hourly_rollups: 6,
        machine_snapshot_hourly_rollups: 20,
        gpu_type_utilization_hourly_rollups: 8,
        gpu_type_price_hourly_rollups: 8
      }
    }
  });

  assert.match(result.markup, /Preview Retention|Clear Preview/);
  assert.match(result.markup, /Retention Preview/);
  assert.match(result.markup, /Snapshot cutoff/);
  assert.match(result.markup, /120/);
  assert.match(result.markup, /GPU Price Rollups/);
});

test("db admin panel renders analyze action and last analyze result", () => {
  const result = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    },
    analyzeResult: {
      completed_at: "2026-04-01T12:00:00.000Z",
      duration_ms: 42
    }
  });

  assert.match(result.markup, /Analyze/);
  assert.match(result.markup, /Analyze Result/);
  assert.match(result.markup, /42ms/);
  assert.match(result.markup, /2026-04-01T12:00:00.000Z/);
});

test("db admin panel renders vacuum warning and vacuum result", () => {
  const warning = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    }
  });

  const result = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    },
    vacuumResult: {
      completed_at: "2026-04-01T13:00:00.000Z",
      duration_ms: 120,
      file_size_bytes: 1024
    }
  });

  assert.match(warning.markup, /VACUUM can take longer than ANALYZE/i);
  assert.match(result.markup, /Vacuum/);
  assert.match(result.markup, /Vacuum Result/);
  assert.match(result.markup, /120ms/);
  assert.match(result.markup, /1\.0 KB/);
});

test("db admin panel renders queued state for background maintenance", () => {
  const result = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    },
    vacuumResult: {
      queued: true,
      action: "vacuum"
    }
  });

  assert.match(result.markup, /Vacuum Queued/);
  assert.match(result.markup, /Background vacuum has been queued/);
});

test("db admin panel renders confirmation state for destructive actions", () => {
  const vacuumConfirm = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    },
    confirmAction: "vacuum"
  });

  const rebuildConfirm = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    },
    confirmAction: "rebuild-derived"
  });

  assert.match(vacuumConfirm.markup, /Confirm Vacuum/);
  assert.match(vacuumConfirm.markup, /Press the highlighted button again/);
  assert.match(vacuumConfirm.markup, /Cancel/);
  assert.match(rebuildConfirm.markup, /Confirm Rebuild/);
});

test("db admin panel renders rebuild action and rebuild result", () => {
  const warning = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    }
  });

  const result = buildDbAdminPanelMarkup({
    hasAdminToken: true,
    dbHealth: {
      database: {
        path: "/tmp/vast-monitor.db",
        file_size_bytes: 2048,
        row_counts: {},
        retention: { snapshot_days: 30, alert_days: 7, event_days: 7 },
        derived_state: { fleet_snapshot_state_version: "1", fleet_snapshot_state_updated_at: null }
      }
    },
    rebuildResult: {
      completed_at: "2026-04-01T14:00:00.000Z",
      duration_ms: 250,
      rebuilt: {
        fleet_snapshots: 12,
        fleet_snapshot_hourly_rollups: 4,
        machine_snapshot_hourly_rollups: 7,
        gpu_type_utilization_hourly_rollups: 5,
        gpu_type_price_hourly_rollups: 5
      }
    }
  });

  assert.match(warning.markup, /Rebuild Derived/);
  assert.match(warning.markup, /currently retained raw snapshot history/i);
  assert.match(result.markup, /Rebuild Result/);
  assert.match(result.markup, /12/);
  assert.match(result.markup, /5 \/ 5/);
});
