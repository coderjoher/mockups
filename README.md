# Website Mockup Generator

Paste a website link and get photo-realistic device mockups of every important page.
Product requirements: [`docs/Website-Mockup-Generator-PRD.pdf`](docs/Website-Mockup-Generator-PRD.pdf).
Delivery plan and test gates: [`docs/PHASES.md`](docs/PHASES.md). Current phase: [`docs/PHASE`](docs/PHASE).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js + Tailwind front end (Arabic/English, RTL), admin corner picker |
| `apps/api` | Fastify REST API: auth, projects, jobs, SSRF guard, rate limits |
| `packages/core` | Shared Node code: DB + migrations, BullMQ queue, storage, domain logic |
| `workers/capture` | Node worker: page discovery, Playwright capture, ZIP export |
| `workers/render` | Python worker: OpenCV perspective warp, compositing, image export |
| `tests` | Fixture websites, E2E specs (Playwright), test setup |

## Run locally

```bash
npm ci && pip install -r workers/render/requirements.txt
sudo scripts/install-fonts.sh               # Arabic fonts for captures
# Postgres on :5432 and Redis on :6379 (or `docker compose up postgres redis`)
npm run migrate && npm run seed              # admin@example.com / admin12345
npm run dev:api & npm run dev:worker & npm run dev:render & npm run dev:web
```

Or the whole stack: `docker compose up --build` → http://localhost:3000.

## Tests and phase gates

```bash
npm test                     # Node (vitest) + Python (pytest)
npm run test:e2e             # Playwright end-to-end, starts the full stack
scripts/phase-gate.sh "$(cat docs/PHASE)"
```

Every requirement ID in `docs/phase-requirements.txt` must be named as `[ID]` in at least one test before its phase passes.
