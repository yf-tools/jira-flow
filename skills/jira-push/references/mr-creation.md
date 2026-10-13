# Merge / Pull Request Creation & CLI Guidelines

Step 5 prepares and creates the Merge Request on GitLab or Pull Request on GitHub.

## 1. MR Parameters (The Six Separate Fields)

Before opening the MR, present all 6 fields individually to the user and wait for confirmation. **Never merge Assignee and Reviewer into one line:**

1. **Target branch:** Must match the authoritative `{TARGET}` resolved in Step 0.
2. **Title:** Format with the ticket key and clear summary.
3. **Description:** Use the repository's template (`mrTemplate.content` from the scan). If `mrTemplate.content` is null, use the standard fallback template:

   ```markdown
   ## Summary
   {Brief summary of what this change achieves}

   ## Jira Ticket
   [{TICKET-KEY}](https://{site}.atlassian.net/browse/{TICKET-KEY})

   ## Changes
   - {Key change 1}
   - {Key change 2}

   ## Testing & Verification Evidence
   - [x] Diagnostics: {passed}
   - [x] Targeted Tests: {summary of tests run}
   - [x] Lint: {clean / fixed}
   - [ ] Smoke / UI Verification: {notes or n/a}
   ```

4. **Assignee:** Explicitly confirm the username with the user (e.g. current user username from VCS host identity or someone else). **Never assume or omit asking.** Note: GitLab does NOT assign the author by default unless `--assignee` is passed!
5. **Reviewer(s):** Resolved from recent MRs (see script below) or user input.
6. **Draft status:** Ask if this should be a Draft / WIP.

## 2. CLI Execution & Cross-OS Shell Safety

- **`glab_mr_*` MCP tools do not work:** Single-repo GitLab MCP tools (`glab_mr_create`, `glab_mr_view`, `glab_mr_list`) fail with `fatal: not a git repository` because the MCP server process lacks the repository working directory. Always use the `glab` CLI for MR operations.
- **Pass `--assignee` explicitly:** Always supply `--assignee "{assignee}"` (or `-a "{assignee}"`), otherwise GitLab leaves the MR unassigned.
- **Multi-line descriptions across OSes (Windows PowerShell / cmd / Linux bash):**
  Passing long markdown descriptions directly inside `--description "..."` on the command line frequently breaks on quotes, backticks, and newlines in Windows PowerShell and cmd. To prevent escaping errors:
  - Write the description to a temporary file (e.g. in the OS temp directory or `.git/MR_DESCRIPTION.md` if `.git` is a directory; note that in git worktrees `.git` is a file, so preferring `os.tmpdir()` or a `.tmp` file is safest).
  - For GitLab: pass `--description-file "{temp_file_path}"`.
  - For GitHub: pass `--body-file "{temp_file_path}"`.
  - Delete the temporary file after creation.

  **GitLab (`glab` CLI):**
  ```bash
  glab mr create --title "{title}" --description-file "{temp_file_path}" --target-branch "{target}" --assignee "{assignee}" --remove-source-branch --yes
  ```
  *(Or inline `--description "{description}"` for single-line text. If reviewers are set, append `--reviewer "{reviewer1},{reviewer2}"`)*

  **GitHub (`gh` CLI):**
  ```bash
  gh pr create --title "{title}" --body-file "{temp_file_path}" --base "{target}" --assignee "{assignee}"
  ```
  *(If reviewers are set, append `--reviewer "{reviewer1},{reviewer2}"`)*

- **Reviewer Resolution:** Query recent MR authors and reviewers via the helper script `node "<this-skill-dir>/scripts/reviewer-lookup.mjs" --workspace "<repo-path>" --query {name}` to resolve names or usernames accurately without missing external contributors.
