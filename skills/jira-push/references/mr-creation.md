# Merge / Pull Request Creation & CLI Guidelines

Step 5 prepares and creates the Merge Request on GitLab or Pull Request on GitHub.

## 1. MR Parameters (The Six Separate Fields)

Before opening the MR, present all 6 fields individually to the user and wait for confirmation. **Never merge Assignee and Reviewer into one line:**

1. **Target branch:** Must match the authoritative `{TARGET}` resolved in Step 0.
2. **Title:** Format with the ticket key and clear summary.
3. **Description:** Use the repository's template (`mrTemplate.content` from the scan). Fill in Summary, Testing evidence, and check off completed items.
4. **Assignee:** Explicitly confirm the username with the user (e.g. current user username from VCS host identity or someone else). **Never assume or omit asking.** Note: GitLab does NOT assign the author by default unless `--assignee` is passed!
5. **Reviewer(s):** Resolved from recent MRs (see script below) or user input.
6. **Draft status:** Ask if this should be a Draft / WIP.

## 2. CLI Execution vs MCP Gotchas

- **`glab_mr_*` MCP tools do not work:** Single-repo GitLab MCP tools (`glab_mr_create`, `glab_mr_view`, `glab_mr_list`) fail with `fatal: not a git repository` because the MCP server process lacks the repository working directory. Always use the `glab` CLI for MR operations.
- **Pass `--assignee` explicitly:** Always supply `--assignee "{assignee}"` (or `-a "{assignee}"`), otherwise GitLab leaves the MR unassigned.

  ```bash
  glab mr create --title "{title}" --description "{description}" --target-branch "{target}" --assignee "{assignee}" --remove-source-branch --yes
  ```

  If reviewers are set, also add `--reviewer "{reviewer1},{reviewer2}"`.
- **Reviewer Resolution:** Query recent MR authors and reviewers via the helper script `node "<this-skill-dir>/scripts/reviewer-lookup.mjs" --workspace "<repo-path>" --query {name}` to resolve names to usernames accurately without missing external contributors.
- **GitHub (`gh` CLI):**

  ```bash
  gh pr create --title "{title}" --body "{description}" --base "{target}" --assignee "{assignee}"
  ```
