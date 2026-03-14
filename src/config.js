import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  projectRoot,
  port: numberFromEnv("PORT", 3000),
  pollIntervalMs: numberFromEnv("POLL_INTERVAL_MS", 5 * 60 * 1000),
  vastCliPath: process.env.VAST_CLI_PATH || path.join(process.env.HOME || "", "Desktop/dev/vast/vast"),
  vastApiUrl: process.env.VAST_API_URL || "https://console.vast.ai/api/v0",
  vastApiKeyPath: process.env.VAST_API_KEY_PATH || path.join(os.homedir(), ".config/vastai/vast_api_key"),
  alertTempThreshold: numberFromEnv("ALERT_TEMP_THRESHOLD", 85),
  alertIdleHours: numberFromEnv("ALERT_IDLE_HOURS", 6),
  dbPath: process.env.DB_PATH ? path.resolve(projectRoot, process.env.DB_PATH) : path.resolve(projectRoot, "data/vast-monitor.db")
};

export function validateRuntimeConfig(runtimeConfig) {
  const issues = [];

  if (!fileExists(runtimeConfig.vastCliPath)) {
    issues.push(`VAST CLI not found at ${runtimeConfig.vastCliPath}`);
  } else if (!isExecutable(runtimeConfig.vastCliPath)) {
    issues.push(`VAST CLI is not executable at ${runtimeConfig.vastCliPath}`);
  }

  const apiKeyStatus = getApiKeyStatus(runtimeConfig.vastApiKeyPath);
  if (!apiKeyStatus.ok) {
    issues.push(apiKeyStatus.message);
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function getLiveDependencyHealth(runtimeConfig) {
  const vastCliExists = fileExists(runtimeConfig.vastCliPath);
  const vastCliExecutable = vastCliExists && isExecutable(runtimeConfig.vastCliPath);
  const apiKeyStatus = getApiKeyStatus(runtimeConfig.vastApiKeyPath);

  return {
    vastCli: {
      ok: vastCliExecutable,
      path: runtimeConfig.vastCliPath,
      detail: !vastCliExists
        ? "CLI binary not found"
        : !vastCliExecutable
          ? "CLI binary is not executable"
          : "ready"
    },
    vastApiKey: {
      ok: apiKeyStatus.ok,
      path: runtimeConfig.vastApiKeyPath,
      detail: apiKeyStatus.ok ? "ready" : apiKeyStatus.message
    }
  };
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getApiKeyStatus(apiKeyPath) {
  try {
    const value = fs.readFileSync(apiKeyPath, "utf8").trim();
    if (!value) {
      return {
        ok: false,
        message: `Vast API key file is empty at ${apiKeyPath}`
      };
    }

    return { ok: true, message: "ready" };
  } catch (error) {
    return {
      ok: false,
      message: `Vast API key file is not readable at ${apiKeyPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
