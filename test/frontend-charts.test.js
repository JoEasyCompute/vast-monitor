import test from "node:test";
import assert from "node:assert/strict";

import {
  drawMultiSeriesChart,
  resolveUtilizationBenchmarkLine
} from "../public/app/charts.js";

test("resolveUtilizationBenchmarkLine uses fleet summary for total fleet and breakdown rows for specific GPU types", () => {
  const marketBenchmark = { ok: true, stale: false };
  const summary = { marketUtilisationPct: 84.12 };
  const breakdownRows = [
    { gpu_type: "RTX 4090", market_utilisation_pct: 87.38 },
    { gpu_type: "H100", market_utilisation_pct: null }
  ];

  assert.deepEqual(
    resolveUtilizationBenchmarkLine({
      selectedSeries: { key: "__fleet__", label: "Total fleet" },
      summary,
      breakdownRows,
      marketBenchmark
    }),
    {
      value: 84.12,
      label: "Vast now",
      color: "#94a3b8",
      dashed: true
    }
  );

  assert.deepEqual(
    resolveUtilizationBenchmarkLine({
      selectedSeries: { key: "gpu_type_util_0", label: "RTX 4090" },
      summary,
      breakdownRows,
      marketBenchmark
    }),
    {
      value: 87.38,
      label: "Vast now",
      color: "#94a3b8",
      dashed: true
    }
  );

  assert.equal(
    resolveUtilizationBenchmarkLine({
      selectedSeries: { key: "gpu_type_util_1", label: "H100" },
      summary,
      breakdownRows,
      marketBenchmark
    }),
    null
  );
});

test("drawMultiSeriesChart renders a dashed benchmark overlay when provided", () => {
  const svg = createSvgStub();

  drawMultiSeriesChart(svg, [
    { polled_at: "2026-04-08T10:00:00.000Z", utilisation_pct: 60 },
    { polled_at: "2026-04-08T11:00:00.000Z", utilisation_pct: 80 }
  ], [
    { key: "__fleet__", sourceKey: "utilisation_pct", label: "Total fleet", color: "#f43f5e" }
  ], {
    min: 0,
    max: 100,
    formatValue: (value) => `${Math.round(value)}%`,
    benchmarkLine: {
      value: 75,
      label: "Vast now",
      color: "#94a3b8",
      dashed: true
    }
  });

  assert.equal(svg.attrs.viewBox, "0 0 720 180");
  assert.match(svg.innerHTML, /trend-line-benchmark/);
  assert.match(svg.innerHTML, /stroke-dasharray:6 4/);
  assert.match(svg.innerHTML, />Vast now</);
});

function createSvgStub() {
  return {
    attrs: {},
    innerHTML: "",
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    querySelector() {
      return null;
    },
    onmousemove: null,
    onmouseleave: null
  };
}
