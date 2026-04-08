import { canonicalizeGpuType } from "./platform-metrics.js";

export function buildMarketGpuTypeUtilizationHistory(rawRows, rollupRows) {
  const rows = [
    ...(Array.isArray(rollupRows) ? rollupRows : []),
    ...(Array.isArray(rawRows) ? rawRows : [])
  ];
  if (!rows.length) {
    return [];
  }

  const totalsByGpuType = new Map();
  const grouped = new Map();

  for (const row of rows) {
    const canonicalGpuType = row.canonical_gpu_type || canonicalizeGpuType(row.gpu_type);
    const platformGpuCount = Number(row.market_gpus_on_platform) || 0;
    const point = {
      polled_at: row.polled_at,
      utilisation_pct: Number(row.market_utilisation_pct) || 0,
      gpus_on_platform: platformGpuCount,
      gpus_available: Number(row.market_gpus_available) || 0,
      gpus_rented: Number(row.market_gpus_rented) || 0
    };

    totalsByGpuType.set(canonicalGpuType, (totalsByGpuType.get(canonicalGpuType) || 0) + platformGpuCount);
    const current = grouped.get(canonicalGpuType) || {
      gpu_type: row.gpu_type,
      canonical_gpu_type: canonicalGpuType,
      points: []
    };
    current.points.push(point);
    grouped.set(canonicalGpuType, current);
  }

  return [...grouped.values()]
    .sort((left, right) => {
      const leftTotal = totalsByGpuType.get(left.canonical_gpu_type) || 0;
      const rightTotal = totalsByGpuType.get(right.canonical_gpu_type) || 0;
      return rightTotal - leftTotal || left.gpu_type.localeCompare(right.gpu_type);
    })
    .map((series) => ({
      ...series,
      points: series.points.sort((left, right) => Date.parse(left.polled_at) - Date.parse(right.polled_at))
    }));
}

export function buildMarketWeightedUtilizationHistory(ourGpuTypeUtilization, marketGpuTypeUtilization) {
  if (!ourGpuTypeUtilization.length || !marketGpuTypeUtilization.length) {
    return [];
  }

  const marketUtilByGpuAndTime = new Map();
  for (const series of marketGpuTypeUtilization) {
    const canonicalGpuType = series.canonical_gpu_type || canonicalizeGpuType(series.gpu_type);
    const byTime = new Map();
    for (const point of series.points) {
      byTime.set(point.polled_at, point.utilisation_pct);
    }
    marketUtilByGpuAndTime.set(canonicalGpuType, byTime);
  }

  const totalsByTime = new Map();
  for (const series of ourGpuTypeUtilization) {
    for (const point of series.points) {
      const listedGpus = Number(point.listed_gpus) || 0;
      if (listedGpus <= 0) {
        continue;
      }

      const current = totalsByTime.get(point.polled_at) || {
        polled_at: point.polled_at,
        matched_listed_gpus: 0,
        total_listed_gpus: 0,
        weighted_sum: 0
      };
      current.total_listed_gpus += listedGpus;
      totalsByTime.set(point.polled_at, current);
    }
  }

  for (const series of ourGpuTypeUtilization) {
    const canonicalGpuType = canonicalizeGpuType(series.gpu_type);
    const marketByTime = marketUtilByGpuAndTime.get(canonicalGpuType);
    if (!marketByTime) {
      continue;
    }

    for (const point of series.points) {
      const listedGpus = Number(point.listed_gpus) || 0;
      const marketUtilisationPct = marketByTime.get(point.polled_at);
      if (listedGpus <= 0 || !Number.isFinite(marketUtilisationPct)) {
        continue;
      }

      const current = totalsByTime.get(point.polled_at) || {
        polled_at: point.polled_at,
        matched_listed_gpus: 0,
        total_listed_gpus: 0,
        weighted_sum: 0
      };
      current.matched_listed_gpus += listedGpus;
      current.weighted_sum += listedGpus * marketUtilisationPct;
      totalsByTime.set(point.polled_at, current);
    }
  }

  return [...totalsByTime.values()]
    .map((row) => ({
      polled_at: row.polled_at,
      matched_listed_gpus: row.matched_listed_gpus,
      total_listed_gpus: row.total_listed_gpus,
      coverage_pct: row.total_listed_gpus > 0
        ? Number(((row.matched_listed_gpus / row.total_listed_gpus) * 100).toFixed(2))
        : 0,
      utilisation_pct: row.matched_listed_gpus > 0
        ? Number((row.weighted_sum / row.matched_listed_gpus).toFixed(2))
        : null
    }))
    .filter((row) => row.utilisation_pct != null)
    .sort((left, right) => Date.parse(left.polled_at) - Date.parse(right.polled_at));
}

export function buildPlatformGpuMetricHourlyRollups(rows) {
  if (!rows.length) {
    return [];
  }

  const grouped = new Map();

  for (const row of rows) {
    const bucketStart = toHourBucketStart(row.polled_at);
    const canonicalGpuType = row.canonical_gpu_type || canonicalizeGpuType(row.gpu_type);
    if (!bucketStart || !canonicalGpuType) {
      continue;
    }

    const key = `${bucketStart}|${canonicalGpuType}`;
    const current = grouped.get(key) || [];
    current.push({
      ...row,
      canonical_gpu_type: canonicalGpuType
    });
    grouped.set(key, current);
  }

  return [...grouped.entries()].map(([key, group]) => {
    const latest = group[group.length - 1];
    const bucketStart = key.slice(0, key.indexOf("|"));
    return {
      bucket_start: bucketStart,
      gpu_type: latest.gpu_type,
      canonical_gpu_type: latest.canonical_gpu_type,
      sample_count: group.length,
      market_utilisation_pct: averageFinite(group.map((row) => row.market_utilisation_pct)),
      market_gpus_on_platform: averageFinite(group.map((row) => row.market_gpus_on_platform)),
      market_gpus_available: averageFinite(group.map((row) => row.market_gpus_available)),
      market_gpus_rented: averageFinite(group.map((row) => row.market_gpus_rented)),
      market_machines_available: averageFinite(group.map((row) => row.market_machines_available)),
      market_median_price: averageFinite(group.map((row) => row.market_median_price)),
      market_minimum_price: averageFinite(group.map((row) => row.market_minimum_price)),
      market_p10_price: averageFinite(group.map((row) => row.market_p10_price)),
      market_p90_price: averageFinite(group.map((row) => row.market_p90_price))
    };
  });
}

function toHourBucketStart(value) {
  const timeMs = Date.parse(value);
  if (!Number.isFinite(timeMs)) {
    return null;
  }

  const date = new Date(timeMs);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function averageFinite(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return null;
  }

  return Number((finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length).toFixed(4));
}
