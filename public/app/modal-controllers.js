import { escapeHtml, formatDateWindow, formatReportTimestamp } from "./formatters.js";
import { buildDependencyFailureMessage, hasLocalEstimatedEarningsHistory } from "./machine-modal.js";

export function createMachineModalController({
  elements,
  getMachines,
  getMachineHistoryHours,
  getCurrentMachineHistoryId,
  getCurrentModalTab,
  setCurrentMachineHistoryId,
  setCurrentModalMachine,
  setCurrentModalHistory,
  setCurrentModalEarningsData,
  setModalTab,
  renderModalHeader,
  renderModalSummary,
  renderModalEarningsBreakdown,
  updateModalEarningsPresentation,
  renderModalTimeline,
  updateModalEarningsSummary,
  clearChartSyncGroup,
  drawRenterChart,
  drawReliabilityChart,
  drawPriceChart,
  drawGpuCountChart,
  drawMachineEarningsChart,
  formatMaintenanceWindows,
  getSortedMachines
}) {
  async function showMachineHistory(machineId, options = {}) {
    const { preserveScroll = false } = options;
    const modalBody = elements.modalBackdrop.querySelector(".modal-body");
    setCurrentMachineHistoryId(machineId);
    setCurrentModalMachine(null);
    setCurrentModalHistory([]);
    setCurrentModalEarningsData(null);
    setModalTab(preserveScroll ? getCurrentModalTab() : "charts");
    renderModalHeader(machineId);
    elements.modalStats.textContent = "Loading machine history...";
    setLoadingState(elements.modalStats, true);
    elements.modalSummary.innerHTML = "";
    elements.modalEarningsBreakdown.innerHTML = "";
    elements.modalEarningsStatus.innerHTML = "";
    elements.modalEarningsStatus.classList.add("hidden");
    showLoadingNotice(elements.modalLiveNote, "Fetching machine history and live earnings...");
    elements.modalTimeline.innerHTML = "";
    elements.modalTimeline.classList.add("hidden");
    elements.modalError.textContent = "";
    elements.modalError.classList.add("hidden");
    elements.modalMaintenance.textContent = "";
    elements.modalMaintenance.classList.add("hidden");
    elements.earningsChartTitle.textContent = "Historical Earnings";
    elements.earningsChartNote.textContent = "";
    elements.renterChart.innerHTML = "";
    elements.reliabilityChart.innerHTML = "";
    elements.priceChart.innerHTML = "";
    elements.gpuCountChart.innerHTML = "";
    elements.earningsChart.innerHTML = "";
    clearChartSyncGroup("machine-modal");
    elements.modalBackdrop.classList.remove("hidden");
    updateModalNavigation();
    const previousScrollTop = preserveScroll ? modalBody?.scrollTop ?? 0 : 0;

    try {
      const historyHours = getMachineHistoryHours();
      const [historyResponse, earningsResponse, monthlySummaryResponse] = await Promise.all([
        fetch(`/api/history?machine_id=${machineId}&hours=${historyHours}`),
        fetch(`/api/earnings/machine?machine_id=${machineId}&hours=${historyHours}`),
        fetch(`/api/earnings/machine/monthly-summary?machine_id=${machineId}`)
      ]);
      if (!historyResponse.ok) {
        throw new Error(`History request failed (${historyResponse.status})`);
      }
      const data = await historyResponse.json();
      const earningsData = await earningsResponse.json().catch(() => ({ days: [], total: null }));
      const monthlySummary = await monthlySummaryResponse.json().catch(() => ({ months: [] }));

      const machine = getMachines().find((m) => m.machine_id === machineId);
      const currentModalHistory = Array.isArray(data.history) ? data.history : [];
      setCurrentModalMachine(machine ?? null);
      setCurrentModalHistory(currentModalHistory);
      setCurrentModalEarningsData(earningsData);
      setLoadingState(elements.modalStats, false);

      renderModalLiveDependencyState(elements.modalLiveNote, earningsResponse.ok ? earningsData : {
        error: earningsData?.error || "failed to fetch machine earnings",
        detail: earningsData?.detail || `Request failed (${earningsResponse.status})`,
        dependency: earningsData?.dependency || null
      }, currentModalHistory);
      renderModalHeader(machineId, machine);
      if (machine) {
        renderModalSummary(machine);
      }
      renderModalEarningsBreakdown(earningsData);
      updateModalEarningsPresentation(earningsData);
      if (machine && machine.error_message) {
        elements.modalError.textContent = machine.error_message;
        elements.modalError.classList.remove("hidden");
      }
      if (machine && Array.isArray(machine.machine_maintenance) && machine.machine_maintenance.length > 0) {
        elements.modalMaintenance.textContent = formatMaintenanceWindows(machine.machine_maintenance);
        elements.modalMaintenance.classList.remove("hidden");
      }

      if (!data.history || data.history.length === 0) {
        elements.modalStats.textContent = "No history available.";
        if (preserveScroll && modalBody) {
          modalBody.scrollTop = previousScrollTop;
        }
        return;
      }

      const history = data.history;
      renderModalTimeline(history);
      const current = history[history.length - 1];

      if (current.current_rentals_running > 0) {
        let since = current.polled_at;
        for (let i = history.length - 2; i >= 0; i--) {
          if (history[i].current_rentals_running !== current.current_rentals_running) {
            break;
          }
          since = history[i].polled_at;
        }
        elements.modalStats.textContent = `${current.current_rentals_running} renter(s) since ${new Date(since).toLocaleString()}`;
      } else {
        elements.modalStats.textContent = "No current renters.";
      }

      drawRenterChart(elements.renterChart, history);
      drawReliabilityChart(elements.reliabilityChart, history);
      drawPriceChart(elements.priceChart, history);
      drawGpuCountChart(elements.gpuCountChart, history);
      drawMachineEarningsChart(elements.earningsChart, earningsData, history);
      renderModalEarningsStatus(elements.modalEarningsStatus, earningsData, monthlySummaryResponse.ok ? monthlySummary : null, earningsResponse.ok);
      updateModalEarningsSummary(
        machine,
        earningsData,
        history,
        monthlySummaryResponse.ok ? monthlySummary : null
      );
      if (preserveScroll && modalBody) {
        modalBody.scrollTop = previousScrollTop;
      }
    } catch (error) {
      console.error(error);
      elements.modalStats.textContent = "Failed to load history.";
      setLoadingState(elements.modalStats, false);
      elements.modalLiveNote.textContent = "";
      elements.modalLiveNote.classList.add("hidden");
      elements.modalLiveNote.classList.remove("loading-state");
      elements.modalError.textContent = error instanceof Error ? error.message : String(error);
      elements.modalError.classList.remove("hidden");
    }
  }

  function updateModalNavigation() {
    if (!elements.modalPrev || !elements.modalNext) {
      return;
    }

    const sorted = getSortedMachines();
    const index = sorted.findIndex((row) => row.machine_id === getCurrentMachineHistoryId());
    const canGoPrev = index > 0;
    const canGoNext = index >= 0 && index < sorted.length - 1;

    elements.modalPrev.disabled = !canGoPrev;
    elements.modalNext.disabled = !canGoNext;
  }

  function navigateMachineHistory(direction) {
    const sorted = getSortedMachines();
    const index = sorted.findIndex((row) => row.machine_id === getCurrentMachineHistoryId());
    if (index === -1) {
      return;
    }

    const nextMachine = sorted[index + direction];
    if (!nextMachine) {
      return;
    }

    showMachineHistory(nextMachine.machine_id).catch((error) => console.error(error));
  }

  return {
    showMachineHistory,
    updateModalNavigation,
    navigateMachineHistory
  };
}

export function createReportsController({
  elements,
  getMachines,
  getCurrentReports,
  setCurrentReports,
  getCurrentReportIndex,
  setCurrentReportIndex
}) {
  async function showMachineReports(machineId) {
    elements.reportsModalTitle.textContent = `#${machineId}:`;
    elements.reportsModalCounter.textContent = "Loading...";
    setLoadingState(elements.reportsModalCounter, true);
    elements.reportsProblem.textContent = "";
    elements.reportsTime.textContent = "";
    showLoadingNotice(elements.reportsLiveNote, "Fetching live reports from Vast...");
    elements.reportsMessage.textContent = "Loading report details...";
    setLoadingState(elements.reportsMessage, true);
    elements.reportsModalBackdrop.classList.remove("hidden");
    elements.reportsPrevButton.disabled = true;
    elements.reportsNextButton.disabled = true;
    elements.reportsNextButton.focus();

    let response;
    let data;
    try {
      response = await fetch(`/api/reports?machine_id=${machineId}`);
      data = await response.json();
    } catch (error) {
      elements.reportsModalCounter.textContent = "Live fetch failed";
      setLoadingState(elements.reportsModalCounter, false);
      elements.reportsProblem.textContent = "Unable to load reports";
      elements.reportsLiveNote.textContent = error instanceof Error ? error.message : String(error);
      elements.reportsLiveNote.classList.remove("hidden");
      elements.reportsLiveNote.classList.remove("loading-state");
      setLoadingState(elements.reportsMessage, false);
      elements.reportsMessage.textContent = "Live report fetch failed.";
      elements.reportsPrevButton.disabled = true;
      elements.reportsNextButton.disabled = true;
      return;
    }

    if (!response.ok) {
      elements.reportsModalCounter.textContent = "Live fetch failed";
      setLoadingState(elements.reportsModalCounter, false);
      elements.reportsProblem.textContent = "Unable to load reports";
      elements.reportsLiveNote.textContent = buildDependencyFailureMessage(data, "Reports are fetched live from the Vast CLI.");
      elements.reportsLiveNote.classList.remove("hidden");
      elements.reportsLiveNote.classList.remove("loading-state");
      setLoadingState(elements.reportsMessage, false);
      elements.reportsMessage.textContent = data?.detail || data?.error || "";
      elements.reportsPrevButton.disabled = true;
      elements.reportsNextButton.disabled = true;
      return;
    }

    setCurrentReports(Array.isArray(data.reports) ? data.reports : []);
    setCurrentReportIndex(0);

    if (getCurrentReports().length === 0) {
      elements.reportsModalCounter.textContent = "No reports";
      setLoadingState(elements.reportsModalCounter, false);
      elements.reportsProblem.textContent = "No reports";
      elements.reportsTime.textContent = "";
      elements.reportsLiveNote.textContent = "";
      elements.reportsLiveNote.classList.add("hidden");
      elements.reportsLiveNote.classList.remove("loading-state");
      setLoadingState(elements.reportsMessage, false);
      elements.reportsMessage.textContent = "";
      elements.reportsPrevButton.disabled = true;
      elements.reportsNextButton.disabled = true;
      return;
    }

    renderCurrentReport();
  }

  function renderCurrentReport() {
    const reports = getCurrentReports();
    const report = reports[getCurrentReportIndex()];
    elements.reportsModalCounter.textContent = `${getCurrentReportIndex() + 1} / ${reports.length}`;
    setLoadingState(elements.reportsModalCounter, false);
    elements.reportsProblem.textContent = report.problem || "Unknown";
    elements.reportsTime.textContent = report.created_at
      ? formatReportTimestamp(report.created_at)
      : "";
    elements.reportsLiveNote.textContent = "";
    elements.reportsLiveNote.classList.add("hidden");
    elements.reportsLiveNote.classList.remove("loading-state");
    setLoadingState(elements.reportsMessage, false);
    elements.reportsMessage.textContent = report.message || "(no message)";
    elements.reportsPrevButton.disabled = getCurrentReportIndex() === 0;
    elements.reportsNextButton.disabled = getCurrentReportIndex() >= reports.length - 1;
  }

  function hasReports(machineId) {
    const machine = getMachines().find((row) => row.machine_id === machineId);
    return Boolean(machine && (machine.num_reports || 0) > 0);
  }

  function getReportTriggerFromEventTarget(target) {
    return target instanceof Element ? target.closest("[data-report-trigger='1']") : null;
  }

  return {
    showMachineReports,
    renderCurrentReport,
    hasReports,
    getReportTriggerFromEventTarget
  };
}

function renderModalLiveDependencyState(modalLiveNote, earningsData, machineHistory = []) {
  modalLiveNote.classList.remove("loading-state");
  if (hasLocalEstimatedEarningsHistory(machineHistory)) {
    modalLiveNote.textContent = "";
    modalLiveNote.classList.add("hidden");
    return;
  }

  if (earningsData?.dependency?.ok === false || earningsData?.error) {
    modalLiveNote.textContent = buildDependencyFailureMessage(
      earningsData,
      "Historical snapshots are still available, but live earnings data from the Vast CLI is unavailable."
    );
    modalLiveNote.classList.remove("hidden");
    return;
  }

  modalLiveNote.textContent = "";
  modalLiveNote.classList.add("hidden");
}

function renderModalEarningsStatus(modalEarningsStatus, earningsData, monthlySummary, liveEarningsOk) {
  if (!modalEarningsStatus) {
    return;
  }

  const chartSource = earningsData?.source === "estimated"
    ? "Chart source: local machine earn/day history"
    : `Chart source: Vast CLI daily earnings (${formatDateWindow(earningsData?.start, earningsData?.end)})`;
  const realizedMonths = Array.isArray(monthlySummary?.months) ? monthlySummary.months.filter((month) => Number.isFinite(Number(month.total))) : [];
  const monthSource = realizedMonths.length > 0
    ? "Month cards: realized via Vast CLI per_machine totals"
    : "Month cards: estimated fallback or unavailable";
  const currentMonth = realizedMonths.find((month) => month.key === "current");
  const compareWindow = currentMonth?.comparison_start && currentMonth?.comparison_end
    ? `Current compare window: ${formatDateWindow(currentMonth.start, currentMonth.end)} vs ${formatDateWindow(currentMonth.comparison_start, currentMonth.comparison_end)}`
    : "";
  const badge = liveEarningsOk ? ["Healthy", "healthy"] : ["Degraded", "degraded"];

  modalEarningsStatus.innerHTML = `
    <div class="earnings-status-head">
      <span class="summary-badge ${badge[1]}">${badge[0]}</span>
      <strong>Live Earnings</strong>
    </div>
    <div class="earnings-status-line">${escapeHtml(monthSource)}</div>
    <div class="earnings-status-line">${escapeHtml(chartSource)}</div>
    ${compareWindow ? `<div class="earnings-status-line">${escapeHtml(compareWindow)}</div>` : ""}
  `;
  modalEarningsStatus.classList.remove("hidden");
}

function setLoadingState(element, isLoading) {
  if (!element) {
    return;
  }

  if (isLoading) {
    element.classList.add("loading-state");
  } else {
    element.classList.remove("loading-state");
  }
}

function showLoadingNotice(element, message) {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.add("loading-state");
}
