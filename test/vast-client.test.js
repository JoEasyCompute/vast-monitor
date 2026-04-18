import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  fetchDatacenterMetadata,
  fetchDatacenterMetadataBatch,
  normalizeEarningsDay,
  normalizeMachine,
  resetDatacenterMetadataStateForTests,
  resolveErrorMessage
} from "../src/vast-client.js";

test.afterEach(() => {
  resetDatacenterMetadataStateForTests();
});

test("normalizeMachine derives occupancy, status, maintenance, and idle state", () => {
  const normalized = normalizeMachine({
    machine_id: "12",
    hostname: "host-12",
    gpu_name: "RTX 4090",
    num_gpus: "4",
    gpu_occupancy: "D D -",
    current_rentals_running: "0",
    listed: false,
    listed_gpu_cost: "0.42",
    reliability2: "0.995",
    gpu_max_cur_temp: "77",
    earn_day: "11.2",
    num_reports: "3",
    num_recent_reports: "0.5",
    timeout: 301,
    error_description: "failed to inject CDI devices",
    machine_maintenance: ["network"],
    public_ipaddr: "1.2.3.4"
  }, "2026-03-14T12:00:00.000Z");

  assert.equal(normalized.machine_id, 12);
  assert.equal(normalized.occupied_gpus, 2);
  assert.equal(normalized.status, "offline");
  assert.equal(normalized.listed, 0);
  assert.equal(normalized.host_id, null);
  assert.equal(normalized.hosting_type, null);
  assert.equal(normalized.datacenter_id, null);
  assert.equal(normalized.idle_since, "2026-03-14T12:00:00.000Z");
  assert.equal(normalized.machine_maintenance, "[\"network\"]");
});

test("resolveErrorMessage prefers error_description and ignores known noise", () => {
  assert.equal(
    resolveErrorMessage({
      error_description: "primary failure",
      vm_error_msg: "secondary failure"
    }),
    "primary failure"
  );

  assert.equal(
    resolveErrorMessage({
      error_description: "Error: machine does not support VMs.",
      vm_error_msg: "fallback failure"
    }),
    "fallback failure"
  );
});

test("normalizeEarningsDay handles Vast day formats", () => {
  assert.equal(normalizeEarningsDay("2026-03-14"), "2026-03-14T00:00:00.000Z");
  assert.equal(normalizeEarningsDay(20526), "2026-03-14T00:00:00.000Z");
  assert.equal(normalizeEarningsDay(20260314), "2026-03-14T00:00:00.000Z");
  assert.equal(normalizeEarningsDay("bad"), null);
});

test("fetchDatacenterMetadata batches machine ids instead of calling once per machine", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vast-monitor-batch-"));
  const apiKeyPath = path.join(tempDir, "vast_api_key");
  fs.writeFileSync(apiKeyPath, "secret-token\n");

  const machineIds = Array.from({ length: 205 }, (_, index) => index + 1);
  const seenBatches = [];
  const originalFetch = global.fetch;

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const batch = body.machine_id.in;
    seenBatches.push(batch);

    return {
      ok: true,
      async json() {
        return {
          offers: batch.map((machineId) => ({
            machine_id: machineId,
            host_id: machineId + 1000,
            hosting_type: 1
          }))
        };
      }
    };
  };

  try {
    const metadata = await fetchDatacenterMetadata({
      vastApiUrl: "https://example.invalid/api/v0",
      vastApiKeyPath: apiKeyPath
    }, machineIds);

    assert.equal(seenBatches.length, 3);
    assert.equal(seenBatches[0].length, 100);
    assert.equal(seenBatches[1].length, 100);
    assert.equal(seenBatches[2].length, 5);
    assert.deepEqual(metadata["205"], { host_id: 1205, hosting_type: 1 });
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchDatacenterMetadata retries unresolved machine ids individually when batch results are incomplete", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vast-monitor-batch-retry-"));
  const apiKeyPath = path.join(tempDir, "vast_api_key");
  fs.writeFileSync(apiKeyPath, "secret-token\n");

  const originalFetch = global.fetch;
  const seenBodies = [];

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    seenBodies.push(body);
    const ids = body.machine_id.in;

    if (ids.length === 2) {
      return {
        ok: true,
        async json() {
          return {
            offers: [
              { machine_id: 101, host_id: 5001, hosting_type: 1 }
            ]
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          offers: [
            { machine_id: ids[0], host_id: ids[0] + 5000, hosting_type: 1 }
          ]
        };
      }
    };
  };

  try {
    const metadata = await fetchDatacenterMetadata({
      vastApiUrl: "https://example.invalid/api/v0",
      vastApiKeyPath: apiKeyPath
    }, [101, 102]);

    assert.deepEqual(metadata["101"], { host_id: 5001, hosting_type: 1 });
    assert.deepEqual(metadata["102"], { host_id: 5102, hosting_type: 1 });
    assert.equal(seenBodies.length, 2);
    assert.deepEqual(seenBodies[1].machine_id.in, [102]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchDatacenterMetadataBatch times out hung Vast API requests", async () => {
  const originalFetch = global.fetch;
  const originalAbortSignalTimeout = AbortSignal.timeout;

  AbortSignal.timeout = () => AbortSignal.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason);
      return;
    }

    options.signal.addEventListener("abort", () => {
      reject(options.signal.reason);
    }, { once: true });
  });

  try {
    await assert.rejects(
      fetchDatacenterMetadataBatch({
        vastApiUrl: "https://example.invalid/api/v0"
      }, "secret-token", [101]),
      /Timed out fetching Vast bundle metadata after 30s/
    );
  } finally {
    AbortSignal.timeout = originalAbortSignalTimeout;
    global.fetch = originalFetch;
  }
});

test("fetchDatacenterMetadata uses cached metadata during Vast bundle rate limits", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vast-monitor-batch-rate-limit-"));
  const apiKeyPath = path.join(tempDir, "vast_api_key");
  fs.writeFileSync(apiKeyPath, "secret-token\n");

  const originalFetch = global.fetch;
  const seenBodies = [];
  let requestCount = 0;

  global.fetch = async (_url, options) => {
    requestCount += 1;
    const body = JSON.parse(options.body);
    seenBodies.push(body);

    if (requestCount === 1) {
      return {
        ok: true,
        async json() {
          return {
            offers: [
              { machine_id: 101, host_id: 5001, hosting_type: 1 }
            ]
          };
        }
      };
    }

    return {
      ok: false,
      status: 429,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "retry-after" ? "60" : null;
        }
      }
    };
  };

  try {
    const firstMetadata = await fetchDatacenterMetadata({
      vastApiUrl: "https://example.invalid/api/v0",
      vastApiKeyPath: apiKeyPath
    }, [101]);

    const secondMetadata = await fetchDatacenterMetadata({
      vastApiUrl: "https://example.invalid/api/v0",
      vastApiKeyPath: apiKeyPath
    }, [101]);

    const thirdMetadata = await fetchDatacenterMetadata({
      vastApiUrl: "https://example.invalid/api/v0",
      vastApiKeyPath: apiKeyPath
    }, [101]);

    assert.deepEqual(firstMetadata["101"], { host_id: 5001, hosting_type: 1 });
    assert.deepEqual(secondMetadata["101"], { host_id: 5001, hosting_type: 1 });
    assert.deepEqual(thirdMetadata["101"], { host_id: 5001, hosting_type: 1 });
    assert.equal(seenBodies.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
