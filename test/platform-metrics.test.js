import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlatformGpuMetricIndex,
  computeFleetWeightedPlatformUtilization,
  createPlatformMetricsClient,
  matchPlatformGpuMetric,
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

test("platform metrics client returns stale cached snapshot when refresh fails after cache expiry", async () => {
  let nowMs = Date.parse("2026-04-08T10:50:00.000Z");
  let failRequests = false;
  let calls = 0;
  const client = createPlatformMetricsClient({
    ttlMs: 1000,
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
