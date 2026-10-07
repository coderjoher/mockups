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
# Postgres on :5432 and Redis on :6379, e.g.:
#   docker run -d -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=mockups postgres:16-alpine
#   docker run -d -p 6379:6379 redis:7-alpine
npm run migrate && npm run seed              # admin@example.com / admin12345
npm run seed:mockups                         # 12 placeholder mockup photos, published
npm run dev:api & npm run dev:worker & npm run dev:render & npm run dev:web
```

Or the whole stack: `docker compose up --build` → http://localhost:3000.

Production on AWS (EC2 + S3 + HTTPS): [`docs/DEPLOY-AWS.md`](docs/DEPLOY-AWS.md).

## Tests and phase gates

```bash
npm test                     # Node (vitest) + Python (pytest)
npm run test:e2e             # Playwright end-to-end, starts the full stack
scripts/phase-gate.sh "$(cat docs/PHASE)"
```

Every requirement ID in `docs/phase-requirements.txt` must be named as `[ID]` in at least one test before its phase passes.

## Features by phase

| Phase | What you get |
|---|---|
| 0–1 | Accounts, Arabic/English RTL UI, URL check with SSRF guard (DNS, connect time, redirects), per-user hourly limit |
| 2 | Page discovery from robots.txt / sitemaps (index, gzip) or a 2-level crawl, 200-URL / 30 s caps, 20-page checklist |
| 3–4 | Headless Chromium capture at 2x/3x, cleanup of banners/chat/pop-ups, frozen animations, Arabic fonts, 45 s limit, gallery with retry, recapture and upload |
| 5 | Admin corner picker (loupe, matrix3d live preview), licence-gated publishing, filtered library, 12 placeholder mockups |
| 6–7 | OpenCV perspective render (deterministic, golden-tested), PNG/WebP/JPG-90, ZIP with ATTRIBUTION.txt, 30-day retention |
| 8 | Batch mode, scroll offset, overlays and light maps, grid/tall layouts, template groups, language variants, dark mode capture |
| 9 | Social/slide presets, brand colours, headline + logo, share links, 24 h capture cache, favourites |
| 10 | Scrolling MP4, logged-in capture via session cookie (never stored), public API (`/v1`, OpenAPI at `/v1/openapi.json`), plans and billing webhook, queue-based autoscaling |

## Configuration

| Variable | Purpose |
|---|---|
| `APP_SECRET` | Signs sessions and file URLs |
| `STORAGE_DRIVER=s3`, `S3_*` | AWS S3 / Cloudflare R2 / Backblaze B2 / MinIO (leave `S3_ENDPOINT` empty for AWS; empty keys use the instance role) |
| `RATE_LIMIT_PAGES_PER_HOUR` | Per-user page limit (default 50) |
| `BILLING_WEBHOOK_SECRET` | HMAC secret for `POST /billing/webhook` (`x-billing-signature`) |
| `SIGNUP_DISABLED=1` | Turn off self-service sign-up (internal-tool mode) |

Workspaces created by `npm run seed` use the unlimited `internal` plan; sign-ups start on `free`.
`scripts/autoscale.sh` scales capture/render workers from `GET /admin/metrics/queues`.
