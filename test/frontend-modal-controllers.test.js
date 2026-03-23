import test from "node:test";
import assert from "node:assert/strict";

import {
  createMachineModalController,
  createReportsController
} from "../public/app/modal-controllers.js";

test("machine modal controller shows loading state then renders fetched history", async () => {
  const restore = installControllerGlobals();
  try {
    const machine = {
      machine_id: 49697,
      hostname: "alpha",
      gpu_type: "A100",
      num_gpus: 4,
      status: "online",
      machine_maintenance: []
    };
    const elements = createMachineElements();
    const state = {
      currentMachineHistoryId: null,
      currentModalTab: "charts"
    };
    const renderCalls = [];
    const deferredHistory = defer();
    const deferredEarnings = defer();
    const deferredMonthly = defer();
    const fetchCalls = [];

    global.fetch = async (url) => {
      fetchCalls.push(url);
      if (url.includes("/api/history")) return deferredHistory.promise;
      if (url.includes("/api/earnings/machine?")) return deferredEarnings.promise;
      return deferredMonthly.promise;
    };

    const controller = createMachineModalController({
      elements,
      getMachines: () => [machine],
      getMachineHistoryHours: () => 168,
      getCurrentMachineHistoryId: () => state.currentMachineHistoryId,
      getCurrentModalTab: () => state.currentModalTab,
      setCurrentMachineHistoryId: (value) => {
        state.currentMachineHistoryId = value;
      },
      setCurrentModalMachine() {},
      setCurrentModalHistory() {},
      setCurrentModalEarningsData() {},
      setModalTab: (value) => {
        state.currentModalTab = value;
      },
      renderModalHeader: (...args) => renderCalls.push(["header", ...args]),
      renderModalSummary: (value) => renderCalls.push(["summary", value.machine_id]),
      renderModalEarningsBreakdown: () => renderCalls.push(["breakdown"]),
      updateModalEarningsPresentation: () => renderCalls.push(["earnings-presentation"]),
      renderModalTimeline: (history) => {
        elements.modalTimeline.innerHTML = `timeline:${history.length}`;
        elements.modalTimeline.classList.remove("hidden");
      },
      updateModalEarningsSummary: () => renderCalls.push(["earnings-summary"]),
      clearChartSyncGroup: () => renderCalls.push(["clear-sync"]),
      drawRenterChart: () => renderCalls.push(["renter-chart"]),
      drawReliabilityChart: () => renderCalls.push(["reliability-chart"]),
      drawPriceChart: () => renderCalls.push(["price-chart"]),
      drawGpuCountChart: () => renderCalls.push(["gpu-count-chart"]),
      drawMachineEarningsChart: () => renderCalls.push(["earnings-chart"]),
      formatMaintenanceWindows: () => "",
      getSortedMachines: () => [machine]
    });

    const loadPromise = controller.showMachineHistory(49697);

    assert.equal(elements.modalBackdrop.classList.contains("hidden"), false);
    assert.equal(elements.modalStats.textContent, "Loading machine history...");
    assert.equal(elements.modalStats.classList.contains("loading-state"), true);
    assert.equal(elements.modalLiveNote.textContent, "Fetching machine history and live earnings...");
    assert.equal(elements.modalLiveNote.classList.contains("loading-state"), true);

    deferredHistory.resolve(jsonResponse({
      history: [
        { polled_at: "2026-03-23T10:00:00.000Z", current_rentals_running: 2, earn_day: 8, status: "online" },
        { polled_at: "2026-03-23T11:00:00.000Z", current_rentals_running: 2, earn_day: 9, status: "online" }
      ]
    }));
    deferredEarnings.resolve(jsonResponse({
      source: "estimated",
      total: 9,
      start: "2026-03-16T00:00:00.000Z",
      end: "2026-03-23T00:00:00.000Z"
    }));
    deferredMonthly.resolve(jsonResponse({ months: [] }));

    await loadPromise;

    assert.deepEqual(fetchCalls, [
      "/api/history?machine_id=49697&hours=168",
      "/api/earnings/machine?machine_id=49697&hours=168",
      "/api/earnings/machine/monthly-summary?machine_id=49697"
    ]);
    assert.equal(elements.modalStats.classList.contains("loading-state"), false);
    assert.match(elements.modalStats.textContent, /2 renter\(s\) since/);
    assert.equal(elements.modalLiveNote.classList.contains("hidden"), true);
    assert.equal(elements.modalTimeline.innerHTML, "timeline:2");
    assert.deepEqual(renderCalls.slice(0, 2), [
      ["header", 49697],
      ["clear-sync"]
    ]);
    assert.ok(renderCalls.some((entry) => entry[0] === "renter-chart"));
    assert.ok(renderCalls.some((entry) => entry[0] === "earnings-summary"));
  } finally {
    restore();
  }
});

test("machine modal controller surfaces fetch failure details", async () => {
  const restore = installControllerGlobals();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const elements = createMachineElements();
    global.fetch = async (url) => {
      if (url.includes("/api/history")) {
        return {
          ok: false,
          status: 503,
          async json() {
            return {};
          }
        };
      }
      return jsonResponse({});
    };

    const controller = createMachineModalController({
      elements,
      getMachines: () => [],
      getMachineHistoryHours: () => 24,
      getCurrentMachineHistoryId: () => null,
      getCurrentModalTab: () => "charts",
      setCurrentMachineHistoryId() {},
      setCurrentModalMachine() {},
      setCurrentModalHistory() {},
      setCurrentModalEarningsData() {},
      setModalTab() {},
      renderModalHeader() {},
      renderModalSummary() {},
      renderModalEarningsBreakdown() {},
      updateModalEarningsPresentation() {},
      renderModalTimeline() {},
      updateModalEarningsSummary() {},
      clearChartSyncGroup() {},
      drawRenterChart() {},
      drawReliabilityChart() {},
      drawPriceChart() {},
      drawGpuCountChart() {},
      drawMachineEarningsChart() {},
      formatMaintenanceWindows: () => "",
      getSortedMachines: () => []
    });

    await controller.showMachineHistory(1);

    assert.equal(elements.modalStats.textContent, "Failed to load history.");
    assert.equal(elements.modalStats.classList.contains("loading-state"), false);
    assert.equal(elements.modalError.classList.contains("hidden"), false);
    assert.match(elements.modalError.textContent, /History request failed \(503\)/);
  } finally {
    console.error = originalConsoleError;
    restore();
  }
});

test("reports controller shows loading state then renders fetched reports", async () => {
  const restore = installControllerGlobals();
  try {
    const elements = createReportsElements();
    const state = {
      reports: [],
      reportIndex: 0
    };
    const deferredResponse = defer();
    global.fetch = async () => deferredResponse.promise;

    const controller = createReportsController({
      elements,
      getMachines: () => [{ machine_id: 49697, num_reports: 2 }],
      getCurrentReports: () => state.reports,
      setCurrentReports: (value) => {
        state.reports = value;
      },
      getCurrentReportIndex: () => state.reportIndex,
      setCurrentReportIndex: (value) => {
        state.reportIndex = value;
      }
    });

    const loadPromise = controller.showMachineReports(49697);

    assert.equal(elements.reportsModalCounter.textContent, "Loading...");
    assert.equal(elements.reportsModalCounter.classList.contains("loading-state"), true);
    assert.equal(elements.reportsLiveNote.textContent, "Fetching live reports from Vast...");
    assert.equal(elements.reportsLiveNote.classList.contains("loading-state"), true);
    assert.equal(elements.reportsMessage.textContent, "Loading report details...");
    assert.equal(elements.reportsMessage.classList.contains("loading-state"), true);

    deferredResponse.resolve(jsonResponse({
      reports: [
        {
          problem: "Connectivity",
          created_at: "2026-03-23T11:00:00.000Z",
          message: "First report"
        },
        {
          problem: "Cooling",
          created_at: "2026-03-23T12:00:00.000Z",
          message: "Second report"
        }
      ]
    }));

    await loadPromise;

    assert.equal(elements.reportsModalCounter.textContent, "1 / 2");
    assert.equal(elements.reportsModalCounter.classList.contains("loading-state"), false);
    assert.equal(elements.reportsLiveNote.classList.contains("hidden"), true);
    assert.equal(elements.reportsMessage.classList.contains("loading-state"), false);
    assert.equal(elements.reportsProblem.textContent, "Connectivity");
    assert.equal(elements.reportsMessage.textContent, "First report");
    assert.equal(elements.reportsPrevButton.disabled, true);
    assert.equal(elements.reportsNextButton.disabled, false);
  } finally {
    restore();
  }
});

test("reports controller shows degraded message when live reports fail", async () => {
  const restore = installControllerGlobals();
  try {
    const elements = createReportsElements();
    global.fetch = async () => ({
      ok: false,
      status: 502,
      async json() {
        return {
          error: "failed to fetch reports",
          detail: "vast CLI unavailable",
          dependency: {
            health: {
              detail: "CLI binary not found"
            }
          }
        };
      }
    });

    const controller = createReportsController({
      elements,
      getMachines: () => [{ machine_id: 49697, num_reports: 1 }],
      getCurrentReports: () => [],
      setCurrentReports() {},
      getCurrentReportIndex: () => 0,
      setCurrentReportIndex() {}
    });

    await controller.showMachineReports(49697);

    assert.equal(elements.reportsModalCounter.textContent, "Live fetch failed");
    assert.equal(elements.reportsModalCounter.classList.contains("loading-state"), false);
    assert.equal(elements.reportsLiveNote.classList.contains("hidden"), false);
    assert.equal(elements.reportsLiveNote.classList.contains("loading-state"), false);
    assert.match(elements.reportsLiveNote.textContent, /Reports are fetched live from the Vast CLI/);
    assert.equal(elements.reportsMessage.classList.contains("loading-state"), false);
    assert.equal(elements.reportsMessage.textContent, "vast CLI unavailable");
  } finally {
    restore();
  }
});

function createMachineElements() {
  const modalBody = new FakeElement("div");
  modalBody.scrollTop = 0;
  const modalBackdrop = new FakeElement("div");
  modalBackdrop.classList.add("hidden");
  modalBackdrop.querySelector = (selector) => (selector === ".modal-body" ? modalBody : null);

  return {
    modalBackdrop,
    modalStats: new FakeElement("div"),
    modalSummary: new FakeElement("div"),
    modalEarningsBreakdown: new FakeElement("div"),
    modalEarningsStatus: new FakeElement("div"),
    modalLiveNote: new FakeElement("div"),
    modalTimeline: new FakeElement("div"),
    modalError: new FakeElement("div"),
    modalMaintenance: new FakeElement("div"),
    earningsChartTitle: new FakeElement("div"),
    earningsChartNote: new FakeElement("div"),
    renterChart: new FakeElement("svg"),
    reliabilityChart: new FakeElement("svg"),
    priceChart: new FakeElement("svg"),
    gpuCountChart: new FakeElement("svg"),
    earningsChart: new FakeElement("svg"),
    modalPrev: new FakeElement("button"),
    modalNext: new FakeElement("button")
  };
}

function createReportsElements() {
  const reportsModalBackdrop = new FakeElement("div");
  reportsModalBackdrop.classList.add("hidden");
  return {
    reportsModalBackdrop,
    reportsModalTitle: new FakeElement("h2"),
    reportsModalCounter: new FakeElement("span"),
    reportsPrevButton: new FakeElement("button"),
    reportsNextButton: new FakeElement("button"),
    reportsProblem: new FakeElement("div"),
    reportsTime: new FakeElement("div"),
    reportsLiveNote: new FakeElement("div"),
    reportsMessage: new FakeElement("pre")
  };
}

function installControllerGlobals() {
  const previousFetch = global.fetch;
  const previousElement = global.Element;
  global.Element = FakeElement;

  return () => {
    global.fetch = previousFetch;
    global.Element = previousElement;
  };
}

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.values.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(token));
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList();
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
  }

  focus() {}
}
