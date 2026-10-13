# Jira Ticket Standards & Issue Templates

Quality tickets prevent miscommunication, reduce review cycles, and provide immediate clarity for QA and team members.

---

## 1. Summary (Title) Conventions

A good summary is concise, active, and identifies the affected area:

- **Format:** `[Component/Area] Short, active description of issue or goal`
- **Good Bug Example:** `[Auth] Login button does not respond on Safari mobile`
- **Good Task Example:** `[Billing] Upgrade Stripe SDK to v14 and migrate webhook handlers`
- **Avoid:** Generic titles like *"Fix bug"*, *"Button issue"*, *"Update backend"*.

---

## 2. Standard Issue Templates

### Template A: Bug Report

Use when reporting unexpected behavior, broken functionality, regression, or UI defect.

```markdown
## Summary / Problem
Briefly describe the defect and its impact.

## Steps to Reproduce
1. Navigate to '...'
2. Perform action '...'
3. Observe '...'

## Expected vs Actual Behavior
- **Expected:** Describe what should happen.
- **Actual:** Describe what actually happens.

## Environment & Context
- Component / Module: `<affected path or area>`
- Branch / Version: `<current branch or commit>`
- OS / Browser (if applicable): `<e.g. Chrome 120 / iOS Safari>`
- Error Logs / Stack Trace:
  ```text
  <paste relevant console or server log error>
  ```

## Proposed Fix / Technical Clues

Optional hints or pointers to suspected files/functions.

---

### Template B: Task / Tech Debt / Chore

Use for maintenance, refactoring, dependency updates, migrations, or infra work.

```markdown
## Background & Motivation
Explain why this task is needed and what problem it solves.

## Scope of Work
- Detail specific items to be addressed.
- Note any affected modules or libraries.

## Acceptance Criteria (Definition of Done)
- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Diagnostics, lint, and targeted tests pass

## Technical Notes & Risks
Architectural considerations, performance impacts, or potential regressions.
```

---

### Template C: Feature / Story

Use for user-facing features or new capabilities.

```markdown
## User Story
**As a** `<type of user>`,
**I want** `<capability / action>`,
**So that** `<benefit / value>`.

## Acceptance Criteria (Definition of Done)
- [ ] Scenario 1: Given `...`, When `...`, Then `...`
- [ ] Scenario 2: Given `...`, When `...`, Then `...`

## Design & UI (if applicable)
- Figma / wireframe links or visual guidelines.

## Technical Approach
- API endpoints / database schema changes.
- Frontend components / routing.
```

---

## 3. Priority Guidelines

| Priority | When to use |
| --- | --- |
| **Highest** | Production down, critical security vulnerability, data loss, blocking all team work. |
| **High** | Major feature broken with no workaround; customer-impacting defect. |
| **Medium** *(Default)* | Standard feature, normal bug with workaround, planned refactoring. |
| **Low** | Minor cosmetic glitch, typo, nice-to-have visual improvement. |
| **Lowest** | Trivial cosmetic polish, deferred tech debt. |
