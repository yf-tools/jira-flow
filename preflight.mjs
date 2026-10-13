#!/usr/bin/env node
/**
 * Setup & environment diagnostic check for JiraFlow.
 * Run this before starting work on your first Jira ticket:
 *
 *   node preflight.mjs [--repo <path-to-repo>] [--json] [--redact]
 *   npm run preflight
 *
 * Checks:
 *   - Node.js runtime version (>= 18)
 *   - Git installation & repository validity
 *   - GitLab CLI (`glab`) and/or GitHub CLI (`gh`) authentication
 *   - Atlassian / Jira MCP server registration across supported IDEs
 *   - Bundled helper scripts availability (`git-prep`, `pre-push-check`, `reviewer-lookup`)
 *
 * Pure Node.js built-ins, pure ASCII output, zero mutations.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const proc = globalThis.process;
const argv = proc.argv.slice(2);

const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const asJson = argv.includes("--json");
const redactMode = argv.includes("--redact");
const repo = flag("repo", proc.cwd());

const identity = new Map();
const hideValue = (value, placeholder) => {
  const v = String(value ?? "").trim();
  if (v.length >= 3) identity.set(v, placeholder);
};

hideValue(homedir(), "<home>");
hideValue(repo, "<repo>");

function scrubSecrets(text, maxLength = 400) {
  let out = String(text ?? "")
    .replace(/:\/\/[^/@\s]+@/g, "://<redacted>@")
    .replace(/\bgl[a-z]{2,8}-[A-Za-z0-9_-]{20,}/g, "<redacted>")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "<redacted>")
    .replace(/\bATATT[A-Za-z0-9_=-]{20,}/g, "<redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<redacted>")
    .replace(/\b(?:Bearer|Basic) [\w.+/=-]{12,}/gi, "<redacted>")
    .replace(
      /(token|secret|password|passwd|api[_-]?key)( *[:=] *)[^\s"',;)]{8,}/gi,
      "$1$2<redacted>",
    );
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}... (truncated)`;
  return out;
}

function literalRegex(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(escaped.replace(/\\\\|\//g, String.raw`[\\/]`), "gi");
}

function applyRedaction(text) {
  if (!redactMode) return String(text);
  let out = String(text);
  const ordered = [...identity.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [value, placeholder] of ordered) out = out.replace(literalRegex(value), placeholder);
  return out;
}

const checks = [];
const add = (group, name, status, detail, consequence) =>
  checks.push({
    group,
    name,
    status,
    detail: scrubSecrets(detail),
    consequence: consequence == null ? null : scrubSecrets(consequence, 600),
  });

function checkPlatform() {
  const major = Number.parseInt(proc.versions.node.split(".")[0], 10);
  if (major >= 18) {
    add("Environment", "node", "ok", `${proc.version} (supported >= 18)`);
  } else {
    add(
      "Environment",
      "node",
      "fail",
      `${proc.version} (requires >= 18)`,
      "Upgrade Node.js to v18 or newer.",
    );
  }
}

function resolveBin(name, envOverride) {
  if (envOverride && proc.env[envOverride]) {
    const custom = proc.env[envOverride];
    if (isAbsolute(custom) && existsSync(custom)) return custom;
  }
  const extensions =
    proc.platform === "win32" ? (proc.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const paths = (proc.env.PATH ?? "").split(delimiter);
  for (const dir of paths) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const ext of extensions) {
      const candidate = join(dir, proc.platform === "win32" ? `${name}${ext}` : name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function checkGit() {
  const bin = resolveBin("git", "GIT_PATH");
  if (!bin) {
    add(
      "Required",
      "git",
      "fail",
      "not found on PATH",
      "Install Git or set GIT_PATH to its absolute path.",
    );
    return false;
  }
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const ver = String(r.stdout ?? "").trim();
  add("Required", "git", "ok", `${bin} (${ver || "git"})`);

  // Check repo context
  const inside = spawnSync(bin, ["rev-parse", "--is-inside-work-tree"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (inside.status === 0 && String(inside.stdout).trim() === "true") {
    const branch = spawnSync(bin, ["branch", "--show-current"], {
      cwd: repo,
      encoding: "utf8",
      timeout: 10_000,
    });
    add(
      "Required",
      "workspace git",
      "ok",
      `inside git repository (current branch: ${String(branch.stdout).trim() || "detached"})`,
    );
  } else {
    add(
      "Required",
      "workspace git",
      "info",
      `target directory is not a git repository`,
      "Run against a project repository using --repo <path>.",
    );
  }
  return true;
}

function checkVCSClis() {
  const glabBin = resolveBin("glab", "GLAB_PATH");
  const ghBin = resolveBin("gh", "GH_PATH");

  let anyAuth = false;

  if (glabBin) {
    const r = spawnSync(glabBin, ["auth", "status"], { encoding: "utf8", timeout: 15_000 });
    const text = String(r.stdout ?? "") + String(r.stderr ?? "");
    const match =
      /Logged in to ([^\s]+) as ([^\s]+)/i.exec(text) || /Logged in to ([^\s]+)/i.exec(text);
    if (r.status === 0 || match) {
      anyAuth = true;
      const host = match ? match[1] : "GitLab";
      const user = match?.[2] ? match[2] : "authenticated user";
      hideValue(host, "<gitlab-host>");
      hideValue(user, "<user>");
      add("Git Host CLI", "glab (GitLab)", "ok", `logged in to ${host} as ${user}`);
    } else {
      add(
        "Git Host CLI",
        "glab (GitLab)",
        "warn",
        "installed but not logged in",
        "Run `glab auth login` if you are working on GitLab MRs.",
      );
    }
  } else {
    add("Git Host CLI", "glab (GitLab)", "info", "not installed (optional for GitHub-only users)");
  }

  if (ghBin) {
    const r = spawnSync(ghBin, ["auth", "status"], { encoding: "utf8", timeout: 15_000 });
    const text = String(r.stdout ?? "") + String(r.stderr ?? "");
    const match = /Logged in to ([^\s]+) account ([^\s]+)/i.exec(text);
    if (r.status === 0 || match) {
      anyAuth = true;
      const host = match ? match[1] : "github.com";
      const user = match ? match[2] : "authenticated user";
      hideValue(user, "<user>");
      add("Git Host CLI", "gh (GitHub)", "ok", `logged in to ${host} as ${user}`);
    } else {
      add(
        "Git Host CLI",
        "gh (GitHub)",
        "warn",
        "installed but not logged in",
        "Run `gh auth login` if you are working on GitHub PRs.",
      );
    }
  } else {
    add("Git Host CLI", "gh (GitHub)", "info", "not installed (optional for GitLab-only users)");
  }

  if (!anyAuth && !glabBin && !ghBin) {
    add(
      "Git Host CLI",
      "glab / gh",
      "warn",
      "neither glab nor gh found on PATH",
      "MR/PR creation in jira-push will hand you the link and description to open manually. Install glab or gh for automated push-and-open.",
    );
  }
}

function checkMcpConfigs() {
  const sources = [
    {
      label: "antigravity (user)",
      path: join(homedir(), ".gemini", "antigravity", "mcp_config.json"),
    },
    { label: "antigravity (user-alt)", path: join(homedir(), ".gemini", "mcp_config.json") },
    {
      label: "antigravity (config)",
      path: join(homedir(), ".gemini", "config", "mcp_config.json"),
    },
    { label: "claude (user)", path: join(homedir(), ".claude", "mcp.json") },
    { label: "claude (state)", path: join(homedir(), ".claude.json") },
    { label: "cursor (user)", path: join(homedir(), ".cursor", "mcp.json") },
    { label: "kiro (user)", path: join(homedir(), ".kiro", "settings", "mcp.json") },
    { label: "vscode (workspace)", path: join(repo, ".vscode", "mcp.json") },
    { label: "workspace", path: join(repo, "mcp.json") },
  ];

  let atlassianFound = false;

  for (const s of sources) {
    if (!existsSync(s.path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(s.path, "utf8"));
      const servers = {
        ...parsed.mcpServers,
        ...parsed.servers,
      };
      for (const [name, cfg] of Object.entries(servers)) {
        const text = `${name} ${cfg?.command ?? ""} ${(cfg?.args ?? []).join(" ")}`.toLowerCase();
        if (text.includes("atlassian") || text.includes("jira")) {
          atlassianFound = true;
          add("MCP Config", "atlassian-mcp", "ok", `configured in ${s.label} (${name})`);
          break;
        }
      }
    } catch {
      // ignore unparseable
    }
  }

  // Check Antigravity builtin / active directory
  const agyMcpDir = join(homedir(), ".gemini", "antigravity-ide", "mcp");
  if (existsSync(agyMcpDir)) {
    try {
      const entries = readdirSync(agyMcpDir);
      if (entries.some((e) => e.toLowerCase().includes("atlassian"))) {
        atlassianFound = true;
        add(
          "MCP Config",
          "atlassian-mcp",
          "ok",
          "detected in Antigravity IDE active MCP directory",
        );
      }
    } catch {
      // ignore
    }
  }

  if (!atlassianFound) {
    add(
      "MCP Config",
      "atlassian-mcp",
      "warn",
      "not found in discovered IDE configuration files",
      "Add atlassian-mcp (https://mcp.atlassian.com/v1/mcp) to your IDE's MCP settings per SETUP.md. Without it, Jira operations fall back to manual copy-paste.",
    );
  }
}

function checkHelperScripts() {
  const scripts = [
    { name: "git-prep.mjs", path: join(ROOT, "skills", "jira-pull", "scripts", "git-prep.mjs") },
    {
      name: "pre-push-check.mjs",
      path: join(ROOT, "skills", "jira-push", "scripts", "pre-push-check.mjs"),
    },
    {
      name: "reviewer-lookup.mjs",
      path: join(ROOT, "skills", "jira-push", "scripts", "reviewer-lookup.mjs"),
    },
  ];

  for (const s of scripts) {
    if (existsSync(s.path)) {
      add("Bundled Scripts", s.name, "ok", `present at ${s.path}`);
    } else {
      add(
        "Bundled Scripts",
        s.name,
        "fail",
        `missing: ${s.path}`,
        "Plugin installation is incomplete. Reinstall the plugin folder.",
      );
    }
  }
}

// ---------- Rendering ----------

const MARK = { ok: "[ ok ]", info: "[info]", warn: "[warn]", fail: "[FAIL]" };
const NAME_WIDTH = 20;
const GUTTER = " ".repeat(2 + 6 + 1 + NAME_WIDTH + 1);

function wrap(text, width = 80) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

function render() {
  const lines = ["", "JiraFlow Preflight Diagnostic", ""];
  for (const group of [
    "Environment",
    "Required",
    "Git Host CLI",
    "MCP Config",
    "Bundled Scripts",
  ]) {
    const rows = checks.filter((c) => c.group === group);
    if (rows.length === 0) continue;
    lines.push(group);
    for (const c of rows) {
      lines.push(`  ${MARK[c.status]} ${c.name.padEnd(NAME_WIDTH)} ${applyRedaction(c.detail)}`);
      if (c.consequence) {
        const wrapped = wrap(applyRedaction(c.consequence), 84);
        lines.push(...wrapped.map((l, i) => GUTTER + (i === 0 ? "-> " : "   ") + l));
      }
    }
    lines.push("");
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");

  lines.push(
    failed.length === 0
      ? "Ready. No blocking problems found."
      : `${failed.length} blocking problem(s): ${failed.map((c) => c.name).join(", ")}`,
  );
  if (warned.length > 0)
    lines.push(`${warned.length} non-blocking warning(s): ${warned.map((c) => c.name).join(", ")}`);

  if (redactMode) {
    lines.push("", "Identity redacted for sharing. Re-run without --redact to see real paths.");
  }
  lines.push("");
  return lines.join("\n");
}

// ---------- Main ----------

checkPlatform();
checkGit();
checkVCSClis();
checkMcpConfigs();
checkHelperScripts();

const failedCount = checks.filter((c) => c.status === "fail").length;

if (asJson) {
  const report = {
    repo: applyRedaction(repo),
    platform: proc.platform,
    node: proc.version,
    redacted: redactMode,
    checks: checks.map((c) => ({
      ...c,
      detail: applyRedaction(c.detail),
      consequence: c.consequence == null ? null : applyRedaction(c.consequence),
    })),
    failed: failedCount,
  };
  proc.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  proc.stdout.write(render());
}

proc.exit(failedCount === 0 ? 0 : 1);
