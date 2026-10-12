#!/usr/bin/env node
/**
 * Fast reviewer lookup script for jira-push.
 * Resolves reviewer usernames from recent MRs/PRs via glab or gh CLI.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const query = (getArg("--query") || "").toLowerCase();
const workspace = resolve(getArg("--workspace") || process.cwd());

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

const reviewers = new Set();

// Try glab
const glabOutput = run("glab", ["mr", "list", "--all", "-n", "15", "--output", "json"]);
if (glabOutput) {
  try {
    const mrs = JSON.parse(glabOutput);
    for (const mr of mrs) {
      if (mr.author?.username) reviewers.add(mr.author.username);
      if (Array.isArray(mr.reviewers)) {
        for (const r of mr.reviewers) if (r.username) reviewers.add(r.username);
      }
      if (Array.isArray(mr.assignees)) {
        for (const a of mr.assignees) if (a.username) reviewers.add(a.username);
      }
    }
  } catch {}
}

// Try gh if glab returned nothing
if (reviewers.size === 0) {
  const ghOutput = run("gh", ["pr", "list", "--state", "all", "--limit", "15", "--json", "author,reviewRequests,assignees"]);
  if (ghOutput) {
    try {
      const prs = JSON.parse(ghOutput);
      for (const pr of prs) {
        if (pr.author?.login) reviewers.add(pr.author.login);
        if (Array.isArray(pr.reviewRequests)) {
          for (const r of pr.reviewRequests) if (r.login) reviewers.add(r.login);
        }
        if (Array.isArray(pr.assignees)) {
          for (const a of pr.assignees) if (a.login) reviewers.add(a.login);
        }
      }
    } catch {}
  }
}

const list = [...reviewers].filter((u) => !query || u.toLowerCase().includes(query));

process.stdout.write(JSON.stringify({ query, candidates: list }, null, 2) + "\n");
