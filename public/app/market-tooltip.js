import { escapeHtml, formatCurrency } from "./formatters.js";
import { normalizeMarketSegments } from "./market-benchmarks.js";

export function serializeMarketTooltipData(row) {
  const payload = buildMarketTooltipPayload(row);
  return encodeURIComponent(JSON.stringify(payload));
}

export function parseMarketTooltipData(value) {
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

export function buildMarketTooltipMarkup(payload) {
  if (!payload) {
    return "";
  }

  if (payload.state === "matched") {
    const segmentMarkup = buildMarketUtilizationSegmentMarkup(payload.marketSegments);
    const stats = [
      ["Vast Utilisation", formatPercentOrDash(payload.marketUtilisationPct)],
      ["Total GPUs", formatIntegerOrDash(payload.marketGpusOnPlatform)],
      ["GPUs Available", formatIntegerOrDash(payload.marketGpusAvailable)],
      ["GPUs Rented", formatIntegerOrDash(payload.marketGpusRented)],
      ["Machines Available", formatIntegerOrDash(payload.marketMachinesAvailable)],
      ["Median Price", formatPriceOrDash(payload.marketMedianPrice)],
      ["Minimum Price", formatPriceOrDash(payload.marketMinimumPrice)],
      ["10th Percentile", formatPriceOrDash(payload.marketP10Price)],
      ["90th Percentile", formatPriceOrDash(payload.marketP90Price)]
    ];

    return `<div class="market-tooltip-card">
      <div class="market-tooltip-title">${escapeHtml(payload.gpuType || "Vast Benchmark")}</div>
      <div class="market-tooltip-subtitle">Current Vast platform stats</div>
      <div class="market-tooltip-grid">
        ${stats.map(([label, value]) => `
          <div class="market-tooltip-label">${escapeHtml(label)}</div>
          <div class="market-tooltip-value">${escapeHtml(value)}</div>
        `).join("")}
      </div>
      ${segmentMarkup}
    </div>`;
  }

  return `<div class="market-tooltip-card">
    <div class="market-tooltip-title">${escapeHtml(payload.gpuType || "Vast Benchmark")}</div>
    <div class="market-tooltip-note">${escapeHtml(payload.message || "No Vast benchmark available")}</div>
  </div>`;
}

function buildMarketTooltipPayload(row) {
  const gpuType = String(row?.gpu_type || "").trim();
  const marketUtilisationPct = toFiniteNumberOrNull(row?.market_utilisation_pct);
  if (marketUtilisationPct != null) {
    return {
      state: "matched",
      gpuType,
      marketUtilisationPct,
      marketGpusOnPlatform: toFiniteNumberOrNull(row?.market_gpus_on_platform),
      marketGpusAvailable: toFiniteNumberOrNull(row?.market_gpus_available),
      marketGpusRented: toFiniteNumberOrNull(row?.market_gpus_rented),
      marketMachinesAvailable: toFiniteNumberOrNull(row?.market_machines_available),
      marketMedianPrice: toFiniteNumberOrNull(row?.market_median_price),
      marketMinimumPrice: toFiniteNumberOrNull(row?.market_minimum_price),
      marketP10Price: toFiniteNumberOrNull(row?.market_p10_price),
      marketP90Price: toFiniteNumberOrNull(row?.market_p90_price),
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
    message: `No current Vast platform benchmark available for ${gpuType || "this GPU type"}`
  };
}

function toFiniteNumberOrNull(value) {
  if (value == null) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatIntegerOrDash(value) {
  return value == null ? "—" : `${Math.round(value)}`;
}

function formatPriceOrDash(value) {
  return value == null ? "—" : `${formatCurrency(value)}/hr`;
}

function formatPercentOrDash(value) {
  return value == null ? "—" : `${value}%`;
}

function buildMarketUtilizationSegmentMarkup(segments) {
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
            <th>Util</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          ${segments.map((segment) => `
            <tr>
              <td>${escapeHtml(segment.segmentLabel)}</td>
              <td>${escapeHtml(formatPercentOrDash(segment.marketUtilisationPct))}</td>
              <td>${escapeHtml(formatIntegerOrDash(segment.marketGpusOnPlatform))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}
