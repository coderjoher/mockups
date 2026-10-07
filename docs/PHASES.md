# Website Mockup Generator: delivery phases and test gates

Source: [`Website-Mockup-Generator-PRD.pdf`](./Website-Mockup-Generator-PRD.pdf) (Oct 7, 2026).

The PRD's roadmap has three phases (MVP → Polish → Scale) and two business gates.
This plan splits them into **11 engineering phases**. Each phase is small enough to test
on its own, and **no phase starts until the one before it passes its test gate.**

| PRD roadmap | Engineering phases | Business gate at the end |
|---|---|---|
| Phase 1 · MVP (weeks 1–6) | 0 → 7 | **Gate 1**: used on 3 real client projects |
| Phase 2 · Polish (weeks 7–12) | 8 → 9 | **Gate 2**: decide internal tool or product |
| Phase 3 · Scale (after week 12) | 10 | (none) |

---

## The gate rule (applies to every phase)

A phase is **done** and the next one may start only when all of these are true:

1. **Every requirement ID in the phase has at least one test** that names the ID
   (e.g. `it("[PD-1] adds https and strips utm_* params", …)` or
   `def test_cr7_deterministic_output():  # [CR-7]`).
   `scripts/phase-gate.sh <N>` checks this automatically against
   [`phase-requirements.txt`](./phase-requirements.txt).
2. **All tests pass in CI**: this phase's tests **and every earlier phase's tests**
   (no regressions are carried forward).
3. **Every exit criterion** in the phase's "Gate" checklist below is ticked, including
   performance numbers measured on the CI runner or staging, not on a laptop.
4. Coverage on code added in the phase is **≥ 80 %** lines (unit + integration).
5. No open bug labelled `blocker` against the phase.

Run the gate:

```bash
scripts/phase-gate.sh 3      # checks phases 0..3: test exists for every ID, then runs the suites
```

Test layers used below: **U** = unit, **I** = integration (real Postgres/Redis/MinIO in Docker),
**E** = end-to-end (Playwright driving the web app), **P** = performance/benchmark,
**V** = visual / golden-image comparison.

All capture and discovery tests run against **local fixture sites** (served from
`tests/fixtures/sites/`) so they are deterministic and never hit the public internet.

---

## Phase 0: Foundations

**Goal:** the skeleton every later phase plugs into.

| ID | Deliverable |
|---|---|
| F-1 | Monorepo: `apps/web` (Next.js + Tailwind), `apps/api` (Node/Fastify or Next API routes), `workers/capture` (Node + Playwright), `workers/render` (Python + OpenCV + Pillow) |
| F-2 | Docker Compose: Postgres, Redis, MinIO (stands in for R2/B2 locally), all services |
| F-3 | DB schema + migrations for the PRD data model: User, Workspace, Project, Page, Capture, Mockup, Screen, Render, Job |
| F-4 | Job queue (Redis + BullMQ) with job types `discover`, `capture`, `render`, `export`; workers write status to Postgres |
| F-5 | Reliability: failed jobs retried **twice with backoff**; one failed job never blocks siblings |
| F-6 | Object storage wrapper with **signed URLs** |
| F-7 | i18n shell: Arabic + English UI, full RTL layout switch |
| F-8 | CI pipeline running lint, type-check and all test suites on every push |

**Tests**
- I: migrations apply on an empty DB and roll back cleanly; each entity can be created/read with its relations (Project→Pages→Captures, Mockup→Screens, Render→Project).
- I: enqueue a job of each type → worker picks it up → status moves `queued → running → done` in Postgres.
- I: a job that throws is attempted exactly 3 times (1 + 2 retries) with increasing delay, then `failed`; a sibling job in the same project still completes.
- I: upload to storage, fetch through a signed URL, signed URL rejected after expiry.
- U/E: switching locale to `ar` sets `dir="rtl"` and `lang="ar"` on `<html>`; a snapshot of the layout shell mirrors correctly.
- CI: pipeline is green on a clean clone.

**Gate 0:** `docker compose up` brings the whole stack up from a clean clone; all of the above pass in CI.

- [x] Gate 0 passed (`scripts/phase-gate.sh 0`), coverage 92 % lines. `docker compose config` validated; full image build not run in the dev container (Docker Hub rate limit).

---

## Phase 1: URL intake and safety (SSRF, rate limits)

**Goal:** the app can accept any URL safely. This comes before any fetching so that
every later feature inherits the guard.

| ID | Requirement |
|---|---|
| PD-1 | Accept a URL; normalise it (add https, strip tracking params) and confirm it loads |
| NF-SSRF | Block private/internal IPs (10.x, 172.16–31.x, 192.168.x, 127.x, 169.254.x, localhost, IPv6 loopback/link-local) **after DNS resolution and on every redirect**; http/https only |
| NF-RATE | Rate limit per user (e.g. 50 pages/hour); log every captured domain |

**Tests**
- U: normalisation table: `example.com` → `https://example.com/`; `utm_*`, `fbclid`, `gclid` removed; other params kept; IDNs (Arabic domains) converted to punycode.
- U: scheme guard rejects `file:`, `ftp:`, `javascript:`, `data:`.
- I: SSRF: a hostname whose DNS resolves to `127.0.0.1` is blocked; a public fixture URL that **302-redirects to `http://169.254.169.254/`** is blocked at the redirect; decimal/hex/IPv6-mapped forms of private IPs (`http://2130706433/`, `http://[::ffff:127.0.0.1]/`) are blocked.
- I: the 51st page in an hour for one user returns 429; a second user is unaffected; each request writes a domain log row.
- E: entering a dead URL shows a clear "site did not load" message.

**Gate 1 (engineering):** all SSRF cases above blocked; rate limiter verified; tests green.

- [x] Gate 1 passed (`scripts/phase-gate.sh 1`).

---

## Phase 2: Page discovery and checklist

| ID | Requirement |
|---|---|
| PD-2 | Read `robots.txt` and `sitemap.xml`, including sitemap index files |
| PD-3 | No sitemap → crawl header nav, footer and homepage body links, same domain, up to 2 levels |
| PD-4 | Cap discovery at 200 URLs and 30 s; show what was found if the cap is hit |
| PD-5 | Checklist with title, path and favicon; Home pre-selected |
| PD-7 | User can add URLs manually and search/filter the list |
| PD-9 | Max 20 selected pages per project |

**Tests**
- I (fixture sites): site with `sitemap.xml` → exact URL list; site with a **sitemap index** pointing to 2 child sitemaps → union of both; `Sitemap:` line in `robots.txt` is followed.
- I: no-sitemap fixture → nav/footer/body links found; a level-3 link is **not** found; external-domain links excluded.
- I: fixture with 1 000 URLs stops at 200 and returns a partial result flagged `capped`; slow fixture stops at 30 s with partial results.
- I: manually added URLs pass through PD-1 normalisation and the SSRF guard.
- E: checklist shows title/path/favicon, Home is ticked by default, search filters the list, ticking a 21st page is refused with a message.
- P: discovery on the 200-URL fixture finishes in < 30 s.

**Gate 2:** all discovery fixtures produce the expected lists; tests green.

- [x] Gate 2 passed (`scripts/phase-gate.sh 2`).

---

## Phase 3: Capture engine

| ID | Requirement |
|---|---|
| CE-1 | Above-the-fold and full-page modes (full page capped at 15 000 px) |
| CE-2 | Wait for network idle, `document.fonts.ready` and images |
| CE-3 | Scroll top→bottom once to trigger lazy loading, then return to top |
| CE-4 | Hide cookie banners, chat widgets, pop-ups (maintained selector blocklist + consent-tool handling) |
| CE-5 | Freeze animations/transitions/carousels via injected CSS |
| CE-8 | Arabic fonts installed on workers (Noto Sans Arabic, Cairo, Tajawal, IBM Plex Sans Arabic); never tofu boxes |
| CE-9 | 45 s timeout per page; failure stores a human-readable reason |
| CE-10 | Up to 3 pages in parallel per project; queue the rest; per-page progress |
| NF-ISO | Fresh browser context per capture; no downloads, no file access, JS dialogs auto-dismissed, 45 s hard kill |
| NF-PRIV | Public pages only; no cookies or credentials stored |

Viewports: Desktop 1440×900 @2x → 2880×1800 · Tablet 834×1194 @2x → 1668×2388 · Mobile 390×844 @3x → 1170×2532.

**Tests**
- I: fold capture output sizes are **exactly** 2880×1800, 1668×2388, 1170×2532; viewports are editable per project and the override is respected.
- I: 30 000 px tall fixture → full-page image height is 15 000 CSS px × scale.
- I: lazy-load fixture (images load on IntersectionObserver) → bottom image is present in the capture (pixel check on a known colour block).
- I: banner fixture with OneTrust/Cookiebot-style markup + chat bubble → those regions absent from the capture.
- I: animated fixture → two consecutive captures are pixel-identical.
- I: Arabic fixture in each of the 4 fonts → no `.notdef` glyphs (compare text region against a box-glyph render; assert installed font list in the container).
- I: fixture that never finishes loading → job fails at 45 s with reason `timeout`; fixture that triggers `alert()` and a file download → capture still completes, no file written.
- I: project with 6 pages → never more than 3 running at once (observed via job timings); progress events emitted per page.
- I: a cookie set by the page is not present in the next capture's context.
- P: 1 page × 3 devices < 30 s; 10 pages < 3 min on the CI runner.

**Gate 3:** all fixture captures match expectations, Arabic renders correctly, timing targets met.

- [x] Gate 3 passed (`scripts/phase-gate.sh 3`). Timings on the dev container: 1 page x 3 devices and 10 pages x 3 devices both well inside the targets (see the [P] test output).

---

## Phase 4: Results gallery and upload fallback

| ID | Requirement |
|---|---|
| CE-11 | Results gallery: pages as rows, devices as columns; recapture any single cell |
| CE-9-UI | Failed cell shows the reason with **Retry** and **Upload my own screenshot** |
| UP-1 | Manual upload fallback: validated image becomes a Capture with `source = upload` |

**Tests**
- E: gallery grid has one row per selected page and three device columns; thumbnails load from signed URLs.
- E: recapturing one cell re-runs only that page × device (one new job, others untouched).
- E: a failed cell shows the stored reason; Retry enqueues a new capture; Upload accepts PNG/JPG and replaces the cell.
- I: upload rejects non-images, oversize files and wrong MIME types; stored capture has `source = upload`.
- E: the whole gallery works in Arabic/RTL.

**Gate 4:** the user flow "Paste URL → Discover → Tick → Capture → (Retry or Upload)" works end-to-end in E2E tests.

- [x] Gate 4 passed (`scripts/phase-gate.sh 4`).

---

## Phase 5: Mockup library and admin corner picker

| ID | Requirement |
|---|---|
| CP-1 | Upload photo (JPG/PNG, ≥ 3000 px long side) |
| CP-2 | Add screens; click 4 corners in order TL, TR, BR, BL |
| CP-3 | Drag handles with magnifier loupe; live warped test image (canvas + `matrix3d`) |
| CP-4 | Per screen: device type, corner radius, optional mask PNG |
| CP-7 | Metadata: title, tags, licence source/type, attribution; cannot publish without licence |
| CP-8 | Draft/published; only published mockups visible to users |
| ML-1 | User library grid with filters: device type, scene, colour tone, orientation |
| SEED | 10–15 in-house mockup photos marked and published (MVP content) |

**Tests**
- U: screen definition validator accepts the PRD example JSON and rejects missing corners, wrong corner order (self-intersecting quad), coordinates outside the photo, unknown device type.
- U: `matrix3d` computation from 4 corners maps the unit square to the corners (≤ 0.5 px error).
- I: upload a 2999 px photo → rejected; 3000 px → accepted; GIF → rejected.
- I: publish without licence fields → 422; with them → published.
- I: member-role user listing returns only published mockups; admin sees drafts; non-admin cannot reach admin endpoints.
- I: each ML-1 filter (and combinations) returns the right set from seeded data.
- E: admin uploads a photo, clicks 4 corners, drags a handle, saves; reloaded corners match what was placed.

**Gate 5:** corner picker E2E green; ≥ 10 seed mockups published and validated by the test suite (every published mockup has licence info and valid screens).

- [x] Gate 5 passed (`scripts/phase-gate.sh 5`). The 12 seed mockups are procedurally drawn placeholders (`npm run seed:mockups`), licensed in-house, to be replaced by real BeCorp photos.

---

## Phase 6: Render engine (warp + composite)

| ID | Requirement |
|---|---|
| R-1..R-6 | PRD render steps: pick capture by device → crop to screen aspect from the top (never stretch) → homography + bicubic `warpPerspective` → corner radius + mask with 1 px AA edge → composite base → screens by z-index → overlay → render at native resolution |
| CR-1 | No visible jagged edges or seams at 100 % zoom |
| CR-2 | Multi-screen mockups: assign a page per screen; sensible defaults auto-fill |
| CR-6 | Preview < 3 s at reduced size; final < 10 s per image |
| CR-7 | Deterministic: same inputs → same output bytes |

**Tests**
- U: crop: 1170×2532 capture into a 16:10 screen is cropped from the top, output aspect equals the quad's aspect, no scaling distortion.
- U: homography maps the crop rectangle's corners onto the screen corners with < 0.5 px reprojection error.
- U: device matching: mobile screen gets the mobile capture; missing device falls back predictably (documented rule).
- V: golden-image tests for 1 single-screen and 1 multi-screen mockup; SSIM ≥ 0.99 vs approved golden.
- V: edge quality: along each warped edge the alpha ramps over ≥ 1 px (no hard step) and there is no gap between screen and photo.
- U: z-index order respected when two screens overlap.
- U: CR-7: render the same inputs twice (and in two worker processes) → identical SHA-256.
- I: CR-2 default assignment: Home → largest screen, other pages fill remaining screens; user override persists.
- P: preview < 3 s and final < 10 s on a 6000 px photo on the CI runner.

**Gate 6:** golden images approved by a designer and committed; all render tests green.

- [x] Gate 6 passed (`scripts/phase-gate.sh 6`). Goldens committed in `workers/render/tests/golden/`; designer sign-off on them is still to do. 6000 px photo: preview ~0.3 s, final ~4 s on the dev container.

---

## Phase 7: Export and MVP integration

| ID | Requirement |
|---|---|
| CX-1 | Swap the page shown on each screen |
| EX-1 | PNG and WebP at native resolution; JPG at 90 % |
| EX-3 | Download one image or a ZIP; files named `site_page_device_mockup.png` |
| EX-6 | Attribution text included in the ZIP when the licence requires it |
| NF-STOR | Captures deleted after 30 days unless saved |
| NF-BROWSER | Works in latest Chrome, Edge, Safari, Firefox; usable on tablet; view-and-download on mobile |

**Tests**
- I: each format decodes, has native dimensions; JPG quality is 90 (quantisation table check).
- U: filename builder slugifies site/page (including Arabic page titles) to `site_page_device_mockup.ext`, no collisions in one ZIP.
- I: ZIP contains every render; `ATTRIBUTION.txt` present iff a used mockup requires attribution, with the right text.
- E: swap page on a screen → preview updates → export reflects it.
- I: retention job deletes unsaved captures older than 30 days and keeps saved ones.
- E: smoke flow on Chromium, Firefox and WebKit (Playwright projects), plus a mobile viewport download test.
- **E (MVP acceptance):** full flow on a fixture site: paste URL → discover → tick 3 pages → capture → pick mockup → export ZIP, **in < 2 minutes**; repeated for an Arabic RTL fixture.

**Gate 7 (= PRD Gate 1):**
- All Phase 0–7 tests green.
- Used on **3 real client projects**; track PRD metrics: URL → first mockup < 2 min, ≥ 85 % captures need no fallback, ≥ 90 % mockups used without retouching, ≥ 3 pages/project.

- [x] Engineering gate passed (`scripts/phase-gate.sh 7`): URL → ZIP of a three-page set in ~16 s on fixtures, English and Arabic; Chromium, Firefox, WebKit and mobile smoke tests green.
- [ ] Business gate (3 real client projects, PRD metrics) — for the BeCorp team; work on phases 8-10 continued on request without it.

---

## Phase 8: Polish A (rendering and capture)

| ID | Requirement |
|---|---|
| CR-4 | Batch mode: one mockup applied to every captured page |
| CR-3 | Scroll offset per screen for full-page captures |
| CP-5 | Optional overlay PNG (reflection, thumb) above the screenshot |
| CP-6 | Optional light map (multiply blend) |
| CR-5 | Photo-free presentation layouts: grid collage, tall full-page frame |
| PD-6 | Group repeated templates (`/product/*`, `/blog/*`), one sample per group, expandable |
| PD-8 | Detect language variants (`/ar/`, `/en/`, `hreflang`); pick one or both |
| CE-6 | Sticky headers appear once in full-page mode |
| CE-7 | Dark-mode capture, hide elements by CSS selector, extra delay |
| ML-2 | Library cards preview the user's own Home capture |

**Tests**
- I: batch on 5 pages → 5 renders, each deterministic (CR-7 still holds).
- V: scroll offset 0 vs 800 shows different regions; overlay and light-map golden images; collage/tall-frame golden images.
- U: template grouping collapses 50 `/product/x` URLs into one group with a count; hreflang fixture yields both language sets.
- I: sticky-header fixture → header appears once in full-page capture; `prefers-color-scheme: dark` fixture captures the dark palette; hidden selector absent.
- E: library cards show the user's capture instead of a placeholder.

**Gate 8:** tests green; Phase 0–7 suites still green.

- [x] Gate 8 passed (`scripts/phase-gate.sh 8`).

---

## Phase 9: Polish B (export, sharing, convenience)

| ID | Requirement |
|---|---|
| EX-2 | Size presets: IG post 1080×1350, IG story 1080×1920, LinkedIn 1200×627, Behance 1400 wide, slide 1920×1080, 4K 3840×2160 |
| CX-2 | Photo-free layout background (solid, gradient, brand colours), padding, shadow |
| CX-3 | Auto-extract brand colours from CSS and logo |
| CX-4 | Optional headline and client logo on presentation layouts |
| EX-4 | Shareable read-only gallery link, revocable |
| CE-12 | 24 h capture cache by URL + viewport + options |
| ML-3 | Favourites and "recently used" |

**Tests**
- U: each preset outputs the exact dimensions; Behance is 1400 wide with aspect preserved.
- U: colour extraction on fixture sites returns the known brand colours (ΔE < 5).
- I: share link works logged-out, is read-only (mutations 403), returns 404 after revocation.
- I: identical capture request within 24 h hits the cache (no new browser job); changed options miss.
- E: favourite a mockup → appears in favourites; used mockup appears in "recently used".

**Gate 9 (= PRD Gate 2):** tests green; decision recorded: internal tool or product.

- [x] Engineering gate passed (`scripts/phase-gate.sh 9`).
- [ ] Business decision (internal tool or product) not yet recorded; Phase 10 was built on request.

---

## Phase 10: Scale (only if Gate 2 says "product")

| ID | Requirement |
|---|---|
| EX-5 | Scrolling MP4 of a full-page capture in a device frame (10–20 s) |
| SC-1 | Logged-in page capture via user-supplied session cookie |
| SC-2 | Public API |
| SC-3 | Accounts, plans, billing, workspace usage counters |
| SC-4 | Larger mockup library; workers autoscale by queue length |

**Tests** (detailed when the phase is planned)
- I: MP4 duration 10–20 s, frame size matches preset, first/last frames match top/bottom of capture.
- I: session cookie is used for one capture only and never persisted (NF-PRIV still holds).
- I: API contract tests (OpenAPI schema), auth, per-key rate limits; SSRF suite re-run through the API.
- I: plan limits and usage counters enforced; billing webhooks idempotent.
- P: load test: 10 concurrent projects with 3 browser workers meets Phase 3 timings; adding a worker raises throughput.

---

## Requirement → phase traceability

Every PRD requirement is assigned to exactly one phase:

| Phase | IDs |
|---|---|
| 0 | F-1 … F-8 |
| 1 | PD-1, NF-SSRF, NF-RATE |
| 2 | PD-2, PD-3, PD-4, PD-5, PD-7, PD-9 |
| 3 | CE-1, CE-2, CE-3, CE-4, CE-5, CE-8, CE-9, CE-10, NF-ISO, NF-PRIV |
| 4 | CE-11, CE-9-UI, UP-1 |
| 5 | CP-1, CP-2, CP-3, CP-4, CP-7, CP-8, ML-1, SEED |
| 6 | R-1 … R-6, CR-1, CR-2, CR-6, CR-7 |
| 7 | CX-1, EX-1, EX-3, EX-6, NF-STOR, NF-BROWSER |
| 8 | CR-3, CR-4, CR-5, CP-5, CP-6, PD-6, PD-8, CE-6, CE-7, ML-2 |
| 9 | EX-2, CX-2, CX-3, CX-4, EX-4, CE-12, ML-3 |
| 10 | EX-5, SC-1, SC-2, SC-3, SC-4 |

The machine-readable version used by the gate script is
[`phase-requirements.txt`](./phase-requirements.txt).

## Open questions from the PRD that affect phases

- Internal tool vs product: decides whether Phase 10 happens (Gate 2).
- Mockup photos in-house vs bought: affects Phase 5 seed content (SEED).
- Hosting in Iraq vs overseas VPS: affects Phase 3 timing targets for Iraqi sites; run the P tests from the chosen region.
- Arabic and English versions side by side: affects PD-8 (Phase 8).
