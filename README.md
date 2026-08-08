# GSoC Issue Hunter <img src="https://api.iconify.design/lucide:target.svg" width="28" height="28" valign="middle" alt="Target icon" />

[ English ](#english) | [ Español ](#español)

---

<a name="english"></a>
# English

A tool that scans GitHub for open source issues suitable for Google Summer of Code (GSoC) contributions, filters out noise, and presents results through a web dashboard.

The project has two parts:

- **Collector (`index.js` / `server.js`)** — A Node.js script that queries the GitHub API for GSoC organizations and a curated list of community repositories, filters issues by recency, comment activity, and maintainer involvement, and writes the results to `issues.json` and `ISSUES.md`. `server.js` wraps the script in a small Express server so it can be triggered and streamed from the web UI.
- **Dashboard (`web/`)** — A Next.js app that reads the generated JSON and lets you browse, filter, and search issues by org, repo, and label.

## Screenshots

| Dashboard View | Filter & Search |
| :---: | :---: |
| <img width="1920" height="829" alt="Dashboard View" src="https://github.com/user-attachments/assets/cc705367-666b-4650-8576-47bc76a1e75c" /> | <img width="1920" height="849" alt="Filter & Search" src="https://github.com/user-attachments/assets/c5d57fdc-fa0a-4519-a306-81496aece441" /> |



## Why

Manually scrolling through GitHub's "good first issue" search across dozens of orgs is slow and full of stale or already-claimed issues. This tool automates the discovery step: it pulls fresh issues, applies a hard time filter (only recently created issues), excludes issues with heavy maintainer involvement already, and separates official GSoC organizations from community repos worth contributing to.

## Tech Stack

- **Collector:** Node.js, Express, Axios
- **Dashboard:** Next.js 15, React 19, TypeScript
- **UI & Styling:** Tailwind CSS, shadcn/ui, Radix UI, Framer Motion

## Getting Started

### 1. Collector

```bash
npm install
