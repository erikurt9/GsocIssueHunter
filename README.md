# GSoC Issue Hunter <img src="[https://api.iconify.design/lucide:target.svg](https://api.iconify.design/lucide:target.svg)" width="28" height="28" valign="middle" alt="Target icon" />

[ English ](#english) | [ Español ](#spanish)

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
| <img width="1920" height="829" alt="Dashboard View" src="[https://github.com/user-attachments/assets/cc705367-666b-4650-8576-47bc76a1e75c](https://github.com/user-attachments/assets/cc705367-666b-4650-8576-47bc76a1e75c)" /> | <img width="1920" height="849" alt="Filter & Search" src="[https://github.com/user-attachments/assets/c5d57fdc-fa0a-4519-a306-81496aece441](https://github.com/user-attachments/assets/c5d57fdc-fa0a-4519-a306-81496aece441)" /> |

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
```

Create a `.env` file in the project root:

```env
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

```env
ISSUES_JSON_URL=https://raw.githubusercontent.com/<owner>/<repo>/main/issues.json
```

To enable the commit history view, set:

```env
GITHUB_REPO=owner/repo
```

## Project Structure

```text
.
├── index.js               # Issue collection script
├── server.js              # Local server to trigger the script from the UI
├── issues.json            # Latest collected issues (generated)
├── ISSUES.md              # Human-readable issue report (generated)
├── web/                   # Next.js dashboard
│   ├── app/               # Routes and API endpoints
│   ├── components/        # UI components
│   └── lib/               # Data loading utilities
```

## License

MIT — see [LICENSE](./LICENSE).

---

<a name="spanish"></a>
# Español

Una herramienta que escanea GitHub en busca de *issues* de código abierto adecuados para contribuciones de Google Summer of Code (GSoC), filtra el ruido y presenta los resultados a través de un panel web.

El proyecto consta de dos partes:

- **Colector (`index.js` / `server.js`)** — Un script de Node.js que consulta la API de GitHub para buscar organizaciones de GSoC y una lista curada de repositorios comunitarios. Filtra *issues* por fecha reciente, actividad de comentarios e intervención de mantenedores, y guarda los resultados en `issues.json` e `ISSUES.md`. `server.js` envuelve el script en un servidor Express para poder ejecutarlo y transmitir los logs en tiempo real desde la interfaz web.
- **Panel Web / Dashboard (`web/`)** — Una aplicación en Next.js que lee el JSON generado y te permite explorar, filtrar y buscar *issues* por organización, repositorio y etiqueta.

## Capturas de pantalla (Screenshots)

| Vista Principal del Dashboard | Filtros y Búsqueda |
| :---: | :---: |
| <img width="1920" height="829" alt="Vista del Dashboard" src="[https://github.com/user-attachments/assets/cc705367-666b-4650-8576-47bc76a1e75c](https://github.com/user-attachments/assets/cc705367-666b-4650-8576-47bc76a1e75c)" /> | <img width="1920" height="849" alt="Filtros y Búsqueda" src="[https://github.com/user-attachments/assets/c5d57fdc-fa0a-4519-a306-81496aece441](https://github.com/user-attachments/assets/c5d57fdc-fa0a-4519-a306-81496aece441)" /> |

## ¿Por qué?

Buscar manualmente a través de la pestaña "good first issue" de GitHub en docenas de organizaciones es un proceso lento y lleno de *issues* obsoletos o asignados. Esta herramienta automatiza el descubrimiento: extrae *issues* recientes, aplica un filtro temporal estricto (solo creados recientemente), excluye *issues* que ya cuentan con mucha interacción de mantenedores y separa las organizaciones oficiales de GSoC de los repositorios comunitarios en los que vale la pena contribuir.

## Tecnologías utilizadas

- **Colector:** Node.js, Express, Axios
- **Dashboard:** Next.js 15, React 19, TypeScript
- **UI y Estilos:** Tailwind CSS, shadcn/ui, Radix UI, Framer Motion

## Guía de instalación

### 1. Colector

```bash
npm install
```

Crea un archivo `.env` en la raíz del proyecto:

```env
GITHUB_TOKEN=tu_token_de_acceso_personal_de_github
```

Ejecuta el colector:

```bash
npm start
```

Esto obtendrá los *issues* y los escribirá en `issues.json` e `ISSUES.md`.

Opcionalmente, ejecuta el servidor local para iniciar el colector desde un navegador y transmitir los logs en tiempo real:

```bash
node server.js
```

### 2. Panel Web (Dashboard)

```bash
cd web
npm install
npm run dev
```

El panel web lee los datos del archivo local `issues.json` por defecto. Para vincularlo a un JSON alojado en otro lugar (por ejemplo, una URL raw de GitHub), configura:

```env
ISSUES_JSON_URL=https://raw.githubusercontent.com/<propietario>/<repositorio>/main/issues.json
```

Para habilitar la vista de historial de commits, configura:

```env
GITHUB_REPO=propietario/repositorio
```

## Estructura del proyecto

```text
.
├── index.js               # Script de recolección de issues
├── server.js              # Servidor local para ejecutar el script desde la UI
├── issues.json            # Últimos issues recolectados (generado)
├── ISSUES.md              # Reporte de issues legible (generado)
├── web/                   # Dashboard en Next.js
│   ├── app/               # Rutas y endpoints de API
│   ├── components/        # Componentes de UI
│   └── lib/               # Utilidades de carga de datos
```

## Licencia

MIT — consulta el archivo [LICENSE](./LICENSE).
