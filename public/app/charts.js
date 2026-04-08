import {
  escapeHtml,
  formatChartTimestamp,
  formatCurrency,
  getPriceChangePoints
} from "./formatters.js";

const chartSyncGroups = new Map();

export function normalizeGpuTypePriceHistory(payload) {
  const palette = ["#34d399", "#60a5fa", "#f59e0b", "#f43f5e", "#a78bfa", "#f97316"];
  const rowsByBucket = new Map();
  const series = Array.isArray(payload?.series) ? payload.series : [];

  series.forEach((item, index) => {
    const key = `gpu_type_price_${index}`;
    item.points.forEach((point) => {
      const row = rowsByBucket.get(point.bucket_start) || { polled_at: point.bucket_start };
      row[key] = point.avg_price;
      rowsByBucket.set(point.bucket_start, row);
    });
  });

  const history = [...rowsByBucket.values()].sort((a, b) => Date.parse(a.polled_at) - Date.parse(b.polled_at));
  const chartSeries = series.map((item, index) => ({
    key: `gpu_type_price_${index}`,
    label: item.gpu_type,
    color: palette[index % palette.length]
  }));

  return { history, series: chartSeries };
}

export function normalizeGpuTypeUtilizationHistory(payload) {
  const historyRows = Array.isArray(payload?.history) ? payload.history : [];
  const gpuTypeSeries = Array.isArray(payload?.gpu_type_utilization) ? payload.gpu_type_utilization : [];
  const rowsByTimestamp = new Map(
    historyRows.map((row) => [row.polled_at, { polled_at: row.polled_at, utilisation_pct: row.utilisation_pct }])
  );
  const palette = ["#34d399", "#60a5fa", "#f59e0b", "#a78bfa", "#f97316"];

  gpuTypeSeries.forEach((series, index) => {
    const key = `gpu_type_util_${index}`;
    series.points.forEach((point) => {
      const row = rowsByTimestamp.get(point.polled_at) || { polled_at: point.polled_at };
      row[key] = point.utilisation_pct;
      rowsByTimestamp.set(point.polled_at, row);
    });
  });

  const history = [...rowsByTimestamp.values()].sort((a, b) => Date.parse(a.polled_at) - Date.parse(b.polled_at));
  const series = [
    { key: "__fleet__", sourceKey: "utilisation_pct", label: "Total fleet", color: "#f43f5e" },
    ...gpuTypeSeries.map((item, index) => ({
      key: `gpu_type_util_${index}`,
      label: item.gpu_type,
      sourceKey: `gpu_type_util_${index}`,
      color: palette[index % palette.length]
    }))
  ];

  return { history, series };
}

export function syncUtilizationSelector(selectEl, utilizationHistory, selectedKey) {
  if (!selectEl) {
    return selectedKey;
  }

  const series = Array.isArray(utilizationHistory?.series) ? utilizationHistory.series : [];
  const availableKeys = new Set(series.map((item) => item.key));
  const nextSelectedKey = availableKeys.has(selectedKey) ? selectedKey : "__fleet__";

  selectEl.innerHTML = series
    .map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`)
    .join("");

  selectEl.value = nextSelectedKey;
  return nextSelectedKey;
}

export function resolveUtilizationBenchmarkLine({
  selectedSeries,
  summary,
  breakdownRows,
  marketBenchmark
}) {
  if (!selectedSeries) {
    return null;
  }

  const label = marketBenchmark?.stale ? "Vast cached" : "Vast now";
  if (selectedSeries.key === "__fleet__") {
    const value = Number(summary?.marketUtilisationPct);
    if (!Number.isFinite(value)) {
      return null;
    }

    return {
      value,
      label,
      color: "#94a3b8",
      dashed: true
    };
  }

  const matchingRow = (Array.isArray(breakdownRows) ? breakdownRows : [])
    .find((row) => row?.gpu_type === selectedSeries.label);
  const value = matchingRow?.market_utilisation_pct == null ? NaN : Number(matchingRow.market_utilisation_pct);
  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    value,
    label,
    color: "#94a3b8",
    dashed: true
  };
}

export function drawMultiSeriesChart(svg, history, series, options = {}) {
  const width = 720;
  const height = 180;
  const padding = { top: 18, right: 16, bottom: 24, left: 34 };

  if (!history.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">No data yet</text>`;
    return;
  }

  const points = history
    .map((row) => ({ ...row, timeMs: Date.parse(row.polled_at) }))
    .filter((row) => Number.isFinite(row.timeMs));

  if (!points.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">No data yet</text>`;
    return;
  }

  const minTime = points[0].timeMs;
  const maxTime = points[points.length - 1].timeMs;
  const timeSpan = Math.max(1, maxTime - minTime);
  const values = points.flatMap((row) => series
    .map((item) => Number(row[item.sourceKey || item.key]))
    .filter((value) => Number.isFinite(value)));
  const minValue = options.min ?? 0;
  const maxValue = options.max ?? Math.max(1, ...values);
  const valueSpan = Math.max(1, maxValue - minValue);
  const scaleX = (timeMs) => padding.left + ((timeMs - minTime) / timeSpan) * (width - padding.left - padding.right);
  const scaleY = (value) => height - padding.bottom - ((value - minValue) / valueSpan) * (height - padding.top - padding.bottom);

  const tickCount = 4;
  let svgContent = "";

  for (let index = 0; index <= tickCount; index += 1) {
    const value = minValue + (valueSpan * index) / tickCount;
    const y = scaleY(value);
    svgContent += `<g class="trend-axis">
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />
      <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(options.formatValue ? options.formatValue(value) : value.toFixed(0))}</text>
    </g>`;
  }

  for (const item of series) {
    const valueKey = item.sourceKey || item.key;
    const seriesPoints = points.filter((row) => Number.isFinite(Number(row[valueKey])));
    if (!seriesPoints.length) {
      continue;
    }
    const path = buildLinePath(
      seriesPoints,
      (row) => scaleX(row.timeMs),
      (row) => scaleY(Number(row[valueKey]))
    );

    svgContent += `<path d="${path}" class="trend-line" style="stroke:${item.color};stroke-dasharray:${item.dashed ? "6 4" : "none"}" />`;
  }

  const benchmarkLine = options.benchmarkLine;
  if (Number.isFinite(benchmarkLine?.value)) {
    const y = scaleY(Number(benchmarkLine.value));
    svgContent += `<g class="trend-benchmark">
      <line
        x1="${padding.left}"
        y1="${y}"
        x2="${width - padding.right}"
        y2="${y}"
        class="trend-line trend-line-benchmark"
        style="stroke:${benchmarkLine.color || "#94a3b8"};stroke-dasharray:${benchmarkLine.dashed ? "6 4" : "none"}"
      />
      <text x="${width - padding.right}" y="${Math.max(padding.top + 12, y - 6)}" text-anchor="end">${escapeHtml(benchmarkLine.label || "Benchmark")}</text>
    </g>`;
  }

  const startLabel = new Date(minTime).toLocaleDateString();
  const endLabel = new Date(maxTime).toLocaleDateString();
  svgContent += `<g class="trend-axis">
    <text x="${padding.left}" y="${height - 4}" text-anchor="start">${escapeHtml(startLabel)}</text>
    <text x="${width - padding.right}" y="${height - 4}" text-anchor="end">${escapeHtml(endLabel)}</text>
  </g>`;

  const legendItems = [
    ...series.map((item) => ({ label: item.label, color: item.color, dashed: item.dashed === true })),
    ...(Number.isFinite(benchmarkLine?.value)
      ? [{ label: benchmarkLine.label || "Benchmark", color: benchmarkLine.color || "#94a3b8", dashed: benchmarkLine.dashed === true }]
      : [])
  ];

  svgContent += `<g class="trend-legend">`;
  legendItems.forEach((item, index) => {
    const x = padding.left + (index * 150);
    svgContent += `<g transform="translate(${x}, 10)">
      <rect x="0" y="-8" width="14" height="3" rx="2" fill="${item.color}" ${item.dashed ? `stroke="${item.color}" stroke-dasharray="4 2"` : ""} />
      <text x="20" y="-4">${escapeHtml(item.label)}</text>
    </g>`;
  });
  svgContent += `</g>`;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = svgContent;
  attachChartHover(svg, {
    width,
    height,
    padding,
    points,
    scaleX: (row) => scaleX(row.timeMs),
    series: series.map((item) => ({
      label: item.label,
      color: item.color,
      getValue: (row) => {
        const value = Number(row[item.sourceKey || item.key]);
        return Number.isFinite(value) ? value : null;
      },
      getY: (row) => {
        const value = Number(row[item.sourceKey || item.key]);
        return Number.isFinite(value) ? scaleY(value) : null;
      },
      formatValue: (value) => options.formatValue ? options.formatValue(value) : value.toFixed(0)
    }))
  });
}

export function drawRenterChart(svg, history) {
  drawSingleSeriesChart(svg, {
    history,
    key: "current_rentals_running",
    label: "Renters",
    color: "#60a5fa",
    width: svg.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 30 },
    min: 0,
    max: Math.max(1, ...history.map((row) => row.current_rentals_running || 0)),
    tickCount: Math.min(Math.max(1, Math.max(...history.map((row) => row.current_rentals_running || 0))), 5),
    stepped: true,
    fillArea: true,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => `${Math.round(value)}`,
    formatHoverValue: (value) => `${Math.round(value)} renter${Math.round(value) === 1 ? "" : "s"}`
  });
}

export function drawReliabilityChart(svg, history) {
  drawSingleSeriesChart(svg, {
    history,
    key: "reliability",
    label: "Reliability",
    color: "#f59e0b",
    width: svg.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 40 },
    min: 60,
    max: 100,
    tickCount: 4,
    valueTransform: (value) => typeof value === "number" ? value * 100 : null,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => `${Math.round(value)}%`,
    formatHoverValue: (value) => `${value.toFixed(1)}%`,
    emptyMessage: "No reliability history yet"
  });
}

export function drawPriceChart(svg, history) {
  const changePoints = getPriceChangePoints(history);
  drawSingleSeriesChart(svg, {
    history,
    key: "listed_gpu_cost",
    label: "Price",
    color: "#34d399",
    width: svg.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 52 },
    tickCount: 4,
    valueTransform: (value) => typeof value === "number" ? value : null,
    formatAxisValue: (value) => formatCurrency(value),
    formatHoverValue: (value) => `${formatCurrency(value)} / GPU`,
    emptyMessage: "No price history yet",
    autoPadRange: true,
    syncGroup: "machine-modal",
    annotationPoints: changePoints,
    formatAnnotation: (point) => formatCurrency(point.value)
  });
}

export function drawGpuCountChart(svg, history) {
  drawSingleSeriesChart(svg, {
    history,
    key: "num_gpus",
    label: "GPUs",
    color: "#a78bfa",
    width: svg.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 30 },
    min: 0,
    max: Math.max(1, ...history.map((row) => row.num_gpus || 0)),
    tickCount: Math.min(Math.max(1, Math.max(...history.map((row) => row.num_gpus || 0))), 6),
    stepped: true,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => `${Math.round(value)}`,
    formatHoverValue: (value) => `${Math.round(value)} GPU${Math.round(value) === 1 ? "" : "s"}`,
    emptyMessage: "No GPU count history yet"
  });
}

export function drawMachineEarningsChart(svg, earningsData, machineHistory = []) {
  const apiHistory = Array.isArray(earningsData?.days)
    ? earningsData.days.map((row) => ({
      polled_at: row.day,
      earnings: row.earnings
    }))
    : [];
  const estimatedHistory = Array.isArray(machineHistory)
    ? machineHistory
      .map((row) => ({
        polled_at: row.polled_at,
        earn_day: typeof row.earn_day === "number" ? row.earn_day : null
      }))
      .filter((row) => row.earn_day != null)
    : [];

  if (estimatedHistory.length > 0) {
    earningsData.source = "estimated";
    drawSingleSeriesChart(svg, {
      history: estimatedHistory,
      key: "earn_day",
      label: "Earn/day",
      color: "#22c55e",
      width: svg.clientWidth || 600,
      height: 200,
      padding: { top: 20, right: 20, bottom: 30, left: 56 },
      min: 0,
      tickCount: 4,
      valueTransform: (value) => typeof value === "number" ? value : null,
      syncGroup: "machine-modal",
      formatAxisValue: (value) => formatCurrency(value),
      formatHoverValue: (value) => `${formatCurrency(value)} / day`,
      emptyMessage: "No earnings history yet",
      autoPadRange: true,
      fillArea: true
    });
    return;
  }

  if (apiHistory.length > 0) {
    earningsData.source = "realized";
    drawSingleSeriesChart(svg, {
      history: apiHistory,
      key: "earnings",
      label: "Earnings",
      color: "#22c55e",
      width: svg.clientWidth || 600,
      height: 200,
      padding: { top: 20, right: 20, bottom: 30, left: 56 },
      min: 0,
      tickCount: 4,
      valueTransform: (value) => typeof value === "number" ? value : null,
      syncGroup: "machine-modal",
      formatAxisValue: (value) => formatCurrency(value),
      formatHoverValue: (value) => `${formatCurrency(value)} earned`,
      emptyMessage: "No earnings history yet",
      autoPadRange: true,
      fillArea: true
    });
    return;
  }

  earningsData.source = "estimated";
  drawSingleSeriesChart(svg, {
    history: estimatedHistory,
    key: "earn_day",
    label: "Earn/day",
    color: "#22c55e",
    width: svg.clientWidth || 600,
    height: 200,
    padding: { top: 20, right: 20, bottom: 30, left: 56 },
    min: 0,
    tickCount: 4,
    valueTransform: (value) => typeof value === "number" ? value : null,
    syncGroup: "machine-modal",
    formatAxisValue: (value) => formatCurrency(value),
    formatHoverValue: (value) => `${formatCurrency(value)} / day`,
    emptyMessage: "No earnings history yet",
    autoPadRange: true,
    fillArea: true
  });
}

export function clearChartSyncGroup(groupName) {
  const members = chartSyncGroups.get(groupName);
  if (!members) {
    return;
  }

  members.forEach((member) => member.__chartHoverApi?.clearHover());
}

function drawSingleSeriesChart(svg, options) {
  const {
    history,
    key,
    label,
    color,
    width,
    height,
    padding,
    min,
    max,
    tickCount = 4,
    stepped = false,
    fillArea = false,
    valueTransform = (value) => typeof value === "number" ? value : null,
    formatAxisValue = (value) => value.toFixed(0),
    formatHoverValue = formatAxisValue,
    emptyMessage = "No data yet",
    autoPadRange = false,
    syncGroup = null,
    annotationPoints = [],
    formatAnnotation = () => ""
  } = options;

  const points = history
    .map((row) => ({
      ...row,
      timeMs: Date.parse(row.polled_at),
      value: valueTransform(row[key])
    }))
    .filter((row) => Number.isFinite(row.timeMs));

  if (!points.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">No data yet</text>`;
    return;
  }

  const validValues = points
    .map((row) => row.value)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  if (!validValues.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">${emptyMessage}</text>`;
    return;
  }

  const minTime = points[0].timeMs;
  const maxTime = points[points.length - 1].timeMs;
  const timeSpan = Math.max(1, maxTime - minTime);
  let minValue = min ?? Math.min(...validValues);
  let maxValue = max ?? Math.max(...validValues);

  if (autoPadRange && min == null && max == null && minValue === maxValue) {
    const pad = Math.max(Math.abs(minValue) * 0.05, 0.01);
    minValue -= pad;
    maxValue += pad;
  }

  const valueSpan = Math.max(1e-6, maxValue - minValue);
  const scaleX = (timeMs) => padding.left + ((timeMs - minTime) / timeSpan) * (width - padding.left - padding.right);
  const scaleY = (value) => height - padding.bottom - ((value - minValue) / valueSpan) * (height - padding.top - padding.bottom);

  let svgContent = "";
  for (let index = 0; index <= tickCount; index += 1) {
    const value = minValue + (valueSpan * index) / tickCount;
    const y = scaleY(value);
    svgContent += `<g class="chart-axis">
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke-dasharray="2,2" />
      <text x="${padding.left - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(formatAxisValue(value))}</text>
    </g>`;
  }

  if (fillArea) {
    const areaPath = buildAreaPath(
      points,
      (row) => scaleX(row.timeMs),
      (row) => row.value == null ? null : scaleY(row.value),
      scaleY(minValue),
      { stepped }
    );
    if (areaPath) {
      svgContent += `<path d="${areaPath}" class="chart-area" />`;
    }
  }

  const linePath = buildLinePath(
    points,
    (row) => scaleX(row.timeMs),
    (row) => row.value == null ? null : scaleY(row.value),
    { stepped }
  );
  svgContent += `<path d="${linePath}" class="chart-line" style="stroke:${color}" />`;
  svgContent += annotationPoints
    .map((point) => {
      const x = scaleX(point.timeMs);
      const y = scaleY(point.value);
      const labelY = Math.max(padding.top + 12, y - 10);
      return `<g class="chart-annotation">
        <circle class="chart-annotation-dot" cx="${x}" cy="${y}" r="4" />
        <text x="${x}" y="${labelY}" text-anchor="middle">${escapeHtml(formatAnnotation(point))}</text>
      </g>`;
    })
    .join("");
  svgContent += `<g class="chart-axis">
    <text x="${padding.left}" y="${height - 5}" text-anchor="start">${escapeHtml(new Date(minTime).toLocaleDateString())}</text>
    <text x="${width - padding.right}" y="${height - 5}" text-anchor="end">${escapeHtml(new Date(maxTime).toLocaleDateString())}</text>
  </g>`;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = svgContent;
  attachChartHover(svg, {
    width,
    height,
    padding,
    points,
    scaleX: (row) => scaleX(row.timeMs),
    syncGroup,
    series: [
      {
        label,
        color,
        getValue: (row) => row.value,
        getY: (row) => row.value == null ? null : scaleY(row.value),
        formatValue: formatHoverValue
      }
    ]
  });
}

function buildLinePath(points, getX, getY, options = {}) {
  const { stepped = false } = options;
  let path = "";
  let previousY = null;
  let started = false;

  for (const point of points) {
    const x = getX(point);
    const y = getY(point);
    if (y == null) {
      started = false;
      previousY = null;
      continue;
    }

    if (!started) {
      path += `${path ? " " : ""}M ${x} ${y}`;
      started = true;
    } else if (stepped) {
      path += ` L ${x} ${previousY} L ${x} ${y}`;
    } else {
      path += ` L ${x} ${y}`;
    }

    previousY = y;
  }

  return path;
}

function buildAreaPath(points, getX, getY, baselineY, options = {}) {
  const { stepped = false } = options;
  const validPoints = points
    .map((point) => ({ x: getX(point), y: getY(point) }))
    .filter((point) => point.y != null);

  if (!validPoints.length) {
    return "";
  }

  let path = `M ${validPoints[0].x} ${baselineY} L ${validPoints[0].x} ${validPoints[0].y}`;
  for (let index = 1; index < validPoints.length; index += 1) {
    const point = validPoints[index];
    const previous = validPoints[index - 1];
    if (stepped) {
      path += ` L ${point.x} ${previous.y} L ${point.x} ${point.y}`;
    } else {
      path += ` L ${point.x} ${point.y}`;
    }
  }

  const last = validPoints[validPoints.length - 1];
  path += ` L ${last.x} ${baselineY} Z`;
  return path;
}

function attachChartHover(svg, options) {
  const { width, height, padding, points, scaleX, series, syncGroup } = options;
  if (!points.length || !series.length) {
    return;
  }

  svg.onmousemove = null;
  svg.onmouseleave = null;

  const left = padding.left;
  const right = width - padding.right;
  const top = padding.top;
  const bottom = height - padding.bottom;
  const pointPositions = points.map((point) => scaleX(point));

  const clearHover = () => {
    svg.querySelector(".chart-hover-layer")?.remove();
  };

  const renderHover = (index) => {
    clearHover();

    const point = points[index];
    if (!point) {
      return;
    }

    const x = pointPositions[index];
    const values = series
      .map((item) => {
        const value = item.getValue(point);
        if (value == null || !Number.isFinite(value)) {
          return null;
        }

        return {
          label: item.label,
          color: item.color,
          valueText: item.formatValue ? item.formatValue(value, point) : `${value}`,
          y: item.getY ? item.getY(point) : null
        };
      })
      .filter(Boolean);

    if (!values.length) {
      return;
    }

    const tooltipWidth = 172;
    const tooltipHeight = 18 + ((values.length + 1) * 16);
    const tooltipX = x > width / 2
      ? Math.max(left, x - tooltipWidth - 10)
      : Math.min(right - tooltipWidth, x + 10);
    const tooltipY = Math.max(top, Math.min(bottom - tooltipHeight, top + 6));

    const markers = values
      .filter((entry) => entry.y != null)
      .map((entry) => `<circle class="chart-hover-dot" cx="${x}" cy="${entry.y}" r="4" fill="${entry.color}" />`)
      .join("");
    const valueLines = values
      .map((entry, lineIndex) => {
        const y = tooltipY + 32 + (lineIndex * 16);
        return `<text x="${tooltipX + 10}" y="${y}" class="chart-tooltip-value">
          <tspan fill="${entry.color}">${escapeHtml(entry.label)}:</tspan>
          <tspan dx="6">${escapeHtml(entry.valueText)}</tspan>
        </text>`;
      })
      .join("");

    svg.innerHTML += `<g class="chart-hover-layer">
      <line class="chart-crosshair" x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" />
      ${markers}
      <rect class="chart-tooltip-box" x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="10" />
      <text x="${tooltipX + 10}" y="${tooltipY + 16}" class="chart-tooltip-time">${escapeHtml(formatChartTimestamp(point.polled_at))}</text>
      ${valueLines}
    </g>`;
  };

  const renderHoverForTime = (timeMs) => {
    if (!Number.isFinite(timeMs)) {
      clearHover();
      return;
    }

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const distance = Math.abs(points[index].timeMs - timeMs);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    renderHover(nearestIndex);
  };

  svg.__chartHoverApi = {
    renderHoverForTime,
    clearHover
  };

  if (syncGroup) {
    const members = chartSyncGroups.get(syncGroup) || new Set();
    members.add(svg);
    chartSyncGroups.set(syncGroup, members);
  }

  svg.onmouseleave = () => {
    if (syncGroup) {
      clearChartSyncGroup(syncGroup);
      return;
    }
    clearHover();
  };
  svg.onmousemove = (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) {
      return;
    }

    const x = ((event.clientX - rect.left) / rect.width) * width;
    const clampedX = Math.max(left, Math.min(right, x));
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < pointPositions.length; index += 1) {
      const distance = Math.abs(pointPositions[index] - clampedX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }

    if (!syncGroup) {
      renderHover(nearestIndex);
      return;
    }

    const timeMs = points[nearestIndex]?.timeMs;
    const members = chartSyncGroups.get(syncGroup) || [];
    members.forEach((member) => member.__chartHoverApi?.renderHoverForTime(timeMs));
  };
}
