# Team Setup & Installation Guide (JiraFlow)

This guide walks you through setting up **JiraFlow** on your machine in 5 minutes. Once installed, it automates your entire Jira ticket lifecycle (`jira-create` to standardize tickets, `jira-pull` to onboard, and `jira-push` to commit and open Merge Requests).

---

## 1. Prerequisites Checklist

Before using JiraFlow, verify that the following tools are installed:

| Tool | Minimum Version | Check Command | Installation |
| :--- | :---: | :--- | :--- |
| **Git** | Any modern version | `git --version` | Standard install / pre-installed |
| **Node.js** | `v18.0.0+` | `node -v` | [nodejs.org](https://nodejs.org/) |
| **GitLab CLI (`glab`)** | `v1.30+` | `glab --version` | `winget` (Win) / `brew` (Mac) / `apt` (Linux) *(If using GitLab)* |
| **GitHub CLI (`gh`)** | `v2.20+` | `gh --version` | `winget` (Win) / `brew` (Mac) / `apt` (Linux) *(If using GitHub)* |
| **Atlassian MCP** | — | Configured in IDE | See Step 3 below |

> [!NOTE]
> You do **not** need the GitLab or GitHub MCP servers. JiraFlow uses the official `glab` and `gh` CLIs directly to ensure full repository context without working-directory restrictions.

---

## 2. Authenticate Git Host CLI (`glab` or `gh`)

JiraFlow uses `glab` or `gh` to inspect MRs/PRs, push branches, and create merge requests.

### If using GitLab

1. Open your terminal and run:

   ```bash
   glab auth login
   ```

2. Follow the interactive prompts:
   - **GitLab instance:** Choose `gitlab.com` or enter your company's self-hosted domain (e.g. `gitlab.company.com`).
   - **Authentication method:** Select **Token**.
   - **Token:** Paste a GitLab Personal Access Token (create one in GitLab under *User Settings* → *Access Tokens* with scopes: `api`, `read_user`, `write_repository`).
3. Verify authentication:

   ```bash
   glab auth status
   ```

### If using GitHub

1. Open your terminal and run:

   ```bash
   gh auth login
   ```

2. Follow the interactive prompts to log in via browser or token.
3. Verify authentication:

   ```bash
   gh auth status
   ```

---

## 3. Configure Atlassian MCP (Jira)

JiraFlow connects to your Jira board via the official Atlassian Remote MCP server.

Add the `atlassian-mcp` definition to your IDE's MCP settings (e.g. Antigravity, Kiro, Claude Code, Cursor, or VS Code):

```json
{
  "mcpServers": {
    "atlassian-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.atlassian.com/v1/mcp",
        "--transport",
        "http-first"
      ]
    }
  }
}
```

> [!TIP]
>
> - The first time this server runs, a browser window will open asking you to sign in to your Atlassian account and authorize access. No manual API tokens or passwords needed.
> - **Windows Note:** If your IDE reports `'npx' is not recognized` or fails to spawn the command, change `"command": "npx"` to `"command": "npx.cmd"`.
> - For official IDE setup guides across Cursor, VS Code, and others, refer to the [Official Atlassian MCP Documentation](https://support.atlassian.com/jira-software-cloud/docs/use-atlassian-mcp-server-with-an-ide/).

---

## 4. Install JiraFlow

### Option A: In Antigravity

Copy the `jira-flow` directory into your personal plugin configuration folder:

- **Windows:**

  ```text
  %USERPROFILE%\.gemini\config\plugins\jira-flow
  ```

- **macOS / Linux:**

  ```text
  ~/.gemini/config/plugins/jira-flow
  ```

Or use the Plugins Manager UI in Antigravity to add the folder directly.

### Option B: In Kiro

In Kiro's Powers panel:

- Click **Add power from folder** (or clone the repository locally).
- Select the `jira-flow` directory.

### Option C: In Claude Code

Load the entire plugin directory or copy the skills:

- **Load directly (recommended):**
  - Run with `claude --plugin-dir <path-to-jira-flow>`
- **Global Skills Directory:**
  - Windows: `%USERPROFILE%\.claude\skills\` (copy `jira-create`, `jira-pull`, and `jira-push` folders)
  - macOS / Linux: `~/.claude/skills/` (copy `jira-create`, `jira-pull`, and `jira-push` folders)
- **Project-Specific Directory:**
  - Copy `skills/jira-create`, `skills/jira-pull`, and `skills/jira-push` into `.claude/skills/` within your project repository.

### Option D: In Cursor / Windsurf / VS Code

- Copy the `jira-flow` folder into your project root or reference `skills/jira-create/SKILL.md`, `skills/jira-pull/SKILL.md`, and `skills/jira-push/SKILL.md` from your `.cursorrules`, `.windsurfrules`, or `AGENTS.md`.

---

## 5. Built-in Preflight Diagnostic Script

Before starting your first ticket, run the diagnostic check in your terminal:

```bash
npm run preflight
```

*(or `node preflight.mjs --repo .`)*

This verifies:

- ✅ Node.js runtime version (`>= 18`)
- ✅ Git installation & repository validity
- ✅ GitLab (`glab`) or GitHub (`gh`) CLI authentication
- ✅ Atlassian / Jira MCP configuration in your IDE
- ✅ Bundled helper scripts (`git-prep`, `pre-push-check`, `reviewer-lookup`)

---

## 6. Verify Your Setup (Zero-Risk Dry Run)

To confirm everything is working without touching real Git branches or Jira statuses, run a test dry run in your chat:

```text
/jira-pull <YOUR-TICKET-KEY> --dry-run
```

*(Example: `/jira-pull PROJ-101 --dry-run` or paste your ticket URL with `--dry-run`)*

### What you should see

1. The AI fetches the ticket details from Jira.
2. An interactive question modal (or clean numbered list) pops up asking:
   - Branch setup (clean short branch `feature/PROJ-101`)
   - Assignee & status move
   - Original estimate
3. You select your options (or type a custom answer).
4. A **`[Dry-Run Summary]`** prints out, confirming setup is complete. **No Git branches are modified, and no Jira updates are made.**

If the dry run completes successfully, your environment is 100% ready for daily production use!
