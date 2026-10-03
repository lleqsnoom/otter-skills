#!/usr/bin/env node
/**
 * The platform routing table: for each platform o-triage can classify, the reproduction recipe in o-debug's
 * `references/reproduction-recipes.md` and the tools o-investigate reaches for.
 *
 * Usage: node route.mjs <platform>   → prints that platform's row as JSON (exit 1 on an unknown platform)
 *        node route.mjs              → prints the whole table
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const ROUTE_TABLE = {
  web: { reproduction: "Web (Playwright)", investigateTools: ["chrome-devtools-mcp", "lighthouse", "network-capture"] },
  mobile: { reproduction: "Mobile (Android)", investigateTools: ["adb-logcat", "xcode-instruments", "android-studio-profiler", "react-native-debugger"] },
  tv: { reproduction: "Mobile (Android)", investigateTools: ["vendor-dev-tools", "adb-logcat"] },
  desktop: { reproduction: "CLI", investigateTools: ["devtools-of-the-shell (electron/tauri)", "os-logs", "debugger"] },
  backend: { reproduction: "Backend or library (Node)", investigateTools: ["node-inspect", "gdb-lldb", "strace", "flame-graphs"] },
  cli: { reproduction: "CLI", investigateTools: ["debugger", "strace", "verbose-flags"] },
  library: { reproduction: "Backend or library (Node)", investigateTools: ["debugger", "git-bisect"] },
  infra: { reproduction: "CLI", investigateTools: ["pipeline-logs", "kubectl-describe-logs", "provider-audit-log"] },
  gaming: { reproduction: "CLI", investigateTools: ["unity-profiler", "unreal-insights", "renderdoc", "gpu-frame-debugger"] },
};

const USAGE = `Usage: node route.mjs [<platform>]
Prints the platform's reproduction recipe and investigation tools as JSON, or the whole table without a platform.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const platform = process.argv[2];
  if (!platform) {
    console.log(JSON.stringify(ROUTE_TABLE, null, 2));
    return;
  }
  const row = ROUTE_TABLE[platform];
  if (!row) {
    console.error(`unknown platform "${platform}": one of ${Object.keys(ROUTE_TABLE).join(", ")}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ platform, ...row }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
