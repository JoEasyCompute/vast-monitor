import { escapeHtml, formatCurrency } from "./formatters.js";

export function canonicalizeGpuType(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

export function buildBreakdownMarketPriceComparison(row) {
  const baselinePrice = resolveComparisonBaselinePrice(row);
  const baselineLabel = resolveComparisonBaselineLabel(row);
  const currentPrice = row?.avg_price == null ? NaN : Number(row.avg_price);

  if (!Number.isFinite(currentPrice) || !Number.isFinite(baselinePrice)) {
    return null;
  }

  const delta = Number((currentPrice - baselinePrice).toFixed(3));
  const pctDelta = baselinePrice === 0
    ? null
    : Number((((currentPrice - baselinePrice) / baselinePrice) * 100).toFixed(2));
  const position = Math.abs(delta) <= 0.0005
    ? "at_market"
    : delta > 0
      ? "above_market"
      : "below_market";

  if (!Number.isFinite(delta) || position === "unknown") {
    return null;
  }

  if (position === "at_market") {
    return {
      className: "flat",
      text: `At ${baselineLabel.toLowerCase()}`,
      title: `Fleet average listed price is effectively at the current ${baselineLabel.toLowerCase()}`
    };
  }

  const directionText = delta > 0 ? "above" : "below";
  const pctText = Number.isFinite(pctDelta) ? ` (${pctDelta > 0 ? "+" : ""}${pctDelta}%)` : "";
  return {
    className: position === "above_market" ? "above" : "below",
    text: `${delta > 0 ? "+" : ""}${formatCurrency(delta)}${pctText} vs ${baselineLabel.toLowerCase()}`,
    title: `Fleet average listed price is ${directionText} the current ${baselineLabel.toLowerCase()}`
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
    const segmentMarkup = buildMarketPriceSegmentMarkup(payload.marketSegments);

    return `<div class="market-tooltip-card">
      <div class="market-tooltip-title">${escapeHtml(payload.gpuType || "Avg Price")}</div>
      <div class="market-tooltip-subtitle">Current fleet price vs ${escapeHtml(payload.baselineLabel.toLowerCase())}</div>
      <div class="market-tooltip-grid">
        <div class="market-tooltip-label">Our Avg Price</div>
        <div class="market-tooltip-value">${escapeHtml(formatPriceOrDash(payload.avgPrice))}</div>
        <div class="market-tooltip-label">${escapeHtml(payload.baselineLabel)}</div>
        <div class="market-tooltip-value">${escapeHtml(formatPriceOrDash(payload.marketMedianPrice))}</div>
        <div class="market-tooltip-label">Difference</div>
        <div class="market-tooltip-value">${escapeHtml(payload.comparison.text)}</div>
      </div>
      ${segmentMarkup}
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
  const comparison = buildBreakdownMarketPriceComparison(row);
  const marketMedianPrice = toFiniteNumberOrNull(resolveComparisonBaselinePrice(row));
  const baselineLabel = resolveComparisonBaselineLabel(row);

  if (avgPrice != null && marketMedianPrice != null && comparison) {
    return {
      state: "matched",
      gpuType,
      avgPrice,
      marketMedianPrice,
      baselineLabel,
      comparison,
      marketSegments: normalizeMarketSegments(row?.market_segments)
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

export function normalizeMarketSegments(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const gpuType = String(segment?.gpu_type || "").trim();
      const segmentLabel = formatMarketSegmentLabel(segment);
      if (!gpuType || !segmentLabel) {
        return null;
      }

      return {
        gpuType,
        segmentLabel,
        segmentKey: String(segment?.segment_key || "").trim() || segmentLabel,
        segmentOrder: Number.isFinite(Number(segment?.segment_order)) ? Number(segment.segment_order) : 999,
        marketUtilisationPct: toFiniteNumberOrNull(segment?.market_utilisation_pct),
        marketGpusOnPlatform: toFiniteNumberOrNull(segment?.market_gpus_on_platform),
        marketGpusAvailable: toFiniteNumberOrNull(segment?.market_gpus_available),
        marketGpusRented: toFiniteNumberOrNull(segment?.market_gpus_rented),
        marketMedianPrice: toFiniteNumberOrNull(segment?.market_median_price),
        marketP10Price: toFiniteNumberOrNull(segment?.market_p10_price),
        marketP90Price: toFiniteNumberOrNull(segment?.market_p90_price)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.segmentOrder - right.segmentOrder || left.segmentLabel.localeCompare(right.segmentLabel));
}

export function formatMarketSegmentLabel(segment) {
  const explicitLabel = String(segment?.segment_label || "").trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  if (segment?.datacenter_scope === "dc") {
    return "Datacenter";
  }
  if (segment?.datacenter_scope === "non-dc") {
    return "Non-DC";
  }
  if (segment?.verification_scope === "verified") {
    return "Verified";
  }
  if (segment?.verification_scope === "unverified") {
    return "Unverified";
  }
  if (segment?.gpu_count_range && segment.gpu_count_range !== "all") {
    return `${segment.gpu_count_range} GPUs`;
  }

  return "All market";
}

function buildMarketPriceSegmentMarkup(segments) {
  if (!Array.isArray(segments) || !segments.length) {
    return "";
  }

  return `<div class="market-tooltip-segment-section">
    <div class="market-tooltip-subtitle">Segmented market</div>
    <div class="market-tooltip-table-wrap">
      <table class="market-tooltip-table">
        <thead>
          <tr>
            <th>Segment</th>
            <th>Median</th>
            <th>P10</th>
            <th>P90</th>
          </tr>
        </thead>
        <tbody>
          ${segments.map((segment) => `
            <tr>
              <td>${escapeHtml(segment.segmentLabel)}</td>
              <td>${escapeHtml(formatPriceOrDash(segment.marketMedianPrice))}</td>
              <td>${escapeHtml(formatPriceOrDash(segment.marketP10Price))}</td>
              <td>${escapeHtml(formatPriceOrDash(segment.marketP90Price))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

function resolveComparisonBaselinePrice(row) {
  const segment = findMarketSegment(normalizeMarketSegments(row?.market_segments), "Datacenter");
  return segment?.marketMedianPrice ?? toFiniteNumberOrNull(row?.market_median_price);
}

function resolveComparisonBaselineLabel(row) {
  const segment = findMarketSegment(normalizeMarketSegments(row?.market_segments), "Datacenter");
  return segment?.marketMedianPrice != null ? "Data Center Price" : "Vast Median";
}

function findMarketSegment(segments, label) {
  return (Array.isArray(segments) ? segments : []).find((segment) => segment.segmentLabel === label) || null;
}
