import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");
const toolRoot = path.resolve(__dirname, "..");
const browserStore = path.join(workspaceRoot, "tmp/playwright/ms-playwright");
const htmlReport = path.join(workspaceRoot, "tmp/playwright/report");
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

const env = {
  ...process.env,
  PLAYWRIGHT_BASE_URL: baseUrl,
  PLAYWRIGHT_BROWSERS_PATH: browserStore,
  PLAYWRIGHT_HTML_REPORT: htmlReport,
};

const args = process.argv.slice(2);
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCommand, ["playwright", ...args], {
  cwd: toolRoot,
  env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
