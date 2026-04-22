import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMarketTooltipMarkup,
  parseMarketTooltipData,
  serializeMarketTooltipData
} from "../public/app/market-tooltip.js";

test("market tooltip serializes matched rows and renders detailed Vast stats", () => {
  const encoded = serializeMarketTooltipData({
    gpu_type: "RTX 4090",
    market_utilisation_pct: 87.38,
    market_gpus_on_platform: 3558,
    market_gpus_available: 449,
    market_gpus_rented: 3109,
    market_machines_available: 879,
    market_median_price: 0.35,
    market_minimum_price: 0.201,
    market_p10_price: 0.269,
    market_p90_price: 0.434,
    market_segments: [
      {
        gpu_type: "RTX 4090",
        segment_label: "All market",
        segment_order: 0,
        market_utilisation_pct: 87.38,
        market_gpus_on_platform: 3558
      },
      {
        gpu_type: "RTX 4090",
        segment_label: "Datacenter",
        segment_order: 1,
        market_utilisation_pct: 91.9,
        market_gpus_on_platform: 828
      }
    ]
  });
  const payload = parseMarketTooltipData(encoded);
  const markup = buildMarketTooltipMarkup(payload);

  assert.equal(payload.gpuType, "RTX 4090");
  assert.equal(payload.state, "matched");
  assert.match(markup, /Current Vast platform stats/);
  assert.match(markup, /Vast Utilisation/);
  assert.match(markup, /3558/);
  assert.match(markup, /\$0\.350\/hr/);
  assert.match(markup, /\$0\.201\/hr/);
  assert.match(markup, /\$0\.434\/hr/);
  assert.match(markup, /Segmented market/);
  assert.match(markup, /Datacenter/);
  assert.match(markup, /91\.9%/);
});

test("market tooltip renders explanatory note for ambiguous GPU rows", () => {
  const encoded = serializeMarketTooltipData({
    gpu_type: "H100",
    market_match_status: "ambiguous",
    market_utilisation_pct: null
  });
  const payload = parseMarketTooltipData(encoded);
  const markup = buildMarketTooltipMarkup(payload);

  assert.equal(payload.state, "ambiguous");
  assert.match(markup, /variant-specific/);
});
