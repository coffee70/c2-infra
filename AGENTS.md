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

## Agent Task Setup

- When implementing a feature, create and use a dedicated git worktree with a dedicated branch before making code changes. Do not implement feature work directly in a shared worktree.
- At task start, verify the current directory belongs to the intended worktree and verify the checked out branch matches the task being executed.
- Keep each agent scoped to its own worktree and branch so multiple agents can operate concurrently without interfering with one another.
- If the current worktree or branch does not match the assigned task, stop and correct that first before continuing.
- Use clear branch names that reflect the task or feature being implemented.

### Validation Requirements

- Run the tests that match the code you changed before finishing.
- For frontend changes, run the relevant Playwright coverage from `tools/playwright`; at minimum run `npm --prefix tools/playwright run test:smoke` unless a more targeted or broader browser test is needed.
- For backend changes, run the relevant `pytest` coverage for the affected codepaths and re-check any impacted API endpoints.
- For changes that span frontend and backend behavior, run both the appropriate Playwright checks and the relevant `pytest` coverage.
- Do not treat validation as complete until the applicable automated tests pass, or you have a concrete reason they cannot run and you report that clearly.

#### Backend pytest workflow

- Use the repo root virtualenv, not the backend container image, for backend `pytest`.
- Install backend test dependencies into the repo virtualenv with `./.venv/bin/pip install -r backend/requirements.txt` if they are missing.
- Run backend tests from the repo root with `PYTHONPATH=backend .venv/bin/pytest ...`.
- Example: `PYTHONPATH=backend .venv/bin/pytest backend/tests/test_source_aware.py backend/tests/test_position_service.py backend/tests/test_realtime.py`
- Do not rely on `docker compose exec backend pytest ...` for repo tests; the backend image copies `./backend` into `/app` but does not include the repo-level `backend/tests` tree, so those paths are unavailable inside the container.

### Default Investigation Loop

- Prefer direct API validation first: use `curl` or small Python scripts to exercise backend endpoints and confirm status codes, JSON, and error handling.
- For backend work, inspect the relevant Python code, logs, and tests; run `pytest` and re-check affected endpoints.
- For frontend work, inspect the Next.js code and use the shared Playwright workspace in `tools/playwright` when browser validation is needed.
- Repeat the loop until the root cause is fixed and the relevant validations pass.

## Efficient Codebase Exploration

- Minimize token usage during exploration. Gather precise context first, then read only the smallest code regions needed to complete the task.
- Exploration priority order:
  - First: use `rg` for fast text search across the repository.
  - Second: use `ast-grep` for syntax-aware structural search.
  - Third: read only the relevant sections of files returned by those searches.
  - Last: read full files only if absolutely necessary.
- Never begin by opening large files.
- Avoid scanning entire directories by reading files sequentially.
- Prefer command-line searches to locate symbols, functions, routes, tests, or database calls.
- Read code in small windows, typically 50-150 lines around search matches, instead of entire files.
- Expand context incrementally only if necessary.
- Avoid loading unrelated files into context.

### Recommended Search Workflow

- Start with `rg -n` to identify likely files and exact match locations.
- Use `ast-grep` when structure matters more than text, such as finding definitions, call sites, or React hook usage.
- After search results narrow the target, read only the matching region with a bounded window.
- Re-run search with tighter patterns before reading more files.

### Recommended Search Patterns

- Ripgrep examples:
  - Finding API routes: `rg -n "export async function (GET|POST|PUT|DELETE)" app src`
  - Finding database writes: `rg -n "insert|update|save|MongoClient|collection\\."`
  - Finding tests: `rg -n "describe\\(|test\\(|pytest"`
  - Finding Python/FastAPI routes: `rg -n "@router\\.(get|post|put|delete)|@app\\.(get|post|put|delete)" backend`
  - Finding service entry points or handlers: `rg -n "def .*service|class .*Service|handle_|processor|listener" backend frontend`
- `ast-grep` examples:
  - Finding function definitions: `ast-grep -p 'def $FUNC($ARGS): $$$BODY' -l python`
  - Finding function call sites: `ast-grep -p '$FUNC($$$ARGS)'`
  - Finding React hooks: `ast-grep -p 'useEffect($A, $B)' -l tsx`
  - Finding exported TS functions: `ast-grep -p 'export function $FUNC($$$ARGS) { $$$BODY }' -l ts`

### Agent Editing Strategy

- Identify the minimal set of files required for the change.
- Locate the implementation, types or interfaces, tests, and configuration dependencies before editing.
- Avoid modifying files that are unrelated to the task.
- When the task is large enough to benefit from delegation, create subagents for independent parallelizable work instead of keeping all work in a single agent.
- Before delegating, confirm each subagent has a clear scope, isolated ownership, and its own appropriate worktree and branch when it will make changes.
- When writing a plan, explicitly mark which plan items can be handled by subagents and which items must remain on the main agent's critical path.
- After making changes, run the relevant tests or commands to validate the change.

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
