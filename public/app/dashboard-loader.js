const DASHBOARD_SECTIONS = [
  {
    key: "status",
    label: "fleet status",
    buildPath: () => "/api/status",
    critical: true
  },
  {
    key: "alerts",
    label: "alerts",
    buildPath: () => "/api/alerts?limit=10"
  },
  {
    key: "earnings",
    label: "hourly earnings",
    buildPath: ({ selectedEarningsDate }) => `/api/earnings/hourly?date=${selectedEarningsDate}`
  },
  {
    key: "fleetHistory",
    label: "fleet trends",
    buildPath: ({ selectedTrendHours }) => `/api/fleet/history?hours=${selectedTrendHours}`
  },
  {
    key: "gpuTypePrice",
    label: "GPU type pricing",
    buildPath: ({ selectedTrendHours }) => `/api/gpu-type/price-history?hours=${selectedTrendHours}&top=6`
  }
];

export async function fetchDashboardPayload({
  fetchImpl = fetch,
  selectedEarningsDate,
  selectedTrendHours,
  adminApiToken = ""
}) {
  const sections = [
    ...DASHBOARD_SECTIONS,
    ...(String(adminApiToken || "").trim()
      ? [{
          key: "dbHealth",
          label: "database health",
          buildPath: () => "/api/admin/db-health",
          buildInit: () => ({
            headers: {
              Authorization: `Bearer ${String(adminApiToken).trim()}`
            }
          })
        }]
      : [])
  ];

  const settled = await Promise.all(
    sections.map(async (section) => {
      const path = section.buildPath({ selectedEarningsDate, selectedTrendHours });
      const init = typeof section.buildInit === "function"
        ? section.buildInit({ selectedEarningsDate, selectedTrendHours, adminApiToken })
        : undefined;

      try {
        const response = await fetchImpl(path, init);
        if (!response.ok) {
          return {
            key: section.key,
            label: section.label,
            critical: section.critical === true,
            ok: false,
            path,
            error: `${section.label} request failed (${response.status})`
          };
        }

        return {
          key: section.key,
          label: section.label,
          critical: section.critical === true,
          ok: true,
          path,
          payload: await response.json()
        };
      } catch (error) {
        return {
          key: section.key,
          label: section.label,
          critical: section.critical === true,
          ok: false,
          path,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  const payload = Object.fromEntries(
    settled
      .filter((item) => item.ok)
      .map((item) => [item.key, item.payload])
  );
  const failures = settled
    .filter((item) => !item.ok)
    .map((item) => ({
      key: item.key,
      label: item.label,
      critical: item.critical === true,
      path: item.path,
      error: item.error
    }));

  return {
    payload,
    failures,
    hasCriticalFailure: failures.some((item) => item.critical)
  };
}

export function buildDashboardNoticeMessage(failures) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return "";
  }

  const labels = failures.map((item) => item.label);
  const prefix = failures.some((item) => item.critical)
    ? "Dashboard refresh incomplete."
    : "Some dashboard sections are temporarily unavailable.";

  return `${prefix} Unavailable: ${joinLabels(labels)}.`;
}

function joinLabels(labels) {
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
