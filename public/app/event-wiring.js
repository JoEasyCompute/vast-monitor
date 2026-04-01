export function bindWindowResize({ onResize, delayMs = 120 }) {
  let resizeRedrawTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeRedrawTimer);
    resizeRedrawTimer = window.setTimeout(() => {
      onResize();
    }, delayMs);
  });
}

export function bindDashboardControls({
  machineViewTabs,
  densityToggle,
  settingsButton,
  settingsBackdrop,
  settingsClose,
  settingsDashboardMode,
  settingsDensity,
  settingsReliability,
  settingsTemperature,
  settingsStaleMinutes,
  settingsAdminToken,
  settingsAdminTokenToggle,
  settingsAdminTokenClear,
  settingsReset,
  trendRange,
  trendUtilGpuSelect,
  breakdownBody,
  activeGpuFilterList,
  filterGpuSelect,
  filterControls,
  filterReset,
  earningsPrevButton,
  earningsNextButton,
  onMachineViewChange,
  onDensityChange,
  onOpenSettings,
  onCloseSettings,
  onSettingsDashboardModeChange,
  onSettingsDensityChange,
  onSettingsReliabilityChange,
  onSettingsTemperatureChange,
  onSettingsStaleMinutesChange,
  onSettingsAdminTokenChange,
  onToggleAdminTokenVisibility,
  onClearAdminToken,
  onSettingsReset,
  onSort,
  onTrendRangeChange,
  onTrendGpuChange,
  onGpuFilterSelect,
  onBreakdownGpuClick,
  onRemoveGpuFilter,
  onFiltersChanged,
  onFilterReset,
  onEarningsPrev,
  onEarningsNext
}) {
  machineViewTabs?.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      onMachineViewChange(button.dataset.tab === "archived" ? "archived" : "active");
    });
  });

  densityToggle.querySelectorAll("[data-density]").forEach((button) => {
    button.addEventListener("click", () => {
      onDensityChange(button.dataset.density === "compact" ? "compact" : "comfortable");
    });
  });

  settingsButton.addEventListener("click", onOpenSettings);
  settingsClose.addEventListener("click", onCloseSettings);
  settingsDashboardMode.addEventListener("change", onSettingsDashboardModeChange);
  settingsDensity.addEventListener("change", onSettingsDensityChange);
  settingsReliability.addEventListener("change", onSettingsReliabilityChange);
  settingsTemperature.addEventListener("change", onSettingsTemperatureChange);
  settingsStaleMinutes.addEventListener("change", onSettingsStaleMinutesChange);
  settingsAdminToken.addEventListener("change", onSettingsAdminTokenChange);
  settingsAdminTokenToggle.addEventListener("click", onToggleAdminTokenVisibility);
  settingsAdminTokenClear.addEventListener("click", onClearAdminToken);
  settingsReset.addEventListener("click", onSettingsReset);

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => onSort(th.dataset.sort));
  });

  trendRange.querySelectorAll("[data-hours]").forEach((button) => {
    button.addEventListener("click", () => {
      onTrendRangeChange(Number(button.dataset.hours) || 168, button);
    });
  });

  trendUtilGpuSelect.addEventListener("change", onTrendGpuChange);
  filterGpuSelect?.addEventListener("change", onGpuFilterSelect);

  breakdownBody?.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target
      : event.target?.parentElement instanceof Element
        ? event.target.parentElement
        : null;
    if (!target) {
      return;
    }

    const gpuButton = target.closest("[data-gpu-filter]");
    if (!gpuButton) {
      return;
    }

    event.preventDefault();
    onBreakdownGpuClick(gpuButton.dataset.gpuFilter || "");
  });

  activeGpuFilterList?.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target
      : event.target?.parentElement instanceof Element
        ? event.target.parentElement
        : null;
    if (!target) {
      return;
    }

    const chip = target.closest("[data-remove-gpu-filter]");
    if (!chip) {
      return;
    }

    event.preventDefault();
    onRemoveGpuFilter(chip.dataset.removeGpuFilter || "");
  });

  filterControls.forEach((control) => {
    control.addEventListener("input", onFiltersChanged);
    control.addEventListener("change", onFiltersChanged);
  });

  filterReset.addEventListener("click", onFilterReset);
  earningsPrevButton.addEventListener("click", onEarningsPrev);
  earningsNextButton.addEventListener("click", onEarningsNext);

  window.addEventListener("click", (event) => {
    if (event.target === settingsBackdrop) {
      onCloseSettings();
    }
  });
}

export function bindModalControls({
  modalBackdrop,
  modalClose,
  modalPrev,
  modalNext,
  modalTabs,
  modalHistoryRange,
  reportsModalBackdrop,
  reportsModalClose,
  reportsPrevButton,
  reportsNextButton,
  onCloseMachineModal,
  onPrevMachine,
  onNextMachine,
  onSetModalTab,
  onModalHistoryRangeChange,
  onCloseReportsModal,
  onPrevReport,
  onNextReport,
  isSettingsOpen,
  closeSettings,
  isMachineModalOpen,
  isReportsModalOpen,
  canGoPrevMachine,
  canGoNextMachine,
  canGoPrevReport,
  canGoNextReport
}) {
  modalClose.addEventListener("click", onCloseMachineModal);
  modalPrev.addEventListener("click", onPrevMachine);
  modalNext.addEventListener("click", onNextMachine);

  modalTabs.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      onSetModalTab(button.dataset.tab || "charts");
    });
  });

  modalHistoryRange.querySelectorAll("[data-hours]").forEach((button) => {
    button.addEventListener("click", () => {
      onModalHistoryRangeChange(Number(button.dataset.hours) || 168, button);
    });
  });

  reportsModalClose.addEventListener("click", onCloseReportsModal);
  reportsPrevButton.addEventListener("click", onPrevReport);
  reportsNextButton.addEventListener("click", onNextReport);

  window.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) {
      onCloseMachineModal();
    }
    if (event.target === reportsModalBackdrop) {
      onCloseReportsModal();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (isSettingsOpen() && event.key === "Escape") {
      event.preventDefault();
      closeSettings();
      return;
    }

    if (isMachineModalOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMachineModal();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (canGoPrevMachine()) {
          onPrevMachine();
        }
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (canGoNextMachine()) {
          onNextMachine();
        }
        return;
      }
    }

    if (!isReportsModalOpen()) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onCloseReportsModal();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (canGoPrevReport()) {
        onPrevReport();
      }
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (canGoNextReport()) {
        onNextReport();
      }
    }
  });
}

export function bindReportGestureHandlers({
  machinesBody,
  onBeginLongPress,
  onCancelLongPress,
  shouldPreventContextMenu
}) {
  machinesBody.addEventListener("pointerdown", (event) => {
    onBeginLongPress(event);
  });

  machinesBody.addEventListener("pointerup", onCancelLongPress);
  machinesBody.addEventListener("pointercancel", onCancelLongPress);
  machinesBody.addEventListener("pointermove", onCancelLongPress);
  machinesBody.addEventListener("pointerleave", onCancelLongPress);

  machinesBody.addEventListener("contextmenu", (event) => {
    if (shouldPreventContextMenu(event)) {
      event.preventDefault();
    }
  });
}

export function bindMachineInteractions({
  machinesBody,
  modalTitle,
  onMachineRowClick,
  onCopyMachineId,
  onCopyIpAddress
}) {
  machinesBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const row = target.closest("[data-machine-row='1']");
    if (!row) {
      return;
    }

    const machineId = Number(row.dataset.machineId);
    if (!Number.isFinite(machineId)) {
      return;
    }

    onMachineRowClick(event, machineId);
  });

  modalTitle.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const machineIdButton = target.closest("[data-copy-machine-id]");
    if (machineIdButton) {
      event.preventDefault();
      event.stopPropagation();
      onCopyMachineId(machineIdButton.dataset.copyMachineId || "", machineIdButton);
      return;
    }

    const ipButton = target.closest("[data-copy-ip-address]");
    if (ipButton) {
      event.preventDefault();
      event.stopPropagation();
      onCopyIpAddress(ipButton.dataset.copyIpAddress || "", ipButton);
    }
  });
}
