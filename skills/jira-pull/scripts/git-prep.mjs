#!/usr/bin/env node
/**
 * Fast deterministic git inspection for jira-pull.
 * Runs in a single process turn without multi-step shell latency.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const workspace = resolve(getArg("--workspace") || process.cwd());
const ticket = getArg("--ticket");
const epic = getArg("--epic");
const gitBin = process.env.GIT_PATH || "git";

function git(args) {
  try {
    return execFileSync(gitBin, args, {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

const currentBranch = git(["branch", "--show-current"]) || "";
const statusOutput = git(["status", "--porcelain"]) || "";
const isDirty = statusOutput.length > 0;
const uncommittedFiles = isDirty
  ? statusOutput
      .split(/\r?\n/)
      .map((l) => l.trim().slice(3))
      .filter(Boolean)
  : [];

const headRef = git(["symbolic-ref", "-q", "HEAD"]);
const detached = headRef === null;

const rawAllBranches = git(["branch", "-a", "--format=%(refname:short)"]) || "";
const allBranches = rawAllBranches.split(/\r?\n/).map((b) => b.trim()).filter(Boolean);
const localBranches = [];
const remoteBranches = [];
for (const b of allBranches) {
  if (b.startsWith("origin/")) {
    const stripped = b.replace(/^origin\//, "");
    if (stripped !== "HEAD") remoteBranches.push(stripped);
  } else {
    localBranches.push(b);
  }
}
const knownBranchSet = new Set([...localBranches, ...remoteBranches]);

// Detect Default and Integration branches
let defaultBranch = null;
const symRef = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
if (symRef) {
  defaultBranch = symRef.replace(/^refs\/remotes\/origin\//, "").trim();
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
const reservedBranches = new Set(["main", "master", "trunk", "develop", "development", "dev", "HEAD"]);
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
const CONVENTIONAL_RE = /^[a-z]+(?:\([A-Za-z0-9_.\-\/]+\))?!?: /;
const TICKET_PREFIX_RE = /^[A-Z][A-Z0-9]+-\d+\s*[:\-—]/;
for (const sub of commitSubjects) {
  if (CONVENTIONAL_RE.test(sub)) conventionalCount++;
  else if (TICKET_PREFIX_RE.test(sub)) ticketPrefixCount++;
}
let suggestedCommitFormat = "{type}({TICKET-KEY}): short description";
if (ticketPrefixCount > conventionalCount && ticketPrefixCount >= 5) {
  suggestedCommitFormat = "{TICKET-KEY}: short description";
}

function checkIfMerged(branchRef, targetRef) {
  if (!branchRef || !targetRef) return false;
  const candidatesBranch = [branchRef, `origin/${branchRef}`];
  const candidatesTarget = [`origin/${targetRef}`, targetRef];
  for (const b of candidatesBranch) {
    for (const t of candidatesTarget) {
      try {
        execFileSync(gitBin, ["merge-base", "--is-ancestor", b, t], {
          cwd: workspace,
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: true,
        });
        return true;
      } catch {
        // Not ancestor or ref missing
      }
    }
  }
  return false;
}

function findBranch(key, targetBranch) {
  if (!key) return { exists: false, local: false, remote: false, name: null, isMergedIntoTarget: false };
  const raw = git(["branch", "-a", "--list", `*${key}*`]) || "";
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/^\*?\s+/, "").trim()).filter(Boolean);
  if (lines.length === 0) return { exists: false, local: false, remote: false, name: null, isMergedIntoTarget: false };
  const local = lines.find((b) => !b.startsWith("remotes/"));
  const remote = lines.find((b) => b.startsWith("remotes/"));
  const branchName = local || (remote ? remote.replace(/^remotes\/[^/]+\//, "") : lines[0]);
  const isMerged = checkIfMerged(branchName, targetBranch);
  return {
    exists: true,
    local: Boolean(local),
    remote: Boolean(remote),
    name: branchName,
    isMergedIntoTarget: isMerged,
    mergedInto: isMerged ? targetBranch : null,
  };
}

const ticketBranch = findBranch(ticket, integrationBranch);
const epicBranch = findBranch(epic, integrationBranch);

const result = {
  workspace,
  currentBranch,
  isDirty,
  uncommittedFiles,
  detached,
  defaultBranch,
  integrationBranch,
  branchNaming: {
    dominantPrefixes,
  },
  commitConvention: {
    suggestedFormat: suggestedCommitFormat,
  },
  ticket: ticket ? { key: ticket, ...ticketBranch } : null,
  epic: epic ? { key: epic, ...epicBranch } : null,
};

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
