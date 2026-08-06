# GSoC Issue Hunter

A tool that scans GitHub for open source issues suitable for Google Summer of Code (GSoC) contributions, filters out noise, and presents results through a web dashboard.

The project has two parts:

- **Collector (`index.js` / `server.js`)** — a Node.js script that queries the GitHub API for GSoC organizations and a curated list of community repositories, filters issues by recency, comment activity, and maintainer involvement, and writes the results to `issues.json` and `ISSUES.md`. `server.js` wraps the script in a small Express server so it can be triggered and streamed from the web UI.
- **Dashboard (`web/`)** — a Next.js app that reads the generated JSON and lets you browse, filter, and search issues by org, repo, and label.

## Why

Manually scrolling through GitHub's "good first issue" search across dozens of orgs is slow and full of stale or already-claimed issues. This tool automates the discovery step: it pulls fresh issues, applies a hard time filter (only recently created issues), excludes issues with heavy maintainer involvement already, and separates official GSoC organizations from community repos worth contributing to.

## Tech stack

- Node.js, Express, Axios (collector)
- Next.js 15, React 19, TypeScript (dashboard)
- Tailwind CSS, shadcn/ui, Radix UI, Framer Motion (UI)

## Getting started

### 1. Collector

```bash
npm install
```

Create a `.env` file in the project root:

```
GITHUB_TOKEN=your_github_personal_access_token
```

Run the collector:

```bash
npm start
```

This fetches issues and writes them to `issues.json` and `ISSUES.md`.

Optionally, run the local server to trigger the collector from a browser and stream logs in real time:

```bash
node server.js
```

### 2. Dashboard

```bash
cd web
npm install
npm run dev
```

The dashboard reads issue data from the local `issues.json` file by default. To point it at a JSON file hosted elsewhere (e.g. a raw GitHub URL), set:

```
ISSUES_JSON_URL=https://raw.githubusercontent.com/<owner>/<repo>/main/issues.json
```

To enable the commit history view, set:

```
GITHUB_REPO=owner/repo
```

## Project structure

```
.
├── index.js              # Issue collection script
├── server.js             # Local server to trigger the script from the UI
├── issues.json           # Latest collected issues (generated)
├── ISSUES.md             # Human-readable issue report (generated)
├── web/                  # Next.js dashboard
│   ├── app/               # Routes and API endpoints
│   ├── components/        # UI components
│   └── lib/                # Data loading utilities
```

## Credits

The initial collector script structure was based on an MIT-licensed open source template. Most of the filtering logic, the GSoC-specific classification, the dashboard, and the UI are original.

## License

MIT — see [LICENSE](./LICENSE).
