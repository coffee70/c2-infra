## Telemetry Operations Frontend

This package contains the **Next.js dashboard** for the Telemetry Operations Platform. It provides mission operators with:

- **Overview dashboard** for watchlists, anomalies, and live status
- **Semantic search** and **channel detail** pages with trends, z-scores, and AI explanations
- **Simulator controls** and other workflows that sit on top of the backend telemetry API

For an end-to-end description of what the full application does, see the root `README.md` and the user guide in `frontend/content/user-guide`.

## Running the frontend in development

From the `frontend/` directory:

```bash
npm install
npm run dev
```

Then open `http://localhost:3000` in your browser.

By default the app expects the backend API at `http://localhost:8000`. You can override this with the `NEXT_PUBLIC_API_URL` environment variable.

> When running the full stack with Docker, prefer the root-level instructions in `../README.md`, which start all services (database, backend, frontend, simulator) together.
