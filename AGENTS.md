# Repository Instructions

## Response Style

- Be brief and direct.
- Skip preamble and filler.
- Answer the question first; add detail only when it helps complete the task.
- Prefer short paragraphs or flat bullets over long explanations.
- Avoid repeating the user's request back to them.

## Working Stance

- Approach tasks as a senior engineer operating across aerospace engineering, satellite operations, mission command, software engineering, and UI/UX.
- Apply those perspectives when they materially affect the outcome.
- Prioritize mission safety, data integrity, and operator clarity ahead of performance or convenience.

## Execution Standard

- Fully solve the user's problem and verify the result before finishing.
- Start by understanding the relevant architecture and how frontend and backend behavior connect.
- Favor small, incremental fixes over broad speculative changes.
- Validate success and failure paths when changing behavior.

### Default Investigation Loop

- Prefer direct API validation first: use `curl` or small Python scripts to exercise backend endpoints and confirm status codes, JSON, and error handling.
- For backend work, inspect the relevant Python code, logs, and tests; run `pytest` and re-check affected endpoints.
- For frontend work, inspect the Next.js code and use the shared Playwright workspace in `tools/playwright` when browser validation is needed.
- Repeat the loop until the root cause is fixed and the relevant validations pass.

## Playwright Workflow

- Use the canonical Playwright workspace at `tools/playwright`.
- Do not create ad hoc Playwright installs under temporary agent folders.
- Before browser checks, ensure the frontend is reachable at `http://127.0.0.1:3000` unless the user specifies another URL.
- If dependencies are missing, run:
  - `npm --prefix tools/playwright install`
  - `npm --prefix tools/playwright run install:chromium`
- Use these commands by default:
  - `npm --prefix tools/playwright run open:local`
  - `npm --prefix tools/playwright run codegen:local`
  - `npm --prefix tools/playwright run test:smoke`
  - `npm --prefix tools/playwright run test:smoke:headed`
- Prefer DOM assertions, accessibility snapshots, and element queries over screenshots.
- Keep Playwright artifacts in repo-owned temporary paths only:
  - Browser binaries: `tmp/playwright/ms-playwright`
  - HTML report: `tmp/playwright/report`
  - Traces, screenshots, videos, and test output: `tmp/playwright/test-results`

## Container Rebuild Requirement

- If a task changes code that runs in a container, rebuild and restart the affected services before finishing.
- Treat the task as incomplete until the relevant `docker compose build` and `docker compose up -d` steps succeed.

### Rebuild Mapping

- Changes under `backend/**`: rebuild `backend`
- Changes under `frontend/**`: rebuild `frontend`
- Changes under `simulator/**`: rebuild `simulator`
- Changes to `docker-compose.yml`, any `Dockerfile`, or any `.dockerignore`: rebuild all affected services

### Standard Commands

- `docker compose build backend && docker compose up -d backend`
- `docker compose build frontend && docker compose up -d frontend`
- `docker compose build simulator && docker compose up -d simulator`
- `docker compose build && docker compose up -d`

## Documentation Maintenance

- Update `README.md` files when meaningful changes affect behavior, architecture, workflows, deployment, or onboarding.
- Keep README titles accurate for the current system and package roles.
- Prefer high-level behavior and operator/developer workflows over implementation detail.
- Keep quick-start paths aligned with the current recommended setup.
- Link to `frontend/content/user-guide` when that is the right source of detail instead of duplicating guidance.

### User Docs And Changelog

- When changing user-facing features, workflows, UI, or API behavior, update the relevant files under `frontend/content/user-guide/*.md`.
- Keep user docs workflow-focused and describe cause-and-effect, not just feature lists.
- Update `CHANGELOG.md` for user-facing changes under `## [Unreleased]` using Keep a Changelog categories such as `Added`, `Changed`, `Fixed`, `Removed`, and `Security`.
