const DEFAULT_PLATFORM_METRICS_URL = "https://gpu-treemap.replit.app/api/gpu-data";
const DEFAULT_PLATFORM_METRICS_TIMEOUT_MS = 15 * 1000;
const DEFAULT_PLATFORM_METRICS_TTL_MS = 15 * 60 * 1000;

export function createPlatformMetricsClient({
  fetchImpl = fetch,
  url = DEFAULT_PLATFORM_METRICS_URL,
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
          error: null
        };
      }

      try {
        const rows = await fetchPlatformGpuMetrics({
          fetchImpl,
          url,
          timeoutMs
        });

        cache = {
          rows,
          fetchedAt: new Date(nowMs).toISOString(),
          expiresAtMs: nowMs + ttlMs
        };

        return {
          ok: true,
          stale: false,
          source: url,
          fetchedAt: cache.fetchedAt,
          rows: cache.rows,
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
            error: error instanceof Error ? error.message : String(error)
          };
        }

        return {
          ok: false,
          stale: false,
          source: url,
          fetchedAt: null,
          rows: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

export async function fetchPlatformGpuMetrics({
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

  const payload = await response.json();
  return normalizePlatformGpuMetrics(payload);
}

export function normalizePlatformGpuMetrics(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((row) => {
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
    })
    .filter(Boolean);
}

export function buildPlatformGpuMetricIndex(rows) {
  const normalizedRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const byCanonicalGpuType = new Map();

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

  return {
    rows: normalizedRows,
    byCanonicalGpuType
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

export {
  DEFAULT_PLATFORM_METRICS_TIMEOUT_MS,
  DEFAULT_PLATFORM_METRICS_TTL_MS,
  DEFAULT_PLATFORM_METRICS_URL
};
