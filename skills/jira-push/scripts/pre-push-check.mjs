#!/usr/bin/env node
/**
 * Fast deterministic pre-push git inspection for jira-push.
 * Inspects staged files, status, and potential secret files in a single turn.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const workspace = resolve(getArg("--workspace") || process.cwd());
const target = getArg("--target") || "HEAD~1";
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

const stagedStat = git(["diff", "--cached", "--stat"]) || "";
const stagedFilesRaw = git(["diff", "--cached", "--name-only"]) || "";
const stagedFiles = stagedFilesRaw ? stagedFilesRaw.split(/\r?\n/).filter(Boolean) : [];

const statusRaw = git(["status", "--porcelain"]) || "";
const unstagedFiles = [];
const untrackedFiles = [];

for (const line of statusRaw.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const indexStatus = line[0];
  const workStatus = line[1];
  const file = line.slice(3).trim();
  if (indexStatus === "?" && workStatus === "?") {
    untrackedFiles.push(file);
  } else if (workStatus !== " ") {
    unstagedFiles.push(file);
  }
}

const targetDiffStat = git(["diff", `origin/${target}...HEAD`, "--stat"]) || git(["diff", `${target}...HEAD`, "--stat"]) || "";

const SECRET_PATTERNS = [/\.env($|\.)/i, /id_rsa/i, /\.pem$/i, /secret/i, /credential/i, /token/i];
const suspiciousFiles = [...stagedFiles, ...untrackedFiles].filter((f) => SECRET_PATTERNS.some((p) => p.test(f)));

const result = {
  hasStagedChanges: stagedFiles.length > 0,
  stagedFiles,
  stagedStat,
  unstagedFiles,
  untrackedFiles,
  targetDiffStat,
  suspiciousFiles,
};

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
