#!/usr/bin/env node
/**
 * Fast deterministic pre-push git inspection for jira-push.
 * Inspects staged files, status, and potential secret files in a single turn.
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
const target = getArg("--target") || "HEAD~1";
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
  const rawStatus = m[1];
  let filePath = m[2].trim();
  if ((rawStatus.includes("R") || rawStatus.includes("C")) && filePath.includes(" -> ")) {
    filePath = filePath.split(" -> ")[1].trim();
  }
  filePath = filePath.replace(/^"(.*)"$/, "$1");
  return { status: rawStatus, file: filePath };
}

// Case-insensitive file existence helper for Linux/macOS/Windows
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
            const rel = `${parent}/${child}/${defaultFile}`.replace(/\\/g, "/");
            const content = readFileSync(join(dirPath, defaultFile), "utf8");
            return { path: rel, content };
          }
        } catch {}
      }
    }
  }

  return { path: null, content: null };
}

// VCS host detection
function detectVcsHost(remotes = ["origin"], customWorkspace = workspace) {
  const remoteList = Array.isArray(remotes) && remotes.length > 0 ? remotes : ["origin"];
  let remoteUrl = "";
  for (const r of remoteList) {
    remoteUrl = git(["remote", "get-url", r], false, customWorkspace) || git(["config", `remote.${r}.url`], false, customWorkspace) || "";
    if (remoteUrl) break;
  }
  const lowerUrl = remoteUrl.toLowerCase();
  if (lowerUrl.includes("gitlab")) return { type: "gitlab", cli: "glab", remoteUrl };
  if (lowerUrl.includes("github")) return { type: "github", cli: "gh", remoteUrl };
  if (lowerUrl.includes("bitbucket")) return { type: "bitbucket", cli: null, remoteUrl };
  return { type: "unknown", cli: null, remoteUrl };
}

// Precision secret detection: flags true sensitive credentials, keys, and tokens
// while avoiding false-positives on source code, design systems, and documentation.
const SAFE_PATTERNS = [
  /\.(example|sample|template|dist|default)($|\.)/i,
  /(^|[/\\])(example|mock|stub|fixture)[-_a-zA-Z0-9]*\./i,
  /\.(spec|test)\.[a-zA-Z0-9]+$/i,
];

// Standard source code extensions that must NOT be flagged as secrets unless specifically key/cert files
const SOURCE_CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "java", "go", "rs", "c", "cpp", "h", "hpp",
  "cs", "php", "rb", "swift", "kt", "kts", "dart", "vue", "svelte", "scss", "css", "less",
  "html", "md", "mdx", "graphql", "sql", "proto"
]);

function isSuspiciousFile(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() || "";

  // 1. Immediately safe if matches safe patterns
  if (SAFE_PATTERNS.some((p) => p.test(normalized))) return false;

  // 2. Sensitive environment and config files
  if (/^\.env($|\.[^/\\]+$)/i.test(basename)) {
    // Flag .env, .env.local, .env.production, etc.
    return true;
  }

  // 3. Private SSH and cryptographic keys / certs
  if (/(^|[/\\])(id_rsa|id_dsa|id_ecdsa|id_ed25519)($|\.)/i.test(normalized)) {
    return true;
  }
  if (/\.(pem|pkcs12|pfx|p12|key|keystore|jks|kdbx)$/i.test(basename)) {
    return true;
  }

  // 4. Dotfiles containing auth or package credentials
  if (/(^|[/\\])\.(npmrc|pypirc|netrc|htpasswd)$/i.test(normalized)) {
    return true;
  }

  // 5. Exclude standard source code and documentation from generic word scans
  const ext = basename.includes(".") ? basename.split(".").pop().toLowerCase() : "";
  if (SOURCE_CODE_EXTENSIONS.has(ext)) {
    return false;
  }

  // 6. Dedicated credential/secret/token data and config files
  const isDataConfigExt = /\.(json|ya?ml|xml|ini|conf|config|txt|properties)$/i.test(basename);
  if (isDataConfigExt) {
    if (/(^|[-_])(client[-_]secret|service[-_]account|credentials?|secrets?)([-_]|\.|$)/i.test(basename)) {
      return true;
    }
    if (/^(auth_token|token|tokens|private_key)\.(json|ya?ml|txt)$/i.test(basename)) {
      return true;
    }
  }

  return false;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  // Remotes detection
  const remotesRaw = git(["remote"]) || "";
  const remotes = remotesRaw.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const knownRemotes = remotes.length > 0 ? remotes : ["origin"];

  const stagedFilesRaw = git(["diff", "--cached", "--name-only"]) || "";
  const stagedFiles = stagedFilesRaw
    ? stagedFilesRaw
        .split(/\r?\n/)
        .map((f) => f.trim().replace(/^"(.*)"$/, "$1"))
        .filter(Boolean)
    : [];
  const stagedStat = git(["diff", "--cached", "--stat"]) || "";

  const statusRaw = git(["status", "--porcelain"], true) || "";
  const unstagedFiles = [];
  const untrackedFiles = [];

  for (const line of statusRaw.split(/\r?\n/)) {
    const parsed = parsePorcelainLine(line);
    if (!parsed) continue;
    let indexStatus = " ";
    let workStatus = " ";
    if (parsed.status.length === 2) {
      indexStatus = parsed.status[0];
      workStatus = parsed.status[1];
    } else if (parsed.status.length === 1) {
      workStatus = parsed.status[0];
    }

    if (indexStatus === "?" && workStatus === "?") {
      untrackedFiles.push(parsed.file);
    } else if (workStatus !== " ") {
      unstagedFiles.push(parsed.file);
    }
  }

  // Compute diff stat against target branch across all configured remotes
  let targetDiffStat = "";
  if (target && target !== "HEAD~1") {
    for (const r of knownRemotes) {
      targetDiffStat = git(["diff", `${r}/${target}...HEAD`, "--stat"]);
      if (targetDiffStat) break;
    }
    if (!targetDiffStat) {
      targetDiffStat = git(["diff", `${target}...HEAD`, "--stat"]) || "";
    }
  } else {
    targetDiffStat = git(["diff", "HEAD~1...HEAD", "--stat"]) || "";
  }

  const allCheckFiles = new Set([...stagedFiles, ...unstagedFiles, ...untrackedFiles]);
  const suspiciousFiles = [...allCheckFiles].filter(isSuspiciousFile);

  const result = {
    hasStagedChanges: stagedFiles.length > 0,
    stagedFiles,
    stagedStat,
    unstagedFiles,
    untrackedFiles,
    targetDiffStat,
    suspiciousFiles,
    vcsHost: detectVcsHost(knownRemotes),
    mrTemplate: findMrTemplate(workspace),
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

export {
  parsePorcelainLine,
  findMrTemplate,
  detectVcsHost,
  isSuspiciousFile,
  git,
};
