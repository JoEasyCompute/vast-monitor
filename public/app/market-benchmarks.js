import { escapeHtml, formatCurrency } from "./formatters.js";

export function canonicalizeGpuType(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

export function buildBreakdownMarketPriceComparison(row) {
  const delta = row?.market_price_delta == null ? NaN : Number(row.market_price_delta);
  const pctDelta = row?.market_price_delta_pct == null ? null : Number(row.market_price_delta_pct);
  const position = String(row?.market_price_position || "unknown");

  if (!Number.isFinite(delta) || position === "unknown") {
    return null;
  }

  if (position === "at_market") {
    return {
      className: "flat",
      text: "At Vast median",
      title: "Fleet average listed price is effectively at the current Vast median"
    };
  }

  const directionText = delta > 0 ? "above" : "below";
  const pctText = Number.isFinite(pctDelta) ? ` (${pctDelta > 0 ? "+" : ""}${pctDelta}%)` : "";
  return {
    className: position === "above_market" ? "above" : "below",
    text: `${delta > 0 ? "+" : ""}${formatCurrency(delta)}${pctText} vs Vast median`,
    title: `Fleet average listed price is ${directionText} the current Vast median`
  };
}

export function renderBreakdownPriceCell(row) {
  if (row?.avg_price == null) {
    return "-";
  }

  const comparison = buildBreakdownMarketPriceComparison(row);
  if (!comparison) {
    return `$${Number(row.avg_price).toFixed(3)}`;
  }

  return `<div class="breakdown-price-cell" title="${escapeHtml(comparison.title)}">
    <div class="breakdown-price-primary">$${Number(row.avg_price).toFixed(3)}</div>
    <div class="breakdown-price-compare breakdown-price-compare-${escapeHtml(comparison.className)}">${escapeHtml(comparison.text)}</div>
  </div>`;
}

export function findMatchingMarketUtilizationSeries(selectedSeries, marketSeries) {
  if (!selectedSeries || selectedSeries.key === "__fleet__") {
    return null;
  }

  const canonicalSelected = canonicalizeGpuType(selectedSeries.label);
  return (Array.isArray(marketSeries) ? marketSeries : []).find((series) => (
    canonicalizeGpuType(series?.canonical_gpu_type || series?.gpu_type) === canonicalSelected
  )) || null;
}

export function mergeHistoryWithMarketSeries(historyRows, marketPoints, sourceKey) {
  const rowsByTimestamp = new Map(
    (Array.isArray(historyRows) ? historyRows : []).map((row) => [row.polled_at, { ...row }])
  );

  for (const point of Array.isArray(marketPoints) ? marketPoints : []) {
    const row = rowsByTimestamp.get(point.polled_at) || { polled_at: point.polled_at };
    row[sourceKey] = point.utilisation_pct;
    rowsByTimestamp.set(point.polled_at, row);
  }

  return [...rowsByTimestamp.values()].sort((left, right) => Date.parse(left.polled_at) - Date.parse(right.polled_at));
}
