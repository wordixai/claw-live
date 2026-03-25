# Agent notes

## gstack

This repo vendors [gstack](https://github.com/garrytan/gstack) at `.agents/skills/gstack`. After `setup --host codex`, individual skills appear under `.agents/skills/` as `gstack-*` (symlinks into the generated bundles inside the gstack tree).

- Use **gstack-browse** when a workflow needs Playwright/Chromium automation (see gstack `BROWSER.md`).
- Other gstack skills include: office-hours, plan-ceo-review, plan-eng-review, plan-design-review, design-consultation, review, ship, land-and-deploy, canary, benchmark, qa, qa-only, design-review, setup-browser-cookies, setup-deploy, retro, investigate, document-release, codex, cso, autoplan, careful, freeze, guard, unfreeze, gstack-upgrade.

If skills are missing or browse fails:

```bash
cd .agents/skills/gstack && ./setup --host codex
```

Requirements: Bun 1.0+, Git; on Windows, Node.js as well (see gstack README).
