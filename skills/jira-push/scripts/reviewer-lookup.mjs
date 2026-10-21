#!/usr/bin/env node
/**
 * Fast reviewer lookup script for jira-push.
 * Resolves reviewer usernames from recent MRs/PRs via glab or gh CLI,
 * with fast VCS host routing and local git log collaborator fallback.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const query = (getArg("--query") || "").toLowerCase().trim();
const workspace = resolve(getArg("--workspace") || process.cwd());
const gitBin = process.env.GIT_PATH || "git";
const glabBin = process.env.GLAB_PATH || "glab";
const ghBin = process.env.GH_PATH || "gh";

function run(cmd, args, customWorkspace = workspace) {
  try {
    return execFileSync(cmd, args, {
      cwd: customWorkspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (err) {
    if (process.platform === "win32" && (err.code === "ENOENT" || err.code === "EINVAL")) {
      try {
        return execFileSync(cmd, args, {
          cwd: customWorkspace,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: true,
        }).trim();
      } catch {
        return null;
      }
    }
    return null;
  }
}

function detectVcsHost(customWorkspace = workspace) {
  let remoteUrl = run(gitBin, ["remote", "get-url", "origin"], customWorkspace) || "";
  if (!remoteUrl) {
    const remotes = (run(gitBin, ["remote"], customWorkspace) || "").split(/\r?\n/).filter(Boolean);
    for (const r of remotes) {
      remoteUrl = run(gitBin, ["remote", "get-url", r], customWorkspace) || "";
      if (remoteUrl) break;
    }
  }
  const lower = remoteUrl.toLowerCase();
  if (lower.includes("gitlab")) return "gitlab";
  if (lower.includes("github")) return "github";
  if (lower.includes("bitbucket")) return "bitbucket";
  return "unknown";
}

function recordUser(map, username, name) {
  if (!username) return;
  const cleanUsername = String(username).trim();
  const cleanName = name ? String(name).trim() : "";
  if (!cleanUsername) return;

  const key = cleanUsername.toLowerCase();
  if (!map.has(key)) {
    map.set(key, { username: cleanUsername, name: cleanName });
  } else if (!map.get(key).name && cleanName) {
    map.get(key).name = cleanName;
  }
}

function getCurrentUserIdentities(customWorkspace = workspace) {
  const set = new Set();
  const gitName = run(gitBin, ["config", "user.name"], customWorkspace);
  const gitEmail = run(gitBin, ["config", "user.email"], customWorkspace);
  if (gitName) set.add(gitName.toLowerCase().trim());
  if (gitEmail) {
    const cleanEmail = gitEmail.toLowerCase().trim();
    set.add(cleanEmail);
    if (cleanEmail.includes("@")) {
      set.add(cleanEmail.split("@")[0]);
    }
  }
  return set;
}

function fetchReviewers(customWorkspace = workspace, targetBranch = null) {
  const reviewerMap = new Map(); // lowercase key -> { username, name }
  const host = detectVcsHost(customWorkspace);

  // If target branch provided, prioritize contributors who modified the same files
  if (targetBranch) {
    const changedFilesRaw =
      run(gitBin, ["diff", `origin/${targetBranch}...HEAD`, "--name-only"], customWorkspace) ||
      run(gitBin, ["diff", `${targetBranch}...HEAD`, "--name-only"], customWorkspace) ||
      "";
    const changedFiles = changedFilesRaw
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    if (changedFiles.length > 0) {
      const blameLog = run(
        gitBin,
        ["log", "-n", "20", "--format=%an|%ae", "--", ...changedFiles.slice(0, 10)],
        customWorkspace
      );
      if (blameLog) {
        for (const line of blameLog.split(/\r?\n/)) {
          const parts = line.split("|");
          const name = parts[0]?.trim();
          const email = parts[1]?.trim();
          if (name) {
            const username = email && email.includes("@") ? email.split("@")[0] : name.toLowerCase().replace(/\s+/g, ".");
            recordUser(reviewerMap, username, name);
          }
        }
      }
    }
  }

  // If host is GitLab (or unknown), query glab
  if (host === "gitlab" || host === "unknown") {
    const glabOutput = run(glabBin, ["mr", "list", "--all", "-n", "15", "--output", "json"], customWorkspace);
    if (glabOutput) {
      try {
        const mrs = JSON.parse(glabOutput);
        if (Array.isArray(mrs)) {
          for (const mr of mrs) {
            if (mr.author?.username) recordUser(reviewerMap, mr.author.username, mr.author.name);
            if (Array.isArray(mr.reviewers)) {
              for (const r of mr.reviewers) if (r?.username) recordUser(reviewerMap, r.username, r.name);
            }
            if (Array.isArray(mr.assignees)) {
              for (const a of mr.assignees) if (a?.username) recordUser(reviewerMap, a.username, a.name);
            }
          }
        }
      } catch {}
    }
  }

  // If host is GitHub (or unknown without glab results), query gh
  if ((host === "github" || (host === "unknown" && reviewerMap.size === 0))) {
    const ghOutput = run(ghBin, ["pr", "list", "--state", "all", "--limit", "15", "--json", "author,reviewRequests,assignees"], customWorkspace);
    if (ghOutput) {
      try {
        const prs = JSON.parse(ghOutput);
        if (Array.isArray(prs)) {
          for (const pr of prs) {
            if (pr.author?.login) recordUser(reviewerMap, pr.author.login, pr.author.name);
            if (Array.isArray(pr.reviewRequests)) {
              for (const r of pr.reviewRequests) {
                if (r?.login) recordUser(reviewerMap, r.login, r.name);
                else if (r?.slug) recordUser(reviewerMap, r.slug, r.name);
              }
            }
            if (Array.isArray(pr.assignees)) {
              for (const a of pr.assignees) if (a?.login) recordUser(reviewerMap, a.login, a.name);
            }
          }
        }
      } catch {}
    }
  }

  // Fallback: If network CLIs returned nothing or are unavailable/offline,
  // query recent git committers from local history
  if (reviewerMap.size === 0) {
    const logOutput = run(gitBin, ["log", "-n", "30", "--format=%an|%ae"], customWorkspace);
    if (logOutput) {
      for (const line of logOutput.split(/\r?\n/)) {
        const parts = line.split("|");
        const name = parts[0]?.trim();
        const email = parts[1]?.trim();
        if (name) {
          const username = email && email.includes("@") ? email.split("@")[0] : name.toLowerCase().replace(/\s+/g, ".");
          recordUser(reviewerMap, username, name);
        }
      }
    }
  }

  return reviewerMap;
}

function findReviewers(reviewerMap, q) {
  const queryStr = (q || "").toLowerCase().trim();
  const queryTokens = queryStr.split(/\s+/).filter(Boolean);
  const matching = [];

  for (const { username, name } of reviewerMap.values()) {
    if (!queryStr) {
      matching.push({ username, name });
      continue;
    }
    const uLower = username.toLowerCase();
    const nLower = (name || "").toLowerCase();

    const directMatch = uLower.includes(queryStr) || (nLower && nLower.includes(queryStr));
    const tokenMatch = queryTokens.length > 1 && queryTokens.every((token) => uLower.includes(token) || nLower.includes(token));

    if (directMatch || tokenMatch) {
      matching.push({ username, name });
    }
  }

  return {
    candidates: matching.map((m) => m.username),
    details: matching.map((m) => ({ username: m.username, name: m.name || null })),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const target = getArg("--target");
  const reviewerMap = fetchReviewers(workspace, target);
  let { candidates, details } = findReviewers(reviewerMap, query);

  // If query is empty (default suggestions), exclude self so author is not recommended as own reviewer
  if (!query) {
    const selfIdentities = getCurrentUserIdentities(workspace);
    candidates = candidates.filter((u) => !selfIdentities.has(u.toLowerCase()));
    details = details.filter((d) => !selfIdentities.has(d.username.toLowerCase()) && (!d.name || !selfIdentities.has(d.name.toLowerCase())));
  }

  process.stdout.write(
    JSON.stringify(
      {
        query,
        candidates,
        details,
      },
      null,
      2
    ) + "\n"
  );
}

export {
  fetchReviewers,
  findReviewers,
  detectVcsHost,
  getCurrentUserIdentities,
  recordUser,
  run,
};
