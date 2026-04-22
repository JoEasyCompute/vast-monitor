import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlatformGpuMetricIndex,
  computeFleetWeightedPlatformUtilization,
  computeMarketPriceComparison,
  createPlatformMetricsClient,
  DEFAULT_PLATFORM_METRICS_RATE_LIMIT_FALLBACK_MS,
  matchPlatformGpuMetric,
  normalizePlatformGpuMetricSegments,
  normalizePlatformGpuMetrics
} from "../src/platform-metrics.js";

test("platform metrics normalize rows and match exact canonical GPU names", () => {
  const rows = normalizePlatformGpuMetrics([
    {
      name: "rtx 4090",
      utilizationRate: 87.380550871276,
      medianPrice: 0.35,
      minimumPrice: 0.2,
      p10Price: 0.26,
      p90Price: 0.43,
      gpusOnPlatform: 3558,
      gpusAvailable: 449,
      gpusRented: 3109,
      machinesAvailable: 879,
      category: "Consumer"
    },
    {
      name: "rtx 6000ada",
      utilizationRate: 61.5,
      medianPrice: 1.25,
      minimumPrice: 1.1,
      p10Price: 1.15,
      p90Price: 1.4,
      gpusOnPlatform: 80,
      gpusAvailable: 31,
      gpusRented: 49,
      machinesAvailable: 22,
      category: "Consumer"
    }
  ]);
  const index = buildPlatformGpuMetricIndex(rows);

  const matched4090 = matchPlatformGpuMetric("RTX 4090", index);
  const matched6000Ada = matchPlatformGpuMetric("RTX 6000Ada", index);

  assert.equal(matched4090.market_match_status, "matched");
  assert.equal(matched4090.matched_metric.market_utilisation_pct, 87.38);
  assert.equal(matched4090.matched_metric.market_machines_available, 879);
  assert.equal(matched6000Ada.market_match_status, "matched");
  assert.equal(matched6000Ada.matched_metric.market_median_price, 1.25);
  assert.equal(matched6000Ada.matched_metric.market_p90_price, 1.4);
});

test("platform metrics normalize 500.farm exporter summary rows", () => {
  const rows = normalizePlatformGpuMetrics({
    models: [
      {
        name: "RTX 4090",
        stats: {
          rented: {
            all: [{ count: 3029 }]
          },
          available: {
            all: [{ count: 1387 }]
          },
          all: {
            all: [{
              count: 4416,
              price_median: 0.34,
              price_10th_percentile: 0.26,
              price_90th_percentile: 0.42
            }]
          }
        }
      }
    ]
  });

  assert.deepEqual(rows, [{
    gpu_type: "RTX 4090",
    canonical_gpu_type: "rtx4090",
    category: null,
    market_utilisation_pct: 68.59,
    market_gpus_on_platform: 4416,
    market_gpus_available: 1387,
    market_gpus_rented: 3029,
    market_machines_available: null,
    market_median_price: 0.34,
    market_minimum_price: null,
    market_p10_price: 0.26,
    market_p90_price: 0.42
  }]);
});

test("platform metrics collapse 500.farm v2 category rows into a GPU summary", () => {
  const rows = normalizePlatformGpuMetrics({
    models: [
      {
        name: "RTX 6000Ada",
        categories: [
          {
            stats: {
              rented: [{ count: 12 }],
              available: [{ count: 1 }],
              all: [{
                count: 13,
                price_median: 0.53,
                price_10th_percentile: 0.475,
                price_90th_percentile: 0.63
              }]
            }
          },
          {
            stats: {
              rented: [{ count: 35 }],
              available: [{ count: 5 }],
              all: [{
                count: 40,
                price_median: 0.53,
                price_10th_percentile: 0.46,
                price_90th_percentile: 0.6
              }]
            }
          }
        ]
      }
    ]
  });

  assert.deepEqual(rows, [{
    gpu_type: "RTX 6000Ada",
    canonical_gpu_type: "rtx6000ada",
    category: null,
    market_utilisation_pct: 88.68,
    market_gpus_on_platform: 53,
    market_gpus_available: 6,
    market_gpus_rented: 47,
    market_machines_available: null,
    market_median_price: 0.53,
    market_minimum_price: null,
    market_p10_price: 0.464,
    market_p90_price: 0.607
  }]);
});

test("platform metrics derive curated segment benchmarks from 500.farm v2 categories", () => {
  const segments = normalizePlatformGpuMetricSegments({
    models: [
      {
        name: "RTX 4090",
        categories: [
          {
            datacenter: false,
            verified: false,
            gpu_count_range: "1-3",
            stats: {
              rented: [{ count: 70 }],
              available: [{ count: 80 }],
              all: [{ count: 150, price_median: 0.22, price_10th_percentile: 0.16, price_90th_percentile: 0.37 }]
            }
          },
          {
            datacenter: true,
            verified: true,
            gpu_count_range: "8+",
            stats: {
              rented: [{ count: 253 }],
              available: [{ count: 20 }],
              all: [{ count: 273, price_median: 0.36, price_10th_percentile: 0.36, price_90th_percentile: 0.42 }]
            }
          }
        ]
      }
    ]
  });

  assert.deepEqual(segments.map((segment) => segment.segment_label), [
    "All market",
    "Datacenter",
    "Non-DC",
    "Verified",
    "Unverified",
    "1-3 GPUs",
    "8+ GPUs"
  ]);
  assert.equal(segments.find((segment) => segment.segment_label === "Datacenter")?.market_utilisation_pct, 92.67);
  assert.equal(segments.find((segment) => segment.segment_label === "Verified")?.market_median_price, 0.36);
  assert.equal(segments.find((segment) => segment.segment_label === "1-3 GPUs")?.market_gpus_on_platform, 150);
});

test("platform metrics leave generic H100 and A100 labels ambiguous instead of guessing a variant", () => {
  const rows = normalizePlatformGpuMetrics([
    { name: "h100 pcie", utilizationRate: 72, gpusOnPlatform: 10, gpusAvailable: 2, gpusRented: 8, machinesAvailable: 5, medianPrice: 1.3 },
    { name: "h100 sxm", utilizationRate: 81, gpusOnPlatform: 12, gpusAvailable: 3, gpusRented: 9, machinesAvailable: 6, medianPrice: 1.7 },
    { name: "h100 nvl", utilizationRate: 76, gpusOnPlatform: 5, gpusAvailable: 1, gpusRented: 4, machinesAvailable: 3, medianPrice: 1.5 },
    { name: "a100 pcie", utilizationRate: 65, gpusOnPlatform: 8, gpusAvailable: 3, gpusRented: 5, machinesAvailable: 4, medianPrice: 0.9 },
    { name: "a100 sxm4", utilizationRate: 88, gpusOnPlatform: 6, gpusAvailable: 1, gpusRented: 5, machinesAvailable: 2, medianPrice: 1.2 }
  ]);
  const index = buildPlatformGpuMetricIndex(rows);

  assert.equal(matchPlatformGpuMetric("H100", index).market_match_status, "ambiguous");
  assert.equal(matchPlatformGpuMetric("A100", index).market_match_status, "ambiguous");
});

test("platform metrics compute weighted fleet utilization from matched listed GPU counts only", () => {
  const summary = computeFleetWeightedPlatformUtilization([
    {
      gpu_type: "RTX 4090",
      listed_gpus: 6,
      market_utilisation_pct: 80
    },
    {
      gpu_type: "RTX 5090",
      listed_gpus: 4,
      market_utilisation_pct: 50
    },
    {
      gpu_type: "H100",
      listed_gpus: 3,
      market_utilisation_pct: null
    }
  ]);

  assert.equal(summary.marketUtilisationPct, 68);
  assert.equal(summary.marketMatchedListedGpus, 10);
  assert.equal(summary.marketTotalListedGpus, 13);
  assert.equal(summary.marketCoveragePct, 76.92);
});

test("platform metrics compute market price comparison deltas without guessing direction", () => {
  assert.deepEqual(computeMarketPriceComparison(0.375, 0.35), {
    market_price_delta: 0.025,
    market_price_delta_pct: 7.14,
    market_price_position: "above_market"
  });
  assert.deepEqual(computeMarketPriceComparison(0.35, 0.35), {
    market_price_delta: 0,
    market_price_delta_pct: 0,
    market_price_position: "at_market"
  });
  assert.deepEqual(computeMarketPriceComparison(null, 0.35), {
    market_price_delta: null,
    market_price_delta_pct: null,
    market_price_position: "unknown"
  });
});

test("platform metrics client returns stale cached snapshot when refresh fails after cache expiry", async () => {
  let nowMs = Date.parse("2026-04-08T10:50:00.000Z");
  let failRequests = false;
  let calls = 0;
  const client = createPlatformMetricsClient({
    ttlMs: 1000,
    segmentUrl: null,
    now: () => nowMs,
    fetchImpl: async () => {
      calls += 1;
      if (failRequests) {
        throw new Error("upstream unavailable");
      }

      return {
        ok: true,
        async json() {
          return [{
            name: "rtx 4090",
            utilizationRate: 87.3,
            medianPrice: 0.35,
            minimumPrice: 0.2,
            p10Price: 0.26,
            p90Price: 0.43,
            gpusOnPlatform: 3558,
            gpusAvailable: 449,
            gpusRented: 3109,
            machinesAvailable: 879,
            category: "Consumer"
          }];
        }
      };
    }
  });

  const fresh = await client.getSnapshot();
  assert.equal(fresh.ok, true);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.rows.length, 1);

  failRequests = true;
  nowMs += 2000;
  const stale = await client.getSnapshot();
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.rows.length, 1);
  assert.match(stale.error, /upstream unavailable/);
  assert.equal(calls, 2);
});

test("platform metrics client deduplicates concurrent refreshes behind one in-flight request", async () => {
  let calls = 0;
  let releaseFetch;
  const fetchPromise = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const client = createPlatformMetricsClient({
    ttlMs: 1000,
    segmentUrl: null,
    fetchImpl: async () => {
      calls += 1;
      await fetchPromise;
      return {
        ok: true,
        async json() {
          return [{
            name: "rtx 4090",
            utilizationRate: 87.3,
            medianPrice: 0.35,
            gpusOnPlatform: 3558,
            gpusAvailable: 449,
            gpusRented: 3109
          }];
        }
      };
    }
  });

  const first = client.getSnapshot();
  const second = client.getSnapshot();
  releaseFetch();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(firstResult.rows, secondResult.rows);
});

test("platform metrics client obeys 429 retry-after cooldown and serves stale cache during backoff", async () => {
  let nowMs = Date.parse("2026-04-08T10:50:00.000Z");
  let shouldRateLimit = false;
  let calls = 0;
  const client = createPlatformMetricsClient({
    ttlMs: 1000,
    segmentUrl: null,
    now: () => nowMs,
    fetchImpl: async () => {
      calls += 1;
      if (shouldRateLimit) {
        return {
          ok: false,
          status: 429,
          headers: {
            get(name) {
              return String(name).toLowerCase() === "retry-after" ? "120" : null;
            }
          }
        };
      }

      return {
        ok: true,
        async json() {
          return [{
            name: "rtx 4090",
            utilizationRate: 87.3,
            medianPrice: 0.35,
            gpusOnPlatform: 3558,
            gpusAvailable: 449,
            gpusRented: 3109
          }];
        }
      };
    }
  });

  const fresh = await client.getSnapshot();
  assert.equal(fresh.ok, true);
  assert.equal(fresh.stale, false);

  shouldRateLimit = true;
  nowMs += 2000;
  const stale = await client.getSnapshot();
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.match(stale.error, /rate-limited/i);
  assert.equal(calls, 2);

  const cooldown = await client.getSnapshot();
  assert.equal(cooldown.ok, true);
  assert.equal(cooldown.stale, true);
  assert.match(cooldown.error, /rate-limited/i);
  assert.equal(calls, 2);

  nowMs += 121000;
  const retry = await client.getSnapshot();
  assert.equal(retry.ok, true);
  assert.equal(retry.stale, true);
  assert.equal(calls, 3);
});

test("platform metrics client uses fallback cooldown when 429 omits retry-after", async () => {
  let nowMs = Date.parse("2026-04-08T10:50:00.000Z");
  let calls = 0;
  const client = createPlatformMetricsClient({
    ttlMs: 1000,
    segmentUrl: null,
    now: () => nowMs,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        headers: {
          get() {
            return null;
          }
        }
      };
    }
  });

  const first = await client.getSnapshot();
  assert.equal(first.ok, false);
  assert.match(first.error, /rate-limited/i);
  assert.equal(calls, 1);

  nowMs += DEFAULT_PLATFORM_METRICS_RATE_LIMIT_FALLBACK_MS - 1000;
  const cooldown = await client.getSnapshot();
  assert.equal(cooldown.ok, false);
  assert.match(cooldown.error, /rate-limited/i);
  assert.equal(calls, 1);
});
