import test from "node:test";
import assert from "node:assert/strict";

import {
  addSyntheticBaselineSeries,
  buildMarketPriceTooltipMarkup,
  buildBreakdownMarketPriceComparison,
  findMatchingMarketUtilizationSeries,
  mergeHistoryWithMarketSeries,
  parseMarketPriceTooltipData,
  renderBreakdownPriceCell,
  serializeMarketPriceTooltipData
} from "../public/app/market-benchmarks.js";

test("market benchmark helpers match persisted market utilization series by canonical GPU type", () => {
  const series = findMatchingMarketUtilizationSeries(
    { key: "gpu_type_util_0", label: "RTX 6000Ada" },
    [
      { gpu_type: "rtx 4090", canonical_gpu_type: "rtx4090", points: [] },
      { gpu_type: "rtx 6000ada", canonical_gpu_type: "rtx6000ada", points: [{ polled_at: "2026-04-08T10:00:00.000Z", utilisation_pct: 61.5 }] }
    ]
  );

  assert.equal(series?.canonical_gpu_type, "rtx6000ada");
});

test("market benchmark helpers merge market points into utilization history rows", () => {
  const merged = mergeHistoryWithMarketSeries(
    [
      { polled_at: "2026-04-08T10:00:00.000Z", utilisation_pct: 60 },
      { polled_at: "2026-04-08T11:00:00.000Z", utilisation_pct: 70 }
    ],
    [
      { polled_at: "2026-04-08T11:00:00.000Z", utilisation_pct: 75 },
      { polled_at: "2026-04-08T12:00:00.000Z", utilisation_pct: 78 }
    ],
    "__market__"
  );

  assert.deepEqual(merged, [
    { polled_at: "2026-04-08T10:00:00.000Z", utilisation_pct: 60, __market__: 75 },
    { polled_at: "2026-04-08T11:00:00.000Z", utilisation_pct: 70, __market__: 75 },
    { polled_at: "2026-04-08T12:00:00.000Z", __market__: 78 }
  ]);
});

test("market benchmark helpers can synthesize a baseline series from the first recorded chart data", () => {
  const synthetic = addSyntheticBaselineSeries(
    [
      { polled_at: "2026-04-08T10:00:00.000Z", utilisation_pct: 60 },
      { polled_at: "2026-04-08T11:00:00.000Z", utilisation_pct: 70 }
    ],
    82.5,
    "__market_baseline__"
  );

  assert.deepEqual(synthetic, [
    { polled_at: "2026-04-08T10:00:00.000Z", utilisation_pct: 60, __market_baseline__: 82.5 },
    { polled_at: "2026-04-08T11:00:00.000Z", utilisation_pct: 70, __market_baseline__: 82.5 }
  ]);
});

test("market benchmark helpers build breakdown price comparison markup", () => {
  const comparison = buildBreakdownMarketPriceComparison({
    avg_price: 0.375,
    market_median_price: 0.35
  });
  const markup = renderBreakdownPriceCell({
    avg_price: 0.375,
    market_median_price: 0.35
  });

  assert.deepEqual(comparison, {
    className: "above",
    text: "+$0.025 (+7.14%) vs vast median",
    title: "Fleet average listed price is above the current vast median"
  });
  assert.match(markup, /\$0\.375/);
  assert.doesNotMatch(markup, /vs Vast median/);
});

test("market benchmark helpers serialize and render price comparison tooltip payloads", () => {
  const encoded = serializeMarketPriceTooltipData({
    gpu_type: "RTX 4090",
    avg_price: 0.375,
    market_median_price: 0.35,
    market_segments: [
      {
        gpu_type: "RTX 4090",
        segment_label: "All market",
        segment_order: 0,
        market_median_price: 0.35,
        market_p10_price: 0.269,
        market_p90_price: 0.434
      },
      {
        gpu_type: "RTX 4090",
        segment_label: "Datacenter",
        segment_order: 1,
        market_median_price: 0.36,
        market_p10_price: 0.31,
        market_p90_price: 0.42
      },
      {
        gpu_type: "RTX 4090",
        segment_label: "Verified",
        segment_order: 3,
        market_median_price: 0.38,
        market_p10_price: 0.32,
        market_p90_price: 0.44
      }
    ]
  });
  const payload = parseMarketPriceTooltipData(encoded);
  const markup = buildMarketPriceTooltipMarkup(payload);

  assert.equal(payload.state, "matched");
  assert.match(markup, /Our Avg Price/);
  assert.match(markup, /Data Center Price/);
  assert.match(markup, /\$0\.375\/hr/);
  assert.match(markup, /\+\$0\.015 \(\+4\.17%\) vs data center price/);
  assert.match(markup, /Segmented market/);
  assert.match(markup, /Verified/);
  assert.match(markup, /\$0\.380\/hr/);
});
