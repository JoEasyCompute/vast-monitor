import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getLiveDependencyHealth, getOptionalRuntimeWarnings, validateRuntimeConfig } from "../src/config.js";

test("validateRuntimeConfig accepts executable cli and non-empty api key", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vast-monitor-config-"));
  const cliPath = path.join(tempDir, "vast");
  const apiKeyPath = path.join(tempDir, "vast_api_key");

  fs.writeFileSync(cliPath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(cliPath, 0o755);
  fs.writeFileSync(apiKeyPath, "secret-token\n");

  const result = validateRuntimeConfig({ vastCliPath: cliPath, vastApiKeyPath: apiKeyPath });
  const live = getLiveDependencyHealth({ vastCliPath: cliPath, vastApiKeyPath: apiKeyPath });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(live.vastCli.ok, true);
  assert.equal(live.vastApiKey.ok, true);
});

test("validateRuntimeConfig reports missing required paths", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vast-monitor-config-missing-"));
  const result = validateRuntimeConfig({
    vastCliPath: path.join(tempDir, "missing-vast"),
    vastApiKeyPath: path.join(tempDir, "missing-api-key")
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0], /VAST CLI not found/);
  assert.match(result.issues[1], /Vast API key file is not readable/);
});

test("optional runtime warnings do not fire for supported python-dateutil", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vast-monitor-config-dateutil-ok-"));
  const cliPath = path.join(tempDir, "vast");
  const apiKeyPath = path.join(tempDir, "vast_api_key");

  fs.writeFileSync(cliPath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(cliPath, 0o755);
  fs.writeFileSync(apiKeyPath, "secret-token\n");

  const warnings = getOptionalRuntimeWarnings({ vastCliPath: cliPath, vastApiKeyPath: apiKeyPath });

  assert.deepEqual(warnings, []);
});
