export function createDashboardController({
  getSelectedEarningsDate,
  getSelectedTrendHours,
  fetchDashboardPayload,
  renderDashboardNotice,
  applyStatusPayload,
  applyFleetHistoryPayload,
  applyGpuTypePricePayload,
  applyHourlyEarningsPayload,
  applyAlertsPayload,
  renderFleetHistoryUnavailable,
  renderGpuTypePriceUnavailable,
  renderHourlyEarningsUnavailable,
  renderAlertsUnavailable,
  hasFleetHistoryPayload,
  hasGpuTypePricePayload,
  hasHourlyEarningsPayload,
  hasAlertsRendered,
  isMachineModalOpen,
  getCurrentMachineHistoryId,
  refreshCurrentMachineModal,
  handleRefreshFailure,
  setRefreshTimer = (callback, delayMs) => window.setInterval(callback, delayMs)
}) {
  async function refreshDashboard() {
    try {
      const result = await fetchDashboardPayload({
        selectedEarningsDate: getSelectedEarningsDate(),
        selectedTrendHours: getSelectedTrendHours()
      });
      renderDashboardNotice(result.failures);

      if (result.payload.status) {
        applyStatusPayload(result.payload.status);
      }

      if (result.payload.fleetHistory) {
        applyFleetHistoryPayload(result.payload.fleetHistory);
      } else if (!hasFleetHistoryPayload()) {
        renderFleetHistoryUnavailable();
      }

      if (result.payload.gpuTypePrice) {
        applyGpuTypePricePayload(result.payload.gpuTypePrice);
      } else if (!hasGpuTypePricePayload()) {
        renderGpuTypePriceUnavailable();
      }

      if (result.payload.earnings) {
        applyHourlyEarningsPayload(result.payload.earnings);
      } else if (!hasHourlyEarningsPayload()) {
        renderHourlyEarningsUnavailable();
      }

      if (result.payload.alerts) {
        applyAlertsPayload(result.payload.alerts);
      } else if (!hasAlertsRendered()) {
        renderAlertsUnavailable();
      }

      if (isMachineModalOpen() && getCurrentMachineHistoryId() != null) {
        refreshCurrentMachineModal(getCurrentMachineHistoryId());
      }
    } catch (error) {
      handleRefreshFailure(error);
    }
  }

  function startAutoRefresh(intervalMs) {
    return setRefreshTimer(() => {
      refreshDashboard().catch((error) => handleRefreshFailure(error));
    }, intervalMs);
  }

  return {
    refreshDashboard,
    startAutoRefresh
  };
}
