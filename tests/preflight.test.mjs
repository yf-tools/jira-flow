import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PREFLIGHT = join(ROOT, "preflight.mjs");

test("preflight.mjs executes successfully and outputs valid JSON report", () => {
  const r = spawnSync(process.execPath, [PREFLIGHT, "--json", "--repo", ROOT], {
    encoding: "utf8",
    timeout: 25_000,
  });

  assert.ok(r.status === 0 || r.status === 1, `Preflight exited with unexpected status ${r.status}`);
  assert.ok(r.stdout && r.stdout.length > 0, "Preflight produced stdout");

  const data = JSON.parse(r.stdout);
  assert.ok(Array.isArray(data.checks), "Report contains checks array");
  assert.ok(typeof data.failed === "number", "Report contains failed count");
  assert.ok(data.checks.some((c) => c.name === "git"), "Checks include git");
  assert.ok(data.checks.some((c) => c.name === "node"), "Checks include node");
  assert.ok(data.checks.some((c) => c.name === "atlassian-mcp"), "Checks include atlassian-mcp");
});
