# Shared Playwright Tooling

This workspace is the repo-owned home for browser automation and smoke tests.

## Why This Exists

- Agents and developers should use one stable Playwright location instead of ad hoc installs under `.cursor`.
- Browser binaries live under `tmp/playwright/ms-playwright`.
- Reports, traces, screenshots, and videos live under `tmp/playwright`.

## Canonical Commands

From the repo root:

```bash
npm --prefix tools/playwright install
npm --prefix tools/playwright run install:chromium
```

Open the local frontend in a real browser:

```bash
npm --prefix tools/playwright run open:local
```

Generate browser interactions against the local frontend:

```bash
npm --prefix tools/playwright run codegen:local
```

Run the shared smoke test:

```bash
npm --prefix tools/playwright run test:smoke
```

Run the same smoke test in headed mode:

```bash
npm --prefix tools/playwright run test:smoke:headed
```

## Runtime Defaults

- Base URL: `http://127.0.0.1:3000`
- Primary smoke route: `/overview`
- Override the base URL with `PLAYWRIGHT_BASE_URL` when needed

## Artifacts

- Browser binaries: `tmp/playwright/ms-playwright`
- HTML report: `tmp/playwright/report`
- Test results, traces, screenshots, videos: `tmp/playwright/test-results`
