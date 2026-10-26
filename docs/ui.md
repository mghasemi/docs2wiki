# Web UI and Docker

A Fastify server wraps the CLI (`dist/cli.js`) and serves a small HTML/JS UI. Each job runs the CLI as a child process.

## Quick start

```bash
mkdir -p docs-input          # optional: folders to expose as "Local (mounted folder)"
docker compose up --build
```

Open http://localhost:8765 (or the port set in `.env`; copy [.env.example](../.env.example) to `.env` and edit `HOST_PORT`).

## Features

- Multi-source form: GitHub Wiki, ReadTheDocs, mounted local folder, uploaded zip or folder
- Live job logs (SSE), warnings from the run report
- Download Markdown, PDF and report JSON
- Job history (persisted in `./data/jobs`), re-run, cancel, delete
- Cache options and a "Clear cache" button

## Configuration (environment / `.env`)

| Variable | Default | Purpose |
|---|---|---|
| `HOST_PORT` | `8765` | Published host port |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface; set `0.0.0.0` to expose on the network |
| `MAX_UPLOAD_MB` | `100` | Upload size limit (also limits zip expansion) |
| `MAX_UPLOAD_FILES` | `5000` | Max files per upload |
| `MAX_CONCURRENT_JOBS` | `1` | Parallel jobs; extra jobs queue |
| `BLOCK_PRIVATE_NETWORKS` | `true` | Reject URLs resolving to private/loopback IPs (SSRF guard) |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | empty | Enable HTTP basic auth when both are set |

Volumes: `./data` (jobs + cache), `./docs-input` mounted read-only at `/workspace`.

## Security notes

- Mounted-folder paths are confined to `/workspace`; zip entries and uploaded paths are sanitized and size-limited.
- The SSRF guard checks the submitted URL only; redirects followed during a crawl are not re-checked. Enable basic auth before exposing the UI beyond localhost.

## API

`POST /api/jobs` (JSON, or multipart with a `payload` field first and `upload:<n>` file fields), `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/events` (SSE), `GET /api/jobs/:id/files/{md|pdf|report}`, `POST /api/jobs/:id/cancel`, `DELETE /api/jobs/:id`, `POST /api/cache/clear`, `GET /api/health`, `GET /api/config`.

## Without Docker

```bash
npm install && npm run build && npm run start:server
```
