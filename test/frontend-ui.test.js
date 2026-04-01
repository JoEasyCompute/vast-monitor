import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMachineEmptyStateMessage,
  buildMachineRowsMarkup,
  getAvailableGpuTypes,
  getFilteredMachines,
  getMachineViewCounts,
  getSortedMachines,
  isArchivedMachine
} from "../public/app/machine-table.js";
import {
  buildModalSummaryMarkup,
  computeRenterTotal
} from "../public/app/machine-modal.js";
import {
  loadMachineFilters,
  loadUiSettings,
  normalizeSettingNumber,
  persistViewStateToUrl,
  readInitialViewState
} from "../public/app/ui-state.js";

const NOW_MS = Date.parse("2026-03-23T12:00:00.000Z");

test("machine-table filters active and archived machines correctly", () => {
  const machines = [
    makeMachineRow({
      machine_id: 11,
      hostname: "alpha",
      gpu_type: "A100",
      status: "online",
      listed: true,
      is_datacenter: true,
      has_new_report_72h: true
    }),
    makeMachineRow({
      machine_id: 22,
      hostname: "beta",
      gpu_type: "H100",
      status: "offline",
      listed: false,
      is_datacenter: false,
      error_message: "fan fault",
      last_online_at: "2026-03-22T05:00:00.000Z",
      last_seen_at: "2026-03-22T05:00:00.000Z"
    })
  ];

  assert.equal(isArchivedMachine(machines[0], NOW_MS), false);
  assert.equal(isArchivedMachine(machines[1], NOW_MS), true);

  const activeMatches = getFilteredMachines(machines, defaultFilters({ reports: true }), "active", NOW_MS);
  const archivedMatches = getFilteredMachines(machines, defaultFilters({ errors: true }), "archived", NOW_MS);
  const counts = getMachineViewCounts(machines, NOW_MS);

  assert.deepEqual(activeMatches.map((row) => row.machine_id), [11]);
  assert.deepEqual(archivedMatches.map((row) => row.machine_id), [22]);
  assert.deepEqual(counts, { activeCount: 1, archivedCount: 1 });
});

test("machine-table sorting supports uptime and generated rows do not use inline handlers", () => {
  const machines = [
    makeMachineRow({ machine_id: 11, hostname: "beta", uptime: { "24h": 97.4 }, num_reports: 2, reports_changed: true }),
    makeMachineRow({ machine_id: 22, hostname: "alpha", uptime: { "24h": 99.9 }, public_ipaddr: "10.0.0.22" })
  ];

  const sortedByHostname = getSortedMachines(machines, defaultFilters(), "active", "hostname", false, NOW_MS);
  const sortedByUptimeDesc = getSortedMachines(machines, defaultFilters(), "active", "uptime", true, NOW_MS);
  const markup = buildMachineRowsMarkup(sortedByHostname, {
    lowReliabilityPct: 90,
    highTemperatureC: 85
  });

  assert.deepEqual(sortedByHostname.map((row) => row.machine_id), [22, 11]);
  assert.deepEqual(sortedByUptimeDesc.map((row) => row.machine_id), [22, 11]);
  assert.match(markup, /data-machine-row="1"/);
  assert.match(markup, /data-machine-id="22"/);
  assert.match(markup, /data-report-trigger="1"/);
  assert.doesNotMatch(markup, /onclick=/);
});

test("machine-table hostname search and markup include owner/team when present", () => {
  const machines = [
    makeMachineRow({
      machine_id: 11,
      hostname: "alpha",
      owner_name: "Alice",
      team_name: "Inference"
    })
  ];

  const filtered = getFilteredMachines(machines, defaultFilters({ search: "Inference" }), "active", NOW_MS);
  const markup = buildMachineRowsMarkup(filtered, {
    lowReliabilityPct: 90,
    highTemperatureC: 85
  });

  assert.deepEqual(filtered.map((row) => row.machine_id), [11]);
  assert.match(markup, /Alice \/ Inference/);
});

test("machine-table supports exact multi-select GPU-type filters", () => {
  const machines = [
    makeMachineRow({
      machine_id: 11,
      hostname: "A100-controller",
      gpu_type: "H100"
    }),
    makeMachineRow({
      machine_id: 22,
      hostname: "worker-22",
      gpu_type: "A100"
    }),
    makeMachineRow({
      machine_id: 33,
      hostname: "worker-33",
      gpu_type: "RTX 4090"
    })
  ];

  const filtered = getFilteredMachines(machines, defaultFilters({ gpuTypes: ["A100", "RTX 4090"] }), "active", NOW_MS);

  assert.deepEqual(filtered.map((row) => row.machine_id), [22, 33]);
  assert.deepEqual(getAvailableGpuTypes(machines), ["A100", "H100", "RTX 4090"]);
});

test("machine-table empty states distinguish filtered and archived views", () => {
  assert.equal(
    buildMachineEmptyStateMessage(0, defaultFilters({ search: "missing" }), "active"),
    "No main-view machines match the current filters."
  );
  assert.equal(
    buildMachineEmptyStateMessage(0, defaultFilters(), "archived"),
    "No archived machines yet."
  );
  assert.equal(buildMachineEmptyStateMessage(2, defaultFilters(), "active"), "");
});

test("machine modal renter total uses initial renters plus positive increases only", () => {
  const stableHistory = [
    { polled_at: "2026-03-23T10:00:00.000Z", current_rentals_running: 4 },
    { polled_at: "2026-03-23T11:00:00.000Z", current_rentals_running: 4 },
    { polled_at: "2026-03-23T12:00:00.000Z", current_rentals_running: 4 }
  ];
  const upDownHistory = [
    { polled_at: "2026-03-23T10:00:00.000Z", current_rentals_running: 4 },
    { polled_at: "2026-03-23T11:00:00.000Z", current_rentals_running: 3 },
    { polled_at: "2026-03-23T12:00:00.000Z", current_rentals_running: 4 }
  ];
  const mixedHistory = [
    { polled_at: "2026-03-23T10:00:00.000Z", current_rentals_running: 2 },
    { polled_at: "2026-03-23T11:00:00.000Z", current_rentals_running: 5 },
    { polled_at: "2026-03-23T12:00:00.000Z", current_rentals_running: 3 },
    { polled_at: "2026-03-23T13:00:00.000Z", current_rentals_running: 6 }
  ];

  assert.equal(computeRenterTotal(stableHistory), 4);
  assert.equal(computeRenterTotal(upDownHistory), 5);
  assert.equal(computeRenterTotal(mixedHistory), 8);
});

test("machine modal summary markup includes renter total", () => {
  const markup = buildModalSummaryMarkup(makeMachineRow({
    current_rentals_running: 4,
    reliability: 0.99
  }), [
    { polled_at: "2026-03-23T10:00:00.000Z", current_rentals_running: 4 },
    { polled_at: "2026-03-23T11:00:00.000Z", current_rentals_running: 3 },
    { polled_at: "2026-03-23T12:00:00.000Z", current_rentals_running: 4 }
  ]);

  assert.match(markup, /Renter Total \/ Rentals/);
  assert.match(markup, /<span>5<\/span>/);
  assert.match(markup, /<span>4<\/span>/);
});

test("ui-state loaders sanitize persisted values", () => {
  const { restore } = mockWindow({
    localStorageValues: {
      ui: JSON.stringify({
        dashboardMode: "carousel",
        tableDensity: "compact",
        lowReliabilityPct: "110",
        highTemperatureC: "-5",
        stalePollMinutes: "45",
        selectedUtilizationGpuType: "H100"
      }),
      filters: JSON.stringify({
        search: "alpha",
        status: "offline",
        listed: "unlisted",
        dc: "dc",
        owner: "ops",
        team: "platform",
        gpuTypes: ["A100", "H100"],
        errors: true,
        reports: true,
        maint: false,
        machineTab: "archived"
      })
    }
  });

  try {
    const ui = loadUiSettings("ui", {
      dashboardMode: "normal",
      tableDensity: "comfortable",
      lowReliabilityPct: 90,
      highTemperatureC: 85,
      stalePollMinutes: 15,
      selectedUtilizationGpuType: "__fleet__"
    });
    const filters = loadMachineFilters("filters");

    assert.equal(normalizeSettingNumber("200", 50, 0, 100), 100);
    assert.deepEqual(ui, {
      dashboardMode: "carousel",
      tableDensity: "compact",
      lowReliabilityPct: 100,
      highTemperatureC: 0,
      stalePollMinutes: 45,
      selectedUtilizationGpuType: "H100"
    });
    assert.deepEqual(filters, {
      search: "alpha",
      status: "offline",
      listed: "unlisted",
      dc: "dc",
      owner: "ops",
      team: "platform",
      gpuTypes: ["A100", "H100"],
      errors: true,
      reports: true,
      maint: false,
      machineTab: "archived"
    });
  } finally {
    restore();
  }
});

test("ui-state reads initial values from URL and persists trimmed state back to URL", () => {
  const windowMock = mockWindow({
    pathname: "/dashboard",
    search: "",
    localStorageValues: {}
  });

  try {
    const initial = readInitialViewState({
      currentSortCol: "hostname",
      defaultTrendHours: 168,
      defaultEarningsDate: "2026-03-23",
      savedMachineFilters: {
        search: "fallback",
        status: "online",
        listed: "all",
        dc: "all",
        owner: "ops",
        team: "platform",
        gpuTypes: ["RTX 4090"],
        errors: false,
        reports: false,
        maint: false,
        machineTab: "active"
      },
      searchParams: new URLSearchParams("sort=machine_id&desc=1&trend_hours=24&earnings_date=2026-03-20&search= beta &status=offline&gpu_types=A100,H100&reports=1&machine_tab=archived")
    });

    assert.deepEqual(initial, {
      sortCol: "machine_id",
      sortDesc: true,
      selectedTrendHours: 24,
      selectedEarningsDate: "2026-03-20",
      filterSearch: " beta ",
      filterStatus: "offline",
      filterListed: "all",
      filterDc: "all",
      filterOwner: "ops",
      filterTeam: "platform",
      filterGpuTypes: ["A100", "H100"],
      filterErrors: false,
      filterReports: true,
      filterMaint: false,
      activeMachineView: "archived"
    });

    persistViewStateToUrl({
      sortCol: "machine_id",
      sortDesc: true,
      selectedTrendHours: 24,
      selectedEarningsDate: "2026-03-20",
      todayUtcDate: "2026-03-23",
      filterSearch: " beta ",
      filterStatus: "offline",
      filterListed: "all",
      filterDc: "all",
      filterOwner: "ops",
      filterTeam: "platform",
      filterGpuTypes: ["A100", "H100"],
      filterErrors: false,
      filterReports: true,
      filterMaint: false,
      activeMachineView: "archived"
    });

    assert.deepEqual(windowMock.historyCalls, [
      {
        state: {},
        title: "",
        url: "/dashboard?sort=machine_id&desc=1&trend_hours=24&earnings_date=2026-03-20&search=beta&status=offline&owner=ops&team=platform&gpu_types=A100%2CH100&reports=1&machine_tab=archived"
      }
    ]);
  } finally {
    windowMock.restore();
  }
});

test("ui-state falls back to default dashboard mode for invalid persisted values", () => {
  const { restore } = mockWindow({
    localStorageValues: {
      ui: JSON.stringify({
        dashboardMode: "sideways"
      })
    }
  });

  try {
    const ui = loadUiSettings("ui", {
      dashboardMode: "normal",
      tableDensity: "comfortable",
      lowReliabilityPct: 90,
      highTemperatureC: 85,
      stalePollMinutes: 15,
      selectedUtilizationGpuType: "__fleet__"
    });

    assert.equal(ui.dashboardMode, "normal");
  } finally {
    restore();
  }
});

function makeMachineRow(overrides = {}) {
  return {
    machine_id: 1,
    hostname: "alpha",
    gpu_type: "A100",
    num_gpus: 4,
    listed: true,
    is_datacenter: false,
    status: "online",
    occupancy: "D D O O",
    listed_gpu_cost: 1.25,
    current_rentals_running: 2,
    gpu_max_cur_temp: 70,
    num_reports: 0,
    reports_changed: false,
    reliability: 0.98,
    uptime: { "24h": 98.5 },
    has_new_report_72h: false,
    machine_maintenance: [],
    last_online_at: "2026-03-23T11:30:00.000Z",
    last_seen_at: "2026-03-23T11:30:00.000Z",
    updated_at: "2026-03-23T11:30:00.000Z",
    error_message: "",
    ...overrides
  };
}

function defaultFilters(overrides = {}) {
  return {
    search: "",
    status: "all",
    listed: "all",
    dc: "all",
    owner: "",
    team: "",
    gpuTypes: [],
    errors: false,
    reports: false,
    maint: false,
    ...overrides
  };
}

function mockWindow({ pathname = "/", search = "", localStorageValues = {} } = {}) {
  const originalWindow = global.window;
  const storage = new Map(Object.entries(localStorageValues));
  const historyCalls = [];

  global.window = {
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      }
    },
    location: {
      pathname,
      search
    },
    history: {
      replaceState(state, title, url) {
        historyCalls.push({ state, title, url });
      }
    }
  };

  return {
    historyCalls,
    storage,
    restore() {
      global.window = originalWindow;
    }
  };
}
