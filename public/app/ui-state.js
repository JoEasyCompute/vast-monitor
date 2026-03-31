export function normalizeSettingNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function loadUiSettings(storageKey, defaults) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      dashboardMode: parsed.dashboardMode === "carousel" ? "carousel" : defaults.dashboardMode,
      tableDensity: parsed.tableDensity === "compact" ? "compact" : defaults.tableDensity,
      lowReliabilityPct: normalizeSettingNumber(parsed.lowReliabilityPct, defaults.lowReliabilityPct, 0, 100),
      highTemperatureC: normalizeSettingNumber(parsed.highTemperatureC, defaults.highTemperatureC, 0, 150),
      stalePollMinutes: normalizeSettingNumber(parsed.stalePollMinutes, defaults.stalePollMinutes, 1, 1440),
      selectedUtilizationGpuType: typeof parsed.selectedUtilizationGpuType === "string" && parsed.selectedUtilizationGpuType
        ? parsed.selectedUtilizationGpuType
        : defaults.selectedUtilizationGpuType
    };
  } catch {
    return { ...defaults };
  }
}

export function saveUiSettings(storageKey, uiSettings) {
  window.localStorage.setItem(storageKey, JSON.stringify(uiSettings));
}

export function loadMachineFilters(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      status: ["all", "online", "offline"].includes(parsed.status) ? parsed.status : "all",
      listed: ["all", "listed", "unlisted"].includes(parsed.listed) ? parsed.listed : "all",
      dc: ["all", "dc", "non-dc"].includes(parsed.dc) ? parsed.dc : "all",
      owner: typeof parsed.owner === "string" ? parsed.owner : "",
      team: typeof parsed.team === "string" ? parsed.team : "",
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
      owner: "",
      team: "",
      errors: false,
      reports: false,
      maint: false,
      machineTab: "active"
    };
  }
}

export function saveMachineFilters(storageKey, machineFilters) {
  window.localStorage.setItem(storageKey, JSON.stringify(machineFilters));
}

export function readInitialViewState({
  currentSortCol,
  defaultTrendHours,
  defaultEarningsDate,
  savedMachineFilters,
  searchParams
}) {
  const trendHours = Number(searchParams.get("trend_hours"));

  return {
    sortCol: searchParams.get("sort") || currentSortCol,
    sortDesc: searchParams.get("desc") === "1",
    selectedTrendHours: Number.isFinite(trendHours) && trendHours > 0 ? trendHours : defaultTrendHours,
    selectedEarningsDate: isValidUtcDateString(searchParams.get("earnings_date")) ? searchParams.get("earnings_date") : defaultEarningsDate,
    filterSearch: searchParams.has("search") ? (searchParams.get("search") || "") : savedMachineFilters.search,
    filterStatus: searchParams.has("status") ? (searchParams.get("status") || "all") : savedMachineFilters.status,
    filterListed: searchParams.has("listed") ? (searchParams.get("listed") || "all") : savedMachineFilters.listed,
    filterDc: searchParams.has("dc") ? (searchParams.get("dc") || "all") : savedMachineFilters.dc,
    filterOwner: searchParams.has("owner") ? (searchParams.get("owner") || "") : savedMachineFilters.owner,
    filterTeam: searchParams.has("team") ? (searchParams.get("team") || "") : savedMachineFilters.team,
    filterErrors: searchParams.has("errors") ? searchParams.get("errors") === "1" : savedMachineFilters.errors,
    filterReports: searchParams.has("reports") ? searchParams.get("reports") === "1" : savedMachineFilters.reports,
    filterMaint: searchParams.has("maint") ? searchParams.get("maint") === "1" : savedMachineFilters.maint,
    activeMachineView: searchParams.has("machine_tab")
      ? (searchParams.get("machine_tab") === "archived" ? "archived" : "active")
      : savedMachineFilters.machineTab
  };
}

export function persistViewStateToUrl({
  sortCol,
  sortDesc,
  selectedTrendHours,
  selectedEarningsDate,
  todayUtcDate,
  filterSearch,
  filterStatus,
  filterListed,
  filterDc,
  filterOwner,
  filterTeam,
  filterErrors,
  filterReports,
  filterMaint,
  activeMachineView
}) {
  const params = new URLSearchParams();
  if (sortCol && sortCol !== "hostname") params.set("sort", sortCol);
  if (sortDesc) params.set("desc", "1");
  if (selectedTrendHours !== 168) params.set("trend_hours", String(selectedTrendHours));
  if (selectedEarningsDate !== todayUtcDate) params.set("earnings_date", selectedEarningsDate);
  if (filterSearch.trim()) params.set("search", filterSearch.trim());
  if (filterStatus !== "all") params.set("status", filterStatus);
  if (filterListed !== "all") params.set("listed", filterListed);
  if (filterDc !== "all") params.set("dc", filterDc);
  if (filterOwner.trim()) params.set("owner", filterOwner.trim());
  if (filterTeam.trim()) params.set("team", filterTeam.trim());
  if (filterErrors) params.set("errors", "1");
  if (filterReports) params.set("reports", "1");
  if (filterMaint) params.set("maint", "1");
  if (activeMachineView !== "active") params.set("machine_tab", activeMachineView);

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function isValidUtcDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
