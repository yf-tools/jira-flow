# Self-Review Checklist Discovery

Before handing work back to the user at Step 10, Step 9.6 searches for repository-specific code review checklists to verify implementation quality before proposing wrap-up.

## Heuristic: Discovery by Description, Not Filename

Checklists are named inconsistently across teams:

- `pre-flight.md`
- `definition-of-done.md`
- `code-review-self.md`
- `.kiro/steering/review-checklist.md`
- `.github/instructions/review.md`

### Search Rules

1. **Check existing rules and instruction files:** Look into AI instruction directories and files (`.cursor/rules/`, `.cursorrules`, `.windsurfrules`, `.claude/rules/`, `.agents/rules/`, `.kiro/steering/`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`).
2. **Judge by description:** Read the header or description of candidate files. If a file describes itself as containing review rules, coding quality gates, or pre-commit checklists, select it.
3. **Offer, don't silently enforce:** Present found checklists to the user:
   > "Found review checklist in `{path}` ({description}). Would you like me to run through it against the changed files before we conclude setup?"
