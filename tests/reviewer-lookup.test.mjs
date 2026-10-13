import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  findReviewers,
  recordUser,
} from "../skills/jira-push/scripts/reviewer-lookup.mjs";

const scriptPath = resolve("skills/jira-push/scripts/reviewer-lookup.mjs");

test("reviewer-lookup.mjs CLI executes successfully and outputs valid JSON", () => {
  const stdout = execFileSync("node", [scriptPath, "--workspace", process.cwd(), "--query", "youssef"], {
    encoding: "utf8",
  });
  const data = JSON.parse(stdout);

  assert.strictEqual(data.query, "youssef");
  assert.ok(Array.isArray(data.candidates));
  assert.ok(Array.isArray(data.details));
  // In this git repo, youssef is a committer, so local collaborator fallback finds it
  assert.ok(data.candidates.includes("youssefathalla"));
});

test("findReviewers matching logic resolves display names and usernames", () => {
  const userMap = new Map();
  recordUser(userMap, "jdoe", "John Doe");
  recordUser(userMap, "asmith", "Alice Smith");
  recordUser(userMap, "bwayne", "Bruce Wayne");

  // Exact username
  assert.deepStrictEqual(findReviewers(userMap, "jdoe").candidates, ["jdoe"]);

  // Full name
  assert.deepStrictEqual(findReviewers(userMap, "John Doe").candidates, ["jdoe"]);

  // Partial first name
  assert.deepStrictEqual(findReviewers(userMap, "Alice").candidates, ["asmith"]);

  // Token reversed
  assert.deepStrictEqual(findReviewers(userMap, "Wayne Bruce").candidates, ["bwayne"]);

  // Non-matching
  assert.deepStrictEqual(findReviewers(userMap, "Clark Kent").candidates, []);

  // Empty query returns all
  assert.strictEqual(findReviewers(userMap, "").candidates.length, 3);
});

test("recordUser deduplicates usernames case-insensitively", () => {
  const userMap = new Map();
  recordUser(userMap, "JDoe", "John Doe");
  recordUser(userMap, "jdoe", "Johnathan Doe");

  assert.strictEqual(userMap.size, 1);
  assert.strictEqual(userMap.get("jdoe").username, "JDoe");
});
