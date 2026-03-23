import test from "node:test";
import assert from "node:assert/strict";

import {
  bindMachineInteractions,
  bindModalControls,
  bindReportGestureHandlers
} from "../public/app/event-wiring.js";
import { copyTextToClipboard } from "../public/app/clipboard.js";

test("bindMachineInteractions delegates row clicks and modal copy actions", async () => {
  const restore = installFakeDom();
  try {
    const machinesBody = new FakeElement("tbody");
    const row = new FakeElement("tr", { machineRow: "1", machineId: "49697" });
    const rowChild = new FakeElement("td");
    row.appendChild(rowChild);

    const modalTitle = new FakeElement("h2");
    const machineIdButton = new FakeElement("button", { copyMachineId: "49697" });
    const ipButton = new FakeElement("button", { copyIpAddress: "10.0.0.65" });
    modalTitle.appendChild(machineIdButton);
    modalTitle.appendChild(ipButton);

    const calls = [];
    bindMachineInteractions({
      machinesBody,
      modalTitle,
      onMachineRowClick: (event, machineId) => {
        calls.push(["row", machineId, event.ctrlKey === true]);
      },
      onCopyMachineId: (machineId, button) => {
        calls.push(["copy-id", machineId, button]);
      },
      onCopyIpAddress: (ipAddress, button) => {
        calls.push(["copy-ip", ipAddress, button]);
      }
    });

    machinesBody.dispatch("click", { target: rowChild, ctrlKey: true });
    modalTitle.dispatch("click", { target: machineIdButton });
    modalTitle.dispatch("click", { target: ipButton });

    assert.deepEqual(calls, [
      ["row", 49697, true],
      ["copy-id", "49697", machineIdButton],
      ["copy-ip", "10.0.0.65", ipButton]
    ]);
  } finally {
    restore();
  }
});

test("bindModalControls routes keyboard navigation based on modal state", () => {
  const restore = installFakeDom();
  try {
    const modalTabs = new FakeCollection([
      new FakeElement("button", { tab: "charts" }),
      new FakeElement("button", { tab: "events" })
    ]);
    const modalHistoryRange = new FakeCollection([
      new FakeElement("button", { hours: "24" }),
      new FakeElement("button", { hours: "168" })
    ]);

    const calls = [];
    bindModalControls({
      modalBackdrop: new FakeElement("div"),
      modalClose: new FakeElement("button"),
      modalPrev: new FakeElement("button"),
      modalNext: new FakeElement("button"),
      modalTabs,
      modalHistoryRange,
      reportsModalBackdrop: new FakeElement("div"),
      reportsModalClose: new FakeElement("button"),
      reportsPrevButton: new FakeElement("button"),
      reportsNextButton: new FakeElement("button"),
      onCloseMachineModal: () => calls.push("close-machine"),
      onPrevMachine: () => calls.push("prev-machine"),
      onNextMachine: () => calls.push("next-machine"),
      onSetModalTab: (tab) => calls.push(`tab:${tab}`),
      onModalHistoryRangeChange: (hours) => calls.push(`range:${hours}`),
      onCloseReportsModal: () => calls.push("close-reports"),
      onPrevReport: () => calls.push("prev-report"),
      onNextReport: () => calls.push("next-report"),
      isSettingsOpen: () => false,
      closeSettings: () => calls.push("close-settings"),
      isMachineModalOpen: () => true,
      isReportsModalOpen: () => false,
      canGoPrevMachine: () => true,
      canGoNextMachine: () => false,
      canGoPrevReport: () => true,
      canGoNextReport: () => true
    });

    global.window.dispatch("keydown", { key: "ArrowLeft" });
    global.window.dispatch("keydown", { key: "ArrowRight" });
    global.window.dispatch("keydown", { key: "Escape" });

    assert.deepEqual(calls, ["prev-machine", "close-machine"]);
  } finally {
    restore();
  }
});

test("bindReportGestureHandlers forwards gesture lifecycle and can prevent context menu", () => {
  const restore = installFakeDom();
  try {
    const machinesBody = new FakeElement("tbody");
    const calls = [];

    bindReportGestureHandlers({
      machinesBody,
      onBeginLongPress: (event) => calls.push(`begin:${event.pointerType}`),
      onCancelLongPress: () => calls.push("cancel"),
      shouldPreventContextMenu: (event) => event.target === "prevent-me"
    });

    machinesBody.dispatch("pointerdown", { pointerType: "touch" });
    machinesBody.dispatch("pointerup", {});
    const contextEvent = machinesBody.dispatch("contextmenu", { target: "prevent-me" });

    assert.deepEqual(calls, ["begin:touch", "cancel"]);
    assert.equal(contextEvent.defaultPrevented, true);
  } finally {
    restore();
  }
});

test("copyTextToClipboard falls back to textarea selection when Clipboard API is unavailable", async () => {
  const restore = installClipboardDom({ secureContext: false });
  try {
    await copyTextToClipboard("10.0.0.65");

    assert.equal(global.document.body.appended.length, 1);
    assert.equal(global.document.execCommands[0], "copy");
    assert.equal(global.document.body.removed.length, 1);
    assert.equal(global.document.body.appended[0].value, "10.0.0.65");
  } finally {
    restore();
  }
});

class FakeCollection {
  constructor(items) {
    this.items = items;
  }

  querySelectorAll() {
    return this.items;
  }
}

class FakeElement {
  constructor(tagName = "div", dataset = {}) {
    this.tagName = tagName.toUpperCase();
    this.dataset = { ...dataset };
    this.listeners = new Map();
    this.parentElement = null;
    this.children = [];
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, init = {}) {
    const event = createFakeEvent(type, init);
    const handlers = this.listeners.get(type) || [];
    for (const handler of handlers) {
      handler(event);
    }
    return event;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
}

function matchesSelector(element, selector) {
  if (selector === "[data-machine-row='1']") {
    return element.dataset.machineRow === "1";
  }
  if (selector === "[data-copy-machine-id]") {
    return typeof element.dataset.copyMachineId === "string";
  }
  if (selector === "[data-copy-ip-address]") {
    return typeof element.dataset.copyIpAddress === "string";
  }
  return false;
}

function createFakeEvent(type, init = {}) {
  return {
    type,
    target: init.target,
    key: init.key,
    ctrlKey: init.ctrlKey === true,
    metaKey: init.metaKey === true,
    pointerType: init.pointerType,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };
}

function installFakeDom() {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousElement = global.Element;

  global.Element = FakeElement;
  global.document = {
    querySelectorAll() {
      return [];
    }
  };
  global.window = createFakeWindow();

  return () => {
    global.window = previousWindow;
    global.document = previousDocument;
    global.Element = previousElement;
  };
}

function installClipboardDom({ secureContext }) {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const appended = [];
  const removed = [];
  global.document = {
    execCommands: [],
    body: {
      appended,
      removed,
      appendChild(node) {
        appended.push(node);
      },
      removeChild(node) {
        removed.push(node);
      }
    },
    createElement() {
      return {
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {}
      };
    },
    execCommand(command) {
      this.execCommands.push(command);
      return true;
    }
  };
  global.window = {
    isSecureContext: secureContext
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {}
  });

  return () => {
    global.window = previousWindow;
    global.document = previousDocument;
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  };
}

function createFakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatch(type, init = {}) {
      const event = createFakeEvent(type, init);
      const handlers = listeners.get(type) || [];
      for (const handler of handlers) {
        handler(event);
      }
      return event;
    }
  };
}
