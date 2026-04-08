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

  return `<span class="breakdown-price-primary">${escapeHtml(formatCurrency(row.avg_price))}</span>`;
}

export function serializeMarketPriceTooltipData(row) {
  const payload = buildMarketPriceTooltipPayload(row);
  return encodeURIComponent(JSON.stringify(payload));
}

export function parseMarketPriceTooltipData(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function buildMarketPriceTooltipMarkup(payload) {
  if (!payload) {
    return "";
  }

  if (payload.state === "matched") {
    return `<div class="market-tooltip-card">
      <div class="market-tooltip-title">${escapeHtml(payload.gpuType || "Avg Price")}</div>
      <div class="market-tooltip-subtitle">Current fleet price vs Vast median</div>
      <div class="market-tooltip-grid">
        <div class="market-tooltip-label">Our Avg Price</div>
        <div class="market-tooltip-value">${escapeHtml(formatPriceOrDash(payload.avgPrice))}</div>
        <div class="market-tooltip-label">Vast Median</div>
        <div class="market-tooltip-value">${escapeHtml(formatPriceOrDash(payload.marketMedianPrice))}</div>
        <div class="market-tooltip-label">Difference</div>
        <div class="market-tooltip-value">${escapeHtml(payload.comparison.text)}</div>
      </div>
    </div>`;
  }

  return `<div class="market-tooltip-card">
    <div class="market-tooltip-title">${escapeHtml(payload.gpuType || "Avg Price")}</div>
    <div class="market-tooltip-note">${escapeHtml(payload.message || "No current Vast price comparison available")}</div>
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
  const sortedMarketPoints = (Array.isArray(marketPoints) ? marketPoints : [])
    .filter((point) => point && point.polled_at)
    .sort((left, right) => Date.parse(left.polled_at) - Date.parse(right.polled_at));

  for (const point of sortedMarketPoints) {
    const row = rowsByTimestamp.get(point.polled_at) || { polled_at: point.polled_at };
    row[sourceKey] = point.utilisation_pct;
    rowsByTimestamp.set(point.polled_at, row);
  }

  const mergedRows = [...rowsByTimestamp.values()].sort((left, right) => Date.parse(left.polled_at) - Date.parse(right.polled_at));
  const firstMarketPoint = sortedMarketPoints[0] || null;
  const firstMarketTime = Date.parse(firstMarketPoint?.polled_at);
  const firstMarketValue = Number(firstMarketPoint?.utilisation_pct);

  if (Number.isFinite(firstMarketTime) && Number.isFinite(firstMarketValue)) {
    for (const row of mergedRows) {
      const rowTime = Date.parse(row.polled_at);
      if (!Number.isFinite(rowTime) || rowTime >= firstMarketTime) {
        break;
      }

      row[sourceKey] = firstMarketValue;
    }
  }

  return mergedRows;
}

export function addSyntheticBaselineSeries(historyRows, value, sourceKey) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Array.isArray(historyRows) ? [...historyRows] : [];
  }

  return (Array.isArray(historyRows) ? historyRows : []).map((row) => ({
    ...row,
    [sourceKey]: numeric
  }));
}

function buildMarketPriceTooltipPayload(row) {
  const gpuType = String(row?.gpu_type || "").trim();
  const avgPrice = toFiniteNumberOrNull(row?.avg_price);
  const marketMedianPrice = toFiniteNumberOrNull(row?.market_median_price);
  const comparison = buildBreakdownMarketPriceComparison(row);

  if (avgPrice != null && marketMedianPrice != null && comparison) {
    return {
      state: "matched",
      gpuType,
      avgPrice,
      marketMedianPrice,
      comparison
    };
  }

  if (row?.market_match_status === "ambiguous") {
    return {
      state: "ambiguous",
      gpuType,
      message: `${gpuType} is generic internally, while the external benchmark is variant-specific`
    };
  }

  return {
    state: "unmatched",
    gpuType,
    message: `No current Vast median price comparison available for ${gpuType || "this GPU type"}`
  };
}

function toFiniteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPriceOrDash(value) {
  return value == null ? "—" : `${formatCurrency(value)}/hr`;
}
