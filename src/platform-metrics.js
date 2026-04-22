const DEFAULT_PLATFORM_METRICS_URL = "https://500.farm/vastai-exporter/gpu-stats";
const DEFAULT_PLATFORM_METRICS_SEGMENT_URL = "https://500.farm/vastai-exporter/gpu-stats/v2";
const DEFAULT_PLATFORM_METRICS_TIMEOUT_MS = 15 * 1000;
const DEFAULT_PLATFORM_METRICS_TTL_MS = 15 * 60 * 1000;

export function createPlatformMetricsClient({
  fetchImpl = fetch,
  url = DEFAULT_PLATFORM_METRICS_URL,
  segmentUrl = DEFAULT_PLATFORM_METRICS_SEGMENT_URL,
  timeoutMs = DEFAULT_PLATFORM_METRICS_TIMEOUT_MS,
  ttlMs = DEFAULT_PLATFORM_METRICS_TTL_MS,
  now = () => Date.now()
} = {}) {
  let cache = null;

  return {
    async getSnapshot() {
      const nowMs = now();

      if (cache?.rows && cache.expiresAtMs > nowMs) {
        return {
          ok: true,
          stale: false,
          source: url,
          fetchedAt: cache.fetchedAt,
          rows: cache.rows,
          segments: cache.segments,
          error: null
        };
      }

      try {
        const snapshot = await fetchPlatformGpuMetrics({
          fetchImpl,
          url,
          segmentUrl,
          timeoutMs
        });

        cache = {
          rows: snapshot.rows,
          segments: snapshot.segments,
          fetchedAt: new Date(nowMs).toISOString(),
          expiresAtMs: nowMs + ttlMs
        };

        return {
          ok: true,
          stale: false,
          source: url,
          fetchedAt: cache.fetchedAt,
          rows: cache.rows,
          segments: cache.segments,
          error: null
        };
      } catch (error) {
        if (cache?.rows) {
          return {
            ok: true,
            stale: true,
            source: url,
            fetchedAt: cache.fetchedAt,
            rows: cache.rows,
            segments: cache.segments,
            error: error instanceof Error ? error.message : String(error)
          };
        }

        return {
          ok: false,
          stale: false,
          source: url,
          fetchedAt: null,
          rows: [],
          segments: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

export async function fetchPlatformGpuMetrics({
  fetchImpl = fetch,
  url = DEFAULT_PLATFORM_METRICS_URL,
  segmentUrl = DEFAULT_PLATFORM_METRICS_SEGMENT_URL,
  timeoutMs = DEFAULT_PLATFORM_METRICS_TIMEOUT_MS
} = {}) {
  const payload = await fetchPlatformGpuMetricsPayload({
    fetchImpl,
    url,
    timeoutMs
  });
  const rows = normalizePlatformGpuMetrics(payload);
  let segments = normalizePlatformGpuMetricSegments(payload);

  if (!segments.length && segmentUrl && segmentUrl !== url) {
    try {
      const segmentPayload = await fetchPlatformGpuMetricsPayload({
        fetchImpl,
        url: segmentUrl,
        timeoutMs
      });
      segments = normalizePlatformGpuMetricSegments(segmentPayload);
    } catch {
      segments = [];
    }
  }

  return {
    rows,
    segments
  };
}

async function fetchPlatformGpuMetricsPayload({
  fetchImpl = fetch,
  url = DEFAULT_PLATFORM_METRICS_URL,
  timeoutMs = DEFAULT_PLATFORM_METRICS_TIMEOUT_MS
} = {}) {
  let response;

  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new Error(`Timed out fetching platform GPU metrics after ${Math.round(timeoutMs / 1000)}s`);
    }

    throw error;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch platform GPU metrics (${response.status})`);
  }

  return response.json();
}

export function normalizePlatformGpuMetrics(payload) {
  if (Array.isArray(payload)) {
    return payload
      .map(normalizeLegacyPlatformGpuMetricRow)
      .filter(Boolean);
  }

  const exporterRows = Array.isArray(payload?.models) ? payload.models : [];
  return exporterRows
    .map(normalizeExporterPlatformGpuMetricRow)
    .filter(Boolean);
}

export function normalizePlatformGpuMetricSegments(payload) {
  const exporterRows = Array.isArray(payload?.models) ? payload.models : [];

  return exporterRows.flatMap((row) => normalizeExporterPlatformGpuMetricSegments(row));
}

function normalizeLegacyPlatformGpuMetricRow(row) {
  const gpuType = String(row?.name || "").trim();
  if (!gpuType) {
    return null;
  }

  return {
    gpu_type: gpuType,
    canonical_gpu_type: canonicalizeGpuType(gpuType),
    category: String(row?.category || "").trim() || null,
    market_utilisation_pct: finiteNumberOrNull(row?.utilizationRate, 2),
    market_gpus_on_platform: finiteNumberOrNull(row?.gpusOnPlatform, 0),
    market_gpus_available: finiteNumberOrNull(row?.gpusAvailable, 0),
    market_gpus_rented: finiteNumberOrNull(row?.gpusRented, 0),
    market_machines_available: finiteNumberOrNull(row?.machinesAvailable, 0),
    market_median_price: finiteNumberOrNull(row?.medianPrice, 3),
    market_minimum_price: finiteNumberOrNull(row?.minimumPrice, 3),
    market_p10_price: finiteNumberOrNull(row?.p10Price, 3),
    market_p90_price: finiteNumberOrNull(row?.p90Price, 3)
  };
}

function normalizeExporterPlatformGpuMetricRow(row) {
  const gpuType = String(row?.name || "").trim();
  if (!gpuType) {
    return null;
  }

  const summary = summarizeExporterModel(row);
  if (!summary) {
    return null;
  }

  return {
    gpu_type: gpuType,
    canonical_gpu_type: canonicalizeGpuType(gpuType),
    category: null,
    market_utilisation_pct: computeUtilizationRate(summary.gpusRented, summary.gpusOnPlatform),
    market_gpus_on_platform: finiteNumberOrNull(summary.gpusOnPlatform, 0),
    market_gpus_available: finiteNumberOrNull(summary.gpusAvailable, 0),
    market_gpus_rented: finiteNumberOrNull(summary.gpusRented, 0),
    market_machines_available: finiteNumberOrNull(summary.machinesAvailable, 0),
    market_median_price: finiteNumberOrNull(summary.medianPrice, 3),
    market_minimum_price: finiteNumberOrNull(summary.minimumPrice, 3),
    market_p10_price: finiteNumberOrNull(summary.p10Price, 3),
    market_p90_price: finiteNumberOrNull(summary.p90Price, 3)
  };
}

function normalizeExporterPlatformGpuMetricSegments(row) {
  const gpuType = String(row?.name || "").trim();
  const categories = Array.isArray(row?.categories) ? row.categories : [];
  if (!gpuType || !categories.length) {
    return [];
  }

  const canonicalGpuType = canonicalizeGpuType(gpuType);
  return PLATFORM_GPU_SEGMENT_DEFINITIONS.map((definition) => {
    const matchingCategories = categories.filter(definition.matches);
    const summary = summarizeExporterCategories(matchingCategories);
    const totalCount = Number(summary.gpusOnPlatform) || 0;
    if (totalCount <= 0) {
      return null;
    }

    return {
      gpu_type: gpuType,
      canonical_gpu_type: canonicalGpuType,
      segment_key: definition.segmentKey,
      segment_label: definition.label,
      segment_order: definition.order,
      datacenter_scope: definition.datacenterScope,
      verification_scope: definition.verificationScope,
      gpu_count_range: definition.gpuCountRange,
      market_utilisation_pct: computeUtilizationRate(summary.gpusRented, summary.gpusOnPlatform),
      market_gpus_on_platform: finiteNumberOrNull(summary.gpusOnPlatform, 0),
      market_gpus_available: finiteNumberOrNull(summary.gpusAvailable, 0),
      market_gpus_rented: finiteNumberOrNull(summary.gpusRented, 0),
      market_machines_available: finiteNumberOrNull(summary.machinesAvailable, 0),
      market_median_price: finiteNumberOrNull(summary.medianPrice, 3),
      market_minimum_price: finiteNumberOrNull(summary.minimumPrice, 3),
      market_p10_price: finiteNumberOrNull(summary.p10Price, 3),
      market_p90_price: finiteNumberOrNull(summary.p90Price, 3)
    };
  }).filter(Boolean);
}

function summarizeExporterModel(row) {
  if (row?.stats) {
    return summarizeExporterStats(row.stats);
  }

  if (Array.isArray(row?.categories)) {
    return summarizeExporterCategories(row.categories);
  }

  return null;
}

function summarizeExporterStats(stats) {
  const allSummary = getExporterSummary(stats?.all?.all);
  const availableSummary = getExporterSummary(stats?.available?.all);
  const rentedSummary = getExporterSummary(stats?.rented?.all);

  return {
    gpusOnPlatform: allSummary?.count ?? null,
    gpusAvailable: availableSummary?.count ?? null,
    gpusRented: rentedSummary?.count ?? null,
    machinesAvailable: null,
    minimumPrice: allSummary?.price_minimum ?? null,
    medianPrice: allSummary?.price_median ?? null,
    p10Price: allSummary?.price_10th_percentile ?? null,
    p90Price: allSummary?.price_90th_percentile ?? null
  };
}

function summarizeExporterCategories(categories) {
  let gpusOnPlatform = 0;
  let gpusAvailable = 0;
  let gpusRented = 0;
  const allPricePoints = [];

  for (const category of categories) {
    const allSummary = getExporterSummary(category?.stats?.all);
    const availableSummary = getExporterSummary(category?.stats?.available);
    const rentedSummary = getExporterSummary(category?.stats?.rented);

    gpusOnPlatform += Number(allSummary?.count) || 0;
    gpusAvailable += Number(availableSummary?.count) || 0;
    gpusRented += Number(rentedSummary?.count) || 0;

    if ((Number(allSummary?.count) || 0) > 0) {
      allPricePoints.push({
        count: Number(allSummary.count) || 0,
        medianPrice: allSummary?.price_median ?? null,
        p10Price: allSummary?.price_10th_percentile ?? null,
        p90Price: allSummary?.price_90th_percentile ?? null
      });
    }
  }

  return {
    gpusOnPlatform,
    gpusAvailable,
    gpusRented,
    machinesAvailable: null,
    minimumPrice: null,
    medianPrice: weightedAverage(allPricePoints, "medianPrice"),
    p10Price: weightedAverage(allPricePoints, "p10Price"),
    p90Price: weightedAverage(allPricePoints, "p90Price")
  };
}

function getExporterSummary(value) {
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value && typeof value === "object"
    ? value
    : null;
}

function weightedAverage(points, key) {
  const rows = Array.isArray(points) ? points : [];
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const value = Number(row?.[key]);
    const count = Number(row?.count);
    if (!Number.isFinite(value) || !Number.isFinite(count) || count <= 0) {
      continue;
    }

    weightedTotal += value * count;
    totalWeight += count;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return weightedTotal / totalWeight;
}

function computeUtilizationRate(rentedCount, totalCount) {
  const rented = Number(rentedCount);
  const total = Number(totalCount);
  if (!Number.isFinite(rented) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return finiteNumberOrNull((rented / total) * 100, 2);
}

export function buildPlatformGpuMetricIndex(rows, segments = []) {
  const normalizedRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const normalizedSegments = Array.isArray(segments) ? segments.filter(Boolean) : [];
  const byCanonicalGpuType = new Map();
  const segmentsByCanonicalGpuType = new Map();

  for (const row of normalizedRows) {
    const canonicalGpuType = row.canonical_gpu_type || canonicalizeGpuType(row.gpu_type);
    if (!canonicalGpuType) {
      continue;
    }

    byCanonicalGpuType.set(canonicalGpuType, {
      ...row,
      canonical_gpu_type: canonicalGpuType
    });
  }

  for (const row of normalizedSegments) {
    const canonicalGpuType = row.canonical_gpu_type || canonicalizeGpuType(row.gpu_type);
    if (!canonicalGpuType) {
      continue;
    }

    const current = segmentsByCanonicalGpuType.get(canonicalGpuType) || [];
    current.push({
      ...row,
      canonical_gpu_type: canonicalGpuType
    });
    current.sort((left, right) => (left.segment_order ?? 999) - (right.segment_order ?? 999));
    segmentsByCanonicalGpuType.set(canonicalGpuType, current);
  }

  return {
    rows: normalizedRows,
    byCanonicalGpuType,
    segmentsByCanonicalGpuType
  };
}

export function matchPlatformGpuMetric(fleetGpuType, metricIndex) {
  const gpuType = String(fleetGpuType || "").trim();
  const canonicalGpuType = canonicalizeGpuType(gpuType);
  if (!canonicalGpuType) {
    return {
      market_match_status: "unmatched",
      matched_metric: null
    };
  }

  const safeAliasCanonical = PLATFORM_GPU_SAFE_ALIAS_MAP.get(canonicalGpuType) || canonicalGpuType;
  const exactMatch = metricIndex?.byCanonicalGpuType?.get(safeAliasCanonical) || null;
  if (exactMatch) {
    return {
      market_match_status: "matched",
      matched_metric: exactMatch
    };
  }

  const ambiguousCandidates = (metricIndex?.rows || []).filter((row) => row.canonical_gpu_type.startsWith(canonicalGpuType));
  if (ambiguousCandidates.length > 1) {
    return {
      market_match_status: "ambiguous",
      matched_metric: null
    };
  }

  return {
    market_match_status: "unmatched",
    matched_metric: null
  };
}

export function computeFleetWeightedPlatformUtilization(breakdownRows) {
  const rows = Array.isArray(breakdownRows) ? breakdownRows : [];
  const totalListedGpus = rows.reduce((sum, row) => sum + (Number(row?.listed_gpus) || 0), 0);

  let matchedListedGpus = 0;
  let weightedUtilizationSum = 0;

  for (const row of rows) {
    const listedGpus = Number(row?.listed_gpus) || 0;
    const marketUtilisationPct = row?.market_utilisation_pct == null ? NaN : Number(row.market_utilisation_pct);
    if (listedGpus <= 0 || !Number.isFinite(marketUtilisationPct)) {
      continue;
    }

    matchedListedGpus += listedGpus;
    weightedUtilizationSum += listedGpus * marketUtilisationPct;
  }

  return {
    marketUtilisationPct: matchedListedGpus > 0
      ? Number((weightedUtilizationSum / matchedListedGpus).toFixed(2))
      : null,
    marketMatchedListedGpus: matchedListedGpus,
    marketTotalListedGpus: totalListedGpus,
    marketCoveragePct: totalListedGpus > 0
      ? Number(((matchedListedGpus / totalListedGpus) * 100).toFixed(2))
      : 0
  };
}

export function computeMarketPriceComparison(currentPrice, marketMedianPrice) {
  const current = currentPrice == null ? NaN : Number(currentPrice);
  const marketMedian = marketMedianPrice == null ? NaN : Number(marketMedianPrice);
  if (!Number.isFinite(current) || !Number.isFinite(marketMedian)) {
    return {
      market_price_delta: null,
      market_price_delta_pct: null,
      market_price_position: "unknown"
    };
  }

  const delta = Number((current - marketMedian).toFixed(3));
  const pctDelta = marketMedian === 0
    ? null
    : Number((((current - marketMedian) / marketMedian) * 100).toFixed(2));
  const epsilon = 0.0005;

  return {
    market_price_delta: delta,
    market_price_delta_pct: pctDelta,
    market_price_position: Math.abs(delta) <= epsilon
      ? "at_market"
      : delta > 0
        ? "above_market"
        : "below_market"
  };
}

export function buildMarketEnrichedBreakdownRows(gpuTypeRows, metricIndex) {
  return (Array.isArray(gpuTypeRows) ? gpuTypeRows : []).map((item) => {
    const avgPrice = item.priced_gpus > 0
      ? Number((item.total_price_weighted / item.priced_gpus).toFixed(3))
      : null;
    const marketMatch = matchPlatformGpuMetric(item.gpu_type, metricIndex);
    const matchedMetric = marketMatch.matched_metric;

    return {
      gpu_type: item.gpu_type,
      machines: item.machines,
      listed_gpus: item.listed_gpus,
      unlisted_gpus: item.unlisted_gpus,
      utilisation_pct: item.listed_gpus > 0 ? Number(((item.occupied_gpus / item.listed_gpus) * 100).toFixed(2)) : 0,
      avg_price: avgPrice,
      earnings: Number(item.earnings.toFixed(2)),
      market_utilisation_pct: matchedMetric?.market_utilisation_pct ?? null,
      market_gpus_on_platform: matchedMetric?.market_gpus_on_platform ?? null,
      market_gpus_available: matchedMetric?.market_gpus_available ?? null,
      market_gpus_rented: matchedMetric?.market_gpus_rented ?? null,
      market_machines_available: matchedMetric?.market_machines_available ?? null,
      market_median_price: matchedMetric?.market_median_price ?? null,
      market_minimum_price: matchedMetric?.market_minimum_price ?? null,
      market_p10_price: matchedMetric?.market_p10_price ?? null,
      market_p90_price: matchedMetric?.market_p90_price ?? null,
      market_segments: matchedMetric
        ? [...(metricIndex?.segmentsByCanonicalGpuType?.get(matchedMetric.canonical_gpu_type) || [])]
        : [],
      ...computeMarketPriceComparison(avgPrice, matchedMetric?.market_median_price ?? null),
      market_match_status: marketMatch.market_match_status
    };
  });
}

export function canonicalizeGpuType(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

function finiteNumberOrNull(value, decimals = 2) {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (decimals <= 0) {
    return Math.round(numeric);
  }

  return Number(numeric.toFixed(decimals));
}

const PLATFORM_GPU_SAFE_ALIAS_MAP = new Map([
  ["rtx6000ada", "rtx6000ada"],
  ["rtxa4000", "rtxa4000"],
  ["rtx4090", "rtx4090"],
  ["rtx5090", "rtx5090"]
]);

const PLATFORM_GPU_SEGMENT_DEFINITIONS = [
  {
    segmentKey: "all",
    label: "All market",
    order: 0,
    datacenterScope: "all",
    verificationScope: "all",
    gpuCountRange: "all",
    matches: () => true
  },
  {
    segmentKey: "dc:any|verified:any|size:all",
    label: "Datacenter",
    order: 1,
    datacenterScope: "dc",
    verificationScope: "all",
    gpuCountRange: "all",
    matches: (category) => category?.datacenter === true
  },
  {
    segmentKey: "non-dc:any|verified:any|size:all",
    label: "Non-DC",
    order: 2,
    datacenterScope: "non-dc",
    verificationScope: "all",
    gpuCountRange: "all",
    matches: (category) => category?.datacenter === false
  },
  {
    segmentKey: "dc:any|verified:true|size:all",
    label: "Verified",
    order: 3,
    datacenterScope: "all",
    verificationScope: "verified",
    gpuCountRange: "all",
    matches: (category) => category?.verified === true
  },
  {
    segmentKey: "dc:any|verified:false|size:all",
    label: "Unverified",
    order: 4,
    datacenterScope: "all",
    verificationScope: "unverified",
    gpuCountRange: "all",
    matches: (category) => category?.verified === false
  },
  {
    segmentKey: "dc:any|verified:any|size:1-3",
    label: "1-3 GPUs",
    order: 5,
    datacenterScope: "all",
    verificationScope: "all",
    gpuCountRange: "1-3",
    matches: (category) => String(category?.gpu_count_range || "") === "1-3"
  },
  {
    segmentKey: "dc:any|verified:any|size:4-7",
    label: "4-7 GPUs",
    order: 6,
    datacenterScope: "all",
    verificationScope: "all",
    gpuCountRange: "4-7",
    matches: (category) => String(category?.gpu_count_range || "") === "4-7"
  },
  {
    segmentKey: "dc:any|verified:any|size:8+",
    label: "8+ GPUs",
    order: 7,
    datacenterScope: "all",
    verificationScope: "all",
    gpuCountRange: "8+",
    matches: (category) => String(category?.gpu_count_range || "") === "8+"
  }
];

export {
  DEFAULT_PLATFORM_METRICS_SEGMENT_URL,
  DEFAULT_PLATFORM_METRICS_TIMEOUT_MS,
  DEFAULT_PLATFORM_METRICS_TTL_MS,
  DEFAULT_PLATFORM_METRICS_URL
};
