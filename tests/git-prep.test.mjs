import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  parsePorcelainLine,
  escapeRegex,
  findBranch,
  detectVcsHost,
  findMrTemplate,
  detectProjectTooling,
} from "../skills/jira-pull/scripts/git-prep.mjs";

const scriptPath = resolve("skills/jira-pull/scripts/git-prep.mjs");

test("git-prep.mjs CLI executes successfully and outputs well-formed JSON", () => {
  const stdout = execFileSync("node", [scriptPath, "--workspace", process.cwd()], {
    encoding: "utf8",
  });
  const data = JSON.parse(stdout);

  assert.ok(typeof data.workspace === "string");
  assert.ok(typeof data.currentBranch === "string");
  assert.ok(typeof data.isDirty === "boolean");
  assert.ok(Array.isArray(data.uncommittedFiles));
  assert.ok(typeof data.detached === "boolean");
  assert.ok(typeof data.defaultBranch === "string");
  assert.ok(typeof data.integrationBranch === "string");
  assert.ok(Array.isArray(data.detectedProjectKeys));
  assert.ok(Array.isArray(data.branchNaming.dominantPrefixes));
  assert.ok(typeof data.commitConvention.suggestedFormat === "string");
  assert.ok(data.vcsHost && typeof data.vcsHost.type === "string");
  assert.ok("mrTemplate" in data);
  assert.ok("project" in data);
});

test("parsePorcelainLine parses git status output correctly", () => {
  assert.deepStrictEqual(parsePorcelainLine(" M skills/jira-pull/scripts/git-prep.mjs"), {
    status: " M",
    file: "skills/jira-pull/scripts/git-prep.mjs",
  });
  assert.deepStrictEqual(parsePorcelainLine("M  README.md"), {
    status: "M ",
    file: "README.md",
  });
  assert.deepStrictEqual(parsePorcelainLine("?? src/index.ts"), {
    status: "??",
    file: "src/index.ts",
  });
  assert.deepStrictEqual(parsePorcelainLine("R  old/file.js -> new/file.js"), {
    status: "R ",
    file: "new/file.js",
  });
  assert.deepStrictEqual(parsePorcelainLine('M  "folder with space/test.js"'), {
    status: "M ",
    file: "folder with space/test.js",
  });
  // Non-rename with " -> " in filename should not be split
  assert.deepStrictEqual(parsePorcelainLine(" M normal -> arrow.txt"), {
    status: " M",
    file: "normal -> arrow.txt",
  });
  assert.strictEqual(parsePorcelainLine(null), null);
  assert.strictEqual(parsePorcelainLine(""), null);
});

test("ticket boundary regex enforces strict ticket boundaries", () => {
  function matchesTicket(branch, key) {
    const keyRegex = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(key)}($|[^a-zA-Z0-9])`, "i");
    return keyRegex.test(branch);
  }

  // Key PROJ-10 should match exact and delimiter branches
  assert.strictEqual(matchesTicket("feature/PROJ-10", "PROJ-10"), true);
  assert.strictEqual(matchesTicket("feature/PROJ-10-auth-fix", "PROJ-10"), true);
  assert.strictEqual(matchesTicket("feature/PROJ-10_fix", "PROJ-10"), true);
  assert.strictEqual(matchesTicket("feature/PROJ-10/fix", "PROJ-10"), true);
  assert.strictEqual(matchesTicket("PROJ-10", "PROJ-10"), true);

  // Key PROJ-10 should NOT match tickets with prefix overlap or letter suffixes
  assert.strictEqual(matchesTicket("feature/PROJ-100", "PROJ-10"), false);
  assert.strictEqual(matchesTicket("feature/PROJ-101", "PROJ-10"), false);
  assert.strictEqual(matchesTicket("feature/PROJ-1010", "PROJ-10"), false);
  assert.strictEqual(matchesTicket("feature/PROJ-10a", "PROJ-10"), false);
  assert.strictEqual(matchesTicket("feature/PROJ-10auth", "PROJ-10"), false);
});

test("detectProjectTooling identifies repo structure", () => {
  const tooling = detectProjectTooling(process.cwd());
  assert.ok(typeof tooling === "object");
  assert.ok("packageManager" in tooling);
  assert.ok("hasHusky" in tooling);
  assert.ok("linter" in tooling);
  assert.ok("testRunner" in tooling);
});
