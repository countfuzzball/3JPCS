import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const port = 4174;
const url = `http://127.0.0.1:${String(port)}/?benchmark=1`;
const preview = spawn(
  process.execPath,
  [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port)],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

let browser;
try {
  await waitForServer(url, preview);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__POLYGON_BENCHMARK__?.ready === true, null, { timeout: 120_000 });
  const result = await page.evaluate(async () => window.__POLYGON_BENCHMARK__?.run());
  if (!result) throw new Error("benchmark harness returned no result");
  const report = {
    recordedAt: new Date().toISOString(),
    productionBuild: true,
    ...result,
  };
  const outputDirectory = resolve(root, "benchmark-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, "milestone-5-latest.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Benchmark report written to ${outputPath}`);
} finally {
  await browser?.close();
  preview.kill();
}

async function waitForServer(target, processHandle) {
  const deadline = Date.now() + 30_000;
  let stderr = "";
  processHandle.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`Vite preview exited early.\n${stderr}`);
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {
      // Preview has not bound its local port yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for production preview.\n${stderr}`);
}
