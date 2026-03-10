import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
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
