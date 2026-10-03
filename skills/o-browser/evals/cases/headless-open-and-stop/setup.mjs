// A static app already being served on a free port, named in the README the way a real project names it.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q", "-b", "main");
fs.writeFileSync("index.html", "<!doctype html><html><head><title>Otter Probe 7731</title></head><body><h1>Probe</h1></body></html>\n");
fs.writeFileSync(
  "server.mjs",
  'import http from "node:http";\nimport fs from "node:fs";\nconst server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(fs.readFileSync("index.html")); });\nserver.listen(0, "127.0.0.1", () => fs.writeFileSync(".git/otter-eval-port", String(server.address().port)));\n',
);
const server = spawn(process.execPath, ["server.mjs"], { detached: true, stdio: "ignore" });
server.unref();
fs.writeFileSync(".git/otter-eval-server.pid", String(server.pid));
const deadline = Date.now() + 10000;
while (!fs.existsSync(".git/otter-eval-port") && Date.now() < deadline) execFileSync("sleep", ["0.1"]);
const port = fs.readFileSync(".git/otter-eval-port", "utf8");
fs.writeFileSync("README.md", `# Probe\n\nThe dev server is already running: open http://127.0.0.1:${port}/ to see the app.\n`);
