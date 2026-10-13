#!/usr/bin/env node
/**
 * Fast deterministic git inspection for jira-pull.
 * Runs in a single process turn without multi-step shell latency.
 */

import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const workspace = resolve(getArg("--workspace") || process.cwd());
const ticket = getArg("--ticket");
const epic = getArg("--epic");
const gitBin = process.env.GIT_PATH || "git";

function git(args, trimTrailingOnly = false, customWorkspace = workspace) {
  try {
    const out = execFileSync(gitBin, args, {
      cwd: customWorkspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return trimTrailingOnly ? out.replace(/[\r\n]+$/, "") : out.trim();
  } catch (err) {
    if (process.platform === "win32" && (err.code === "ENOENT" || err.code === "EINVAL")) {
      try {
        const out = execFileSync(gitBin, args, {
          cwd: customWorkspace,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: true,
        });
        return trimTrailingOnly ? out.replace(/[\r\n]+$/, "") : out.trim();
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parsePorcelainLine(l) {
  if (!l || typeof l !== "string") return null;
  const m = l.match(/^([ MADRCU?!]{1,2})\s+(.+)$/);
  if (!m) return null;
  let rawStatus = m[1];
  let filePath = m[2].trim();
  if ((rawStatus.includes("R") || rawStatus.includes("C")) && filePath.includes(" -> ")) {
    filePath = filePath.split(" -> ")[1].trim();
  }
  filePath = filePath.replace(/^"(.*)"$/, "$1");
  return { status: rawStatus, file: filePath };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkIfMerged(branchRef, targetRef, remotes = ["origin"], customWorkspace = workspace) {
  if (!branchRef || !targetRef || branchRef === targetRef) return false;
  const remoteList = Array.isArray(remotes) && remotes.length > 0 ? remotes : ["origin"];
  const candidatesBranch = [branchRef, ...remoteList.map((r) => `${r}/${branchRef}`)];
  const candidatesTarget = [...remoteList.map((r) => `${r}/${targetRef}`), targetRef];

  for (const b of candidatesBranch) {
    for (const t of candidatesTarget) {
      try {
        execFileSync(gitBin, ["merge-base", "--is-ancestor", b, t], {
          cwd: customWorkspace,
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: true,
        });
        return true;
      } catch {
        // Ref missing or not an ancestor
      }
    }
  }
  return false;
}

function findBranch(key, targetBranch, remotes = ["origin"], customWorkspace = workspace) {
  if (!key) return { exists: false, local: false, remote: false, name: null, isMergedIntoTarget: false };
  const raw = git(["branch", "-a", "--list", `*${key}*`], false, customWorkspace) || "";
  let lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\*?\s+/, "").trim())
    .filter((l) => l && !l.startsWith("(") && !l.includes(" -> ") && !l.endsWith("/HEAD"));

  // Strictly enforce ticket boundary check so PROJ-10 does not match PROJ-100, PROJ-101, or PROJ-10a
  const keyRegex = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(key)}($|[^a-zA-Z0-9])`, "i");
  lines = lines.filter((l) => keyRegex.test(l));

  if (lines.length === 0) return { exists: false, local: false, remote: false, name: null, isMergedIntoTarget: false };

  // Prioritize clean exact matches (e.g. "feature/PROJ-10" or "PROJ-10" over "feature/PROJ-10-long-slug")
  const cleanKeyRegex = new RegExp(`(^|/)${escapeRegex(key)}$`, "i");
  lines.sort((a, b) => {
    const aClean = cleanKeyRegex.test(a.replace(/^remotes\/[^/]+\//, ""));
    const bClean = cleanKeyRegex.test(b.replace(/^remotes\/[^/]+\//, ""));
    if (aClean && !bClean) return -1;
    if (!aClean && bClean) return 1;
    return 0;
  });

  const local = lines.find((b) => !b.startsWith("remotes/"));
  const remote = lines.find((b) => b.startsWith("remotes/"));
  const branchName = local || (remote ? remote.replace(/^remotes\/[^/]+\//, "") : lines[0].replace(/^remotes\/[^/]+\//, ""));
  const isMerged = branchName !== targetBranch && checkIfMerged(branchName, targetBranch, remotes, customWorkspace);
  return {
    exists: true,
    local: Boolean(local),
    remote: Boolean(remote),
    name: branchName,
    isMergedIntoTarget: isMerged,
    mergedInto: isMerged ? targetBranch : null,
  };
}

// VCS host detection (GitLab, GitHub, Bitbucket)
function detectVcsHost(remotes = ["origin"], customWorkspace = workspace) {
  const remoteList = Array.isArray(remotes) && remotes.length > 0 ? remotes : ["origin"];
  let remoteUrl = "";
  for (const r of remoteList) {
    remoteUrl = git(["remote", "get-url", r], false, customWorkspace) || git(["config", `remote.${r}.url`], false, customWorkspace) || "";
    if (remoteUrl) break;
  }
  const lowerUrl = remoteUrl.toLowerCase();
  if (lowerUrl.includes("gitlab")) {
    return { type: "gitlab", cli: "glab", remoteUrl };
  }
  if (lowerUrl.includes("github")) {
    return { type: "github", cli: "gh", remoteUrl };
  }
  if (lowerUrl.includes("bitbucket")) {
    return { type: "bitbucket", cli: null, remoteUrl };
  }
  return { type: "unknown", cli: null, remoteUrl };
}

// Case-insensitive file existence and reading helper for Linux/macOS/Windows
function findFileCaseInsensitive(baseDir, relativePath) {
  const segments = relativePath.split(/[/\\]/).filter(Boolean);
  let currentDir = baseDir;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (!existsSync(currentDir)) return null;

    let entries = [];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return null;
    }

    const matchedEntry = entries.find((e) => e.toLowerCase() === seg.toLowerCase());
    if (!matchedEntry) return null;

    currentDir = join(currentDir, matchedEntry);
    if (isLast) return currentDir;
  }
  return null;
}

// MR / PR Template detection (Cross-platform case-insensitive)
function findMrTemplate(targetWorkspace = workspace) {
  const candidates = [
    ".gitlab/merge_request_templates/Default.md",
    ".gitlab/merge_request_templates/default.md",
    ".gitlab/merge_request_template.md",
    ".gitlab/merge_request_template.txt",
    ".github/pull_request_template.md",
    ".github/pull_request_template.txt",
    "pull_request_template.md",
    "merge_request_template.md",
    "docs/pull_request_template.md",
  ];

  for (const rel of candidates) {
    const foundPath = findFileCaseInsensitive(targetWorkspace, rel);
    if (foundPath && existsSync(foundPath)) {
      try {
        const content = readFileSync(foundPath, "utf8");
        return { path: rel, content };
      } catch {}
    }
  }

  // Check directories for templates case-insensitively
  const searchDirs = [
    [".gitlab", "merge_request_templates"],
    [".github", "pull_request_template"],
    [".github", "PULL_REQUEST_TEMPLATE"],
  ];

  for (const [parent, child] of searchDirs) {
    const parentPath = findFileCaseInsensitive(targetWorkspace, parent);
    if (parentPath) {
      const dirPath = findFileCaseInsensitive(parentPath, child);
      if (dirPath && existsSync(dirPath)) {
        try {
          const files = readdirSync(dirPath).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
          if (files.length > 0) {
            const defaultFile = files.find((f) => /^default\./i.test(f)) || files[0];
            const rel = `${parent}/${child}/${defaultFile}`.replaceAll('\\', "/");
            const content = readFileSync(join(dirPath, defaultFile), "utf8");
            return { path: rel, content };
          }
        } catch {}
      }
    }
  }

  return { path: null, content: null };
}

// Project tooling detection
function detectProjectTooling(targetWorkspace = workspace) {
  let packageManager = null;
  if (existsSync(join(targetWorkspace, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (existsSync(join(targetWorkspace, "yarn.lock"))) packageManager = "yarn";
  else if (existsSync(join(targetWorkspace, "bun.lockb")) || existsSync(join(targetWorkspace, "bun.lock"))) packageManager = "bun";
  else if (existsSync(join(targetWorkspace, "package-lock.json"))) packageManager = "npm";
  else if (existsSync(join(targetWorkspace, "Cargo.lock"))) packageManager = "cargo";
  else if (existsSync(join(targetWorkspace, "go.mod"))) packageManager = "go";
  else if (existsSync(join(targetWorkspace, "poetry.lock"))) packageManager = "poetry";
  else if (existsSync(join(targetWorkspace, "Pipfile.lock"))) packageManager = "pipenv";
  else if (existsSync(join(targetWorkspace, "gradlew")) || existsSync(join(targetWorkspace, "build.gradle")) || existsSync(join(targetWorkspace, "build.gradle.kts"))) packageManager = "gradle";
  else if (existsSync(join(targetWorkspace, "pom.xml"))) packageManager = "maven";
  else if (existsSync(join(targetWorkspace, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(targetWorkspace, "package.json"), "utf8"));
      if (pkg.packageManager) {
        const pm = pkg.packageManager.split("@")[0];
        if (pm) packageManager = pm;
      }
    } catch {}
  }

  const hasHusky = existsSync(join(targetWorkspace, ".husky"));
  let hooksDir = git(["rev-parse", "--git-path", "hooks"], false, targetWorkspace);
  if (!hooksDir || !existsSync(resolve(targetWorkspace, hooksDir))) {
    hooksDir = ".git/hooks";
  }
  const hasPrePushHook = existsSync(join(targetWorkspace, ".husky/pre-push")) || existsSync(resolve(targetWorkspace, hooksDir, "pre-push"));
  const hasPreCommitHook = existsSync(join(targetWorkspace, ".husky/pre-commit")) || existsSync(resolve(targetWorkspace, hooksDir, "pre-commit"));

  let linter = null;
  if (
    existsSync(join(targetWorkspace, "eslint.config.js")) ||
    existsSync(join(targetWorkspace, "eslint.config.mjs")) ||
    existsSync(join(targetWorkspace, "eslint.config.ts")) ||
    existsSync(join(targetWorkspace, "eslint.config.cjs")) ||
    existsSync(join(targetWorkspace, ".eslintrc.json")) ||
    existsSync(join(targetWorkspace, ".eslintrc.js")) ||
    existsSync(join(targetWorkspace, ".eslintrc"))
  ) {
    linter = "eslint";
  } else if (existsSync(join(targetWorkspace, "biome.json")) || existsSync(join(targetWorkspace, "biome.jsonc"))) {
    linter = "biome";
  }

  let testRunner = null;
  if (existsSync(join(targetWorkspace, "vitest.config.ts")) || existsSync(join(targetWorkspace, "vitest.config.js")) || existsSync(join(targetWorkspace, "vitest.config.mjs"))) {
    testRunner = "vitest";
  } else if (existsSync(join(targetWorkspace, "jest.config.js")) || existsSync(join(targetWorkspace, "jest.config.ts")) || existsSync(join(targetWorkspace, "jest.config.mjs"))) {
    testRunner = "jest";
  } else if (existsSync(join(targetWorkspace, "playwright.config.ts")) || existsSync(join(targetWorkspace, "playwright.config.js"))) {
    testRunner = "playwright";
  } else if (existsSync(join(targetWorkspace, "cypress.config.ts")) || existsSync(join(targetWorkspace, "cypress.config.js"))) {
    testRunner = "cypress";
  } else if (existsSync(join(targetWorkspace, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(targetWorkspace, "package.json"), "utf8"));
      if (pkg.scripts?.test?.includes("node --test")) {
        testRunner = "node:test";
      }
    } catch {}
  }

  return {
    packageManager,
    hasHusky,
    hasPrePushHook,
    hasPreCommitHook,
    linter,
    testRunner,
  };
}

// Module or CLI execution
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  // Current branch and status
  const currentBranch = git(["branch", "--show-current"]) || "";
  const statusOutput = git(["status", "--porcelain"], true) || "";
  const parsedStatus = statusOutput
    ? statusOutput
        .split(/\r?\n/)
        .map(parsePorcelainLine)
        .filter(Boolean)
    : [];
  const isDirty = parsedStatus.length > 0;
  const uncommittedFiles = parsedStatus.map((p) => p.file);

  const headRef = git(["symbolic-ref", "-q", "HEAD"]);
  const detached = headRef === null;

  // Remotes detection
  const remotesRaw = git(["remote"]) || "";
  const remotes = remotesRaw.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const knownRemotes = remotes.length > 0 ? remotes : ["origin"];

  // All branches (local & remote)
  const rawAllBranches = git(["branch", "-a", "--format=%(refname:short)"]) || "";
  const allBranches = rawAllBranches.split(/\r?\n/).map((b) => b.trim()).filter(Boolean);
  const localBranches = [];
  const remoteBranches = [];

  for (const b of allBranches) {
    if (knownRemotes.includes(b)) {
      // Short ref for refs/remotes/<remote>/HEAD is just the remote name (e.g. "origin"); not a local branch
      continue;
    }
    let isRemote = false;
    for (const remote of knownRemotes) {
      if (b.startsWith(`${remote}/`)) {
        isRemote = true;
        const stripped = b.slice(remote.length + 1);
        if (stripped !== "HEAD" && !stripped.includes(" -> ")) {
          remoteBranches.push(stripped);
        }
        break;
      }
    }
    if (!isRemote) {
      localBranches.push(b);
    }
  }
  const knownBranchSet = new Set([...localBranches, ...remoteBranches]);

  // Detect Default and Integration branches
  let defaultBranch = null;
  for (const remote of knownRemotes) {
    const symRef = git(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]);
    if (symRef) {
      defaultBranch = symRef.replace(new RegExp(`^refs/remotes/${remote}/`), "").trim();
      if (defaultBranch) break;
    }
  }
  if (!defaultBranch) {
    const configDefault = git(["config", "init.defaultBranch"]);
    if (configDefault && knownBranchSet.has(configDefault)) {
      defaultBranch = configDefault;
    }
  }
  if (!defaultBranch) {
    for (const candidate of ["main", "master", "trunk"]) {
      if (knownBranchSet.has(candidate)) {
        defaultBranch = candidate;
        break;
      }
    }
  }
  defaultBranch = defaultBranch || "main";

  let integrationBranch = defaultBranch;
  for (const candidate of ["develop", "development", "dev"]) {
    if (knownBranchSet.has(candidate)) {
      integrationBranch = candidate;
      break;
    }
  }

  // Dominant branch naming prefixes
  const reservedBranches = new Set(["main", "master", "trunk", "develop", "development", "dev", "HEAD", ...knownRemotes]);
  const prefixCounts = {};
  for (const b of knownBranchSet) {
    if (reservedBranches.has(b)) continue;
    const slash = b.indexOf("/");
    if (slash > 0) {
      const prefix = b.slice(0, slash);
      prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
    }
  }
  const dominantPrefixes = Object.entries(prefixCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([prefix]) => prefix);
  if (dominantPrefixes.length === 0) {
    dominantPrefixes.push("feature", "fix");
  }

  // Commit convention detection
  const rawLog = git(["log", "--no-merges", "--no-decorate", "--oneline", "-n", "25"]) || "";
  const commitSubjects = rawLog
    .split(/\r?\n/)
    .map((line) => {
      const space = line.indexOf(" ");
      return space === -1 ? "" : line.slice(space + 1).trim();
    })
    .filter(Boolean);

  let conventionalCount = 0;
  let ticketPrefixCount = 0;
  const CONVENTIONAL_RE = /^[a-z]+(?:\([A-Za-z0-9_.\-\\/]+\))?!?: /;
  const TICKET_PREFIX_RE = /^[A-Z][A-Z0-9]+-\d+\s*[:\-—]/;
  for (const sub of commitSubjects) {
    if (CONVENTIONAL_RE.test(sub)) conventionalCount++;
    else if (TICKET_PREFIX_RE.test(sub)) ticketPrefixCount++;
  }
  let suggestedCommitFormat = "{type}({TICKET-KEY}): short description";
  if (ticketPrefixCount > conventionalCount && ticketPrefixCount >= 5) {
    suggestedCommitFormat = "{TICKET-KEY}: short description";
  }

  // Project key detection (e.g. PROJ, CORE from branch names and commit subjects)
  const projectKeyCounts = {};
  const PROJECT_KEY_RE = /\b([A-Z][A-Z0-9]+)-\d+\b/g;
  for (const b of knownBranchSet) {
    let match;
    PROJECT_KEY_RE.lastIndex = 0;
    while ((match = PROJECT_KEY_RE.exec(b)) !== null) {
      const key = match[1];
      projectKeyCounts[key] = (projectKeyCounts[key] || 0) + 1;
    }
  }
  for (const sub of commitSubjects) {
    let match;
    PROJECT_KEY_RE.lastIndex = 0;
    while ((match = PROJECT_KEY_RE.exec(sub)) !== null) {
      const key = match[1];
      projectKeyCounts[key] = (projectKeyCounts[key] || 0) + 1;
    }
  }
  const detectedProjectKeys = Object.entries(projectKeyCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const ticketBranch = findBranch(ticket, integrationBranch, knownRemotes);
  const epicBranch = findBranch(epic, integrationBranch, knownRemotes);

  const result = {
    workspace,
    currentBranch,
    isDirty,
    uncommittedFiles,
    detached,
    defaultBranch,
    integrationBranch,
    detectedProjectKeys,
    branchNaming: {
      dominantPrefixes,
    },
    commitConvention: {
      suggestedFormat: suggestedCommitFormat,
    },
    vcsHost: detectVcsHost(knownRemotes),
    mrTemplate: findMrTemplate(workspace),
    project: detectProjectTooling(workspace),
    ticket: ticket ? { key: ticket, ...ticketBranch } : null,
    epic: epic ? { key: epic, ...epicBranch } : null,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

export {
  parsePorcelainLine,
  escapeRegex,
  checkIfMerged,
  findBranch,
  detectVcsHost,
  findMrTemplate,
  detectProjectTooling,
  git,
};
