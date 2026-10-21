import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  parsePorcelainLine,
  isSuspiciousFile,
} from "../skills/jira-push/scripts/pre-push-check.mjs";

const scriptPath = resolve("skills/jira-push/scripts/pre-push-check.mjs");

test("pre-push-check.mjs CLI executes successfully and outputs valid JSON", () => {
  const stdout = execFileSync("node", [scriptPath, "--workspace", process.cwd(), "--target", "main"], {
    encoding: "utf8",
  });
  const data = JSON.parse(stdout);

  assert.ok(typeof data.hasStagedChanges === "boolean");
  assert.ok(Array.isArray(data.stagedFiles));
  assert.ok(typeof data.stagedStat === "string");
  assert.ok(Array.isArray(data.unstagedFiles));
  assert.ok(Array.isArray(data.untrackedFiles));
  assert.ok(Array.isArray(data.unpushedCommits));
  assert.ok(typeof data.behindTargetCount === "number");
  assert.ok(typeof data.aheadTargetCount === "number");
  assert.ok(typeof data.targetDiffStat === "string");
  assert.ok(Array.isArray(data.suspiciousFiles));
  assert.ok(data.vcsHost && typeof data.vcsHost.type === "string");
  assert.ok("mrTemplate" in data);
});

test("isSuspiciousFile flags real sensitive files", () => {
  // Sensitive environment files
  assert.strictEqual(isSuspiciousFile(".env"), true);
  assert.strictEqual(isSuspiciousFile(".env.local"), true);
  assert.strictEqual(isSuspiciousFile(".env.production"), true);
  assert.strictEqual(isSuspiciousFile("backend/.env.staging"), true);

  // Private cryptographic keys & certs
  assert.strictEqual(isSuspiciousFile("id_rsa"), true);
  assert.strictEqual(isSuspiciousFile("id_ed25519"), true);
  assert.strictEqual(isSuspiciousFile("certs/server.pem"), true);
  assert.strictEqual(isSuspiciousFile("keys/app.p12"), true);
  assert.strictEqual(isSuspiciousFile("release.keystore"), true);

  // Dedicated credential and secret config files
  assert.strictEqual(isSuspiciousFile("config/client_secret.json"), true);
  assert.strictEqual(isSuspiciousFile("credentials.xml"), true);
  assert.strictEqual(isSuspiciousFile("secrets.yaml"), true);
  assert.strictEqual(isSuspiciousFile("service-account-key.json"), true);
  assert.strictEqual(isSuspiciousFile(".npmrc"), true);
  assert.strictEqual(isSuspiciousFile(".netrc"), true);
  assert.strictEqual(isSuspiciousFile("token.txt"), true);
});

test("isSuspiciousFile does NOT flag safe example files or regular source code", () => {
  // Examples, templates, and mocks
  assert.strictEqual(isSuspiciousFile(".env.example"), false);
  assert.strictEqual(isSuspiciousFile(".env.sample"), false);
  assert.strictEqual(isSuspiciousFile(".env.template"), false);
  assert.strictEqual(isSuspiciousFile(".env.dist"), false);
  assert.strictEqual(isSuspiciousFile("example-config.json"), false);
  assert.strictEqual(isSuspiciousFile("fixtures/mock_credentials.json"), false);

  // Standard source code files with "token", "credential", or "secret" in their name
  // (CRITICAL: These were previously false-flagged by unanchored regexes)
  assert.strictEqual(isSuspiciousFile("src/components/TokenList.tsx"), false);
  assert.strictEqual(isSuspiciousFile("src/hooks/useAuthToken.ts"), false);
  assert.strictEqual(isSuspiciousFile("src/auth/TokenProvider.ts"), false);
  assert.strictEqual(isSuspiciousFile("services/credentialService.ts"), false);
  assert.strictEqual(isSuspiciousFile("controllers/secretController.py"), false);
  assert.strictEqual(isSuspiciousFile("styles/tokens.scss"), false);
  assert.strictEqual(isSuspiciousFile("docs/tokens.md"), false);
  assert.strictEqual(isSuspiciousFile("pkg/auth/token_test.go"), false);
  assert.strictEqual(isSuspiciousFile("SecretManager.java"), false);
});
