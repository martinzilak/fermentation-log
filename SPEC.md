# Fermentation Log — Spec

A small self-hosted PWA for logging fermented chilli sauce batches from an iPhone, at the jar and at the stove, usually with dirty or wet hands. It replaces a paper notebook. Data must stay exportable as plain files.

Read this whole file before writing code. Work milestone by milestone (§11). Ask the owner before deviating from a decision marked **Decided**.

---

## 1. Goals and non-goals

**Goals**
- Log a batch end to end on a phone: ingredients per processing step, timeline events, photos, voice notes, pH, bottling.
- Be usable with chilli-covered, wet or gloved hands (§8.1 is a hard requirement, not polish).
- Catch the fields the paper log keeps missing (pH, xanthan, vinegar type, bottle counts) with a bottling checklist.
- Compute derived values (salt %, durations, xanthan %, heat estimate) instead of typing them.
- Recipes with goals: fix the pepper amounts you have, and the app computes the rest from ratios and targets (§7.3).
- Export everything to Markdown + YAML frontmatter (one file per batch) and JSON. Plain files must outlive the app.

**Non-goals (v1)**
- No public internet exposure. Tailscale only.
- No Bluetooth devices (scales, pH meters).
- No Home Assistant integration yet. There is no temperature sensor near the ferment; leave a seam for it, nothing more.
- No multi-tenant or user management UI. Two or so trusted users, identified by Tailscale.
- No audio transcription.

## 2. Users and devices

- Primary: the owner, on iOS (iPhone), using the app installed to the Home Screen (standalone mode).
- Secondary: one more person who ferments with him, also via Tailscale.
- Desktop browser use is occasional (review, recipes, export). It must work but is not the design target.

## 3. Hosting and access — **Decided**

- **Platform:** Unraid 7, one Docker container built from this repo's Dockerfile.
- **Network access:** Unraid's built-in per-container **"Use Tailscale"** toggle with **Tailscale Serve** enabled. The app gets its own tailnet name, e.g. `https://ferment.<tailnet>.ts.net`, with an HTTPS certificate handled by Tailscale.
- **No host port mapping.** The app must not be reachable from the LAN. A LAN port would let any LAN device forge the identity headers (§4), and plain `http://<ip>:port` is not a secure context, so the PWA features wouldn't work there anyway.
- **Bind address:** `127.0.0.1:${PORT}` inside the container, so only Serve can reach it.
- **Defence in depth:** the server trusts identity headers only when the TCP peer address is loopback. Any other peer gets `403`, except `GET /healthz`. This keeps auth safe even if someone later changes `BIND_HOST` or adds a port mapping.
- **Persistent data:** a single volume, `/data` in the container, mapped to `/mnt/user/appdata/ferment-log/` on the host. It holds:
  - `ferment.db` (SQLite, WAL mode)
  - `media/` (photos and voice notes)
  - `exports/` (nightly export, §10)
  - `backups/` (nightly `VACUUM INTO` snapshot, so the host's Appdata Backup job copies a consistent file)
- **Outbound internet:** needed only for Web Push in M6 (HTTPS to `*.push.apple.com`).

### 3.1 Milestone 0 must verify (deployment spike)

Unraid's documentation says the Tailscale integration does not work with every container. Before building features, ship a hello-world image and confirm all of these:

1. `https://ferment.<tailnet>.ts.net` loads from the iPhone over Tailscale.
2. `GET /api/me` returns the `Tailscale-User-Login` value Serve injects.
3. With the server bound to `127.0.0.1`, Serve still reaches it (i.e. Serve runs in the container's network namespace), and the peer address the server sees is loopback.
4. The app is **not** reachable from the LAN or the Docker bridge IP.
5. Record (don't fix): with Tailscale switched off and VPN On Demand configured for `*.ts.net`, does opening the Home Screen app bring Tailscale up?

**Fallback** if check 3 or 4 fails: a Docker Compose stack with the official `tailscale/tailscale` image as a sidecar (`TS_SERVE_CONFIG` pointing to a `serve.json`, app container using `network_mode: service:tailscale`). Document whichever path works in the README.

### 3.2 iOS notes for the README

- Recommend enabling Tailscale's **VPN On Demand** on the iPhone with the rule that connects automatically for `*.ts.net` hostnames.
- Install the app via Safari → Share → Add to Home Screen.

## 4. Authentication — **Decided**

- Trust the `Tailscale-User-Login` and `Tailscale-User-Name` headers set by Serve (only from a loopback peer, §3). Serve strips client-supplied copies of these headers.
- `ALLOWED_LOGINS` env var: comma-separated list of logins. A request with a missing or non-allowed login gets `403` with a short plain-text explanation.
- Tailscale does not populate identity headers for traffic from **tagged** client devices. If a phone gets 403 with no header, the README should mention this as the first thing to check.
- **Dev mode:** `DEV_USER=<login>` makes the server act as that user without headers, from any peer. The server must refuse to start if `DEV_USER` is set while `NODE_ENV=production`.
- Every write records `author` (the login) and `created_at`.

## 5. Tech stack — **Decided** (versions: use current stable releases)

- **Language:** TypeScript, `strict` on, end to end.
- **Runtime:** current Node.js LTS. Base image: a slim Debian Node image (alpine only if M0 shows it works with Unraid's Tailscale injection).
- **Server:** Hono on `@hono/node-server`. It serves both the API and the built PWA.
- **Database:** SQLite via `better-sqlite3`, plain SQL, numbered migration files in `migrations/` with a tiny runner. No ORM.
- **Validation:** `valibot` schemas in `src/shared`, used by both client and server. On the server, validate requests with `@hono/standard-validator` (or `@hono/valibot-validator`).
- **Client:** Vite + React + TypeScript.
  - **UI:** Tailwind CSS v4 + **shadcn/ui** (Radix-based components generated into `src/web/components/ui`, so they are owned and editable). Follow the official Vite install guide at ui.shadcn.com.
  - shadcn defaults are desktop-sized. Override sizes globally to meet §8.1; don't scatter one-off overrides.
  - `vite-plugin-pwa` for the manifest and service worker.
  - Icons: `lucide-react` (comes with shadcn).
- **Tests:** `vitest`, for derived calculations, recipe maths, import/export round-trip and API handlers.
- **Package layout:** a single package with `src/server`, `src/web` and `src/shared`. No monorepo tooling.

### Environment variables

| Var | Purpose | Default |
|---|---|---|
| `PORT` | Server port inside the container | `3000` |
| `BIND_HOST` | Listen address | `127.0.0.1` |
| `DATA_DIR` | Data root | `/data` |
| `ALLOWED_LOGINS` | Comma-separated Tailscale logins | *(required in production)* |
| `DEV_USER` | Dev-only fake login | unset |
| `TZ` | Timezone for dates and schedules | `Europe/Bratislava` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (M6) | unset |

## 6. Domain model

All IDs are **client-generated UUIDs**, so the offline outbox (§8.5) can replay writes idempotently. Weights are grams (`REAL`). Dates are ISO 8601; timestamps are stored in UTC and shown in local time.

### 6.1 Core idea: a batch is an ordered list of steps

A batch is not "ferment + blend". It is a sequence of **steps**, each with its own additions. This covers real-world variations such as blending before *and* after cooking, straining, or adding xanthan only at the end:

```
ferment → blend → cook → blend → bottle
ferment → blend → strain → cook → bottle
```

### 6.2 Tables

**`batches`**
- `id`
- `number`: INTEGER UNIQUE, the human batch number (#1, #2, …)
- `name`: optional
- `color`: optional free text
- `status`: `planned | fermenting | processing | bottled | archived`
- `recipe_id`: optional FK
- `notes_md`: free-form Markdown body
- `created_at`, `updated_at`, `author`

**`steps`**
- `id`, `batch_id`, `position`
- `type`: `ferment | blend | cook | strain | rest | other`
- `date`: nullable
- `params`: JSON, typed per `type`:
  - `ferment`: `{ vessel_id?, vessel_tare_g }` (the tare is required for new batches and optional for imported ones)
  - `cook`: `{ temp_c?, minutes? }`
  - `strain`: `{ removed_g? }`
  - others: `{}`
- `note`: optional

**`ingredient_lines`** (additions to a step)
- `id`, `batch_id`, `step_id`, `position`
- `name`: free text, any language (Slovak is common)
- `local_name`: optional nickname, e.g. "tučné"
- `kind`: `pepper | vegetable | fruit | aromatic | herb | water | salt | mash | brine | acid | sweetener | thickener | other`
- `grams`: actual weighed amount (nullable while planned)
- `planned_g`: snapshot from the recipe at batch creation (nullable)
- `lot_id`: optional FK to `pepper_lots` (peppers only)
- `catalog_id`: optional FK to `catalog_items` (non-pepper ingredients)
- `shu_min`, `shu_max`: optional per-line override. A single legacy value is stored as `min = max`.
- `shu_source`: optional URL or `legacy-log`
- `note`: optional

**`varieties`** (pepper cultivars, editable in the app)
- `id`, `name`, `species` (e.g. *C. annuum*, *C. chinense*), `local_names` (JSON array)
- `shu_min`, `shu_max`: either may be null if only one bound is known
- `shu_source`, `notes`

**`pepper_lots`** (where a given year's peppers came from)
- `id`, `variety_id`
- `season`: year
- `origin`: `grown | bought | gift`
- `propagation`: `seed | sapling` (only when `origin = grown`)
- `supplier`: free text or URL (seed shop, nursery, market, person)
- `acquired_on`: optional date (when the seeds, saplings or pods were bought or received)
- `notes`

The same variety can have many lots, e.g. Habanero grown from seed in 2025, bought as a sapling in 2026, or bought as fresh pods at a market. SHU resolution for a line is: line override → variety.

**`catalog_items`** (non-pepper ingredients, for autocomplete and aliases)
- `id`, `name` (canonical), `kind`, `aliases` (JSON array), `notes`
- Seed entry: **`Ocot kvasný liehový 8 %`** (distilled spirit vinegar), kind `acid`, aliases `["ocot"]`.
  - In the owner's notes, a bare "ocot" always means this one.
  - The importer and the name autocomplete resolve aliases to the canonical name and keep the original text in `note`.

**`vessels`** (fermenting crocks; the owner has more than one)
- `id`, `name` (e.g. "Crock A"), `notes`
- There is deliberately no stored tare. The empty vessel is weighed fresh at the start of every ferment step and saved in that step's `params.vessel_tare_g`.

**`bottle_types`**
- `id`, `name` (e.g. "Woozy 150 ml"), `volume_ml`, `notes`

**`events`** (the timeline)
- `id`, `batch_id`, optional `step_id`
- `type`: `note | photo | voice | ph | burp | weigh | issue | tasting | bottled`
- `occurred_at`, `author`, `text`: optional
- `payload`: JSON, typed per `type` with valibot. Shapes:
  - `ph`: `{ value, method: "meter" | "strip" }`
  - `weigh`: `{ gross_g }` (net = gross − vessel tare of the ferment step)
  - `issue`: `{ kind: "kahm" | "mold" | "leak" | "other" }`
  - `tasting`: `{ rating: 1..5 }`
  - `bottled`: `{ fills: [{ bottle_type_id, count }], leftover_g?, total_g?, ph?, ph_not_measured_reason? }`
  - `photo`, `voice`, `note`, `burp`: `{}` (the content is in the attachments or `text`)

**`attachments`**
- `id`, `event_id`
- `type`: `photo | audio`
- `file`, `thumb` (photos only): relative paths under `media/`
- `taken_at`: from EXIF for photos if present, otherwise capture time
- `duration_s` (audio), `width`, `height` (photos)

**`recipes`** and **`recipe_lines`**: see §7.3.

**`settings`**: key/value, e.g. `target_salt_pct` (default **3.0**)

**`push_subscriptions`**: M6 only.

### 6.3 Status transitions

- Creating a `ferment` step with a date → `fermenting`.
- Any later step with a date → `processing`.
- A `bottled` event → `bottled`.
- Manual override is allowed in the edit screen.

## 7. Calculations

### 7.1 Bases (shared by derived values and recipes)

| Base | Definition |
|---|---|
| `peppers` | Ferment-step lines of kind `pepper` |
| `solids` | Ferment-step lines excluding `water` and `salt` |
| `ferment_total` | Ferment-step lines excluding `salt` (= solids + water) |
| `mash` | Lines of kind `mash` |
| `sauce` | All post-ferment additions |

### 7.2 Derived values (compute, never store)

**Salt %**
- `salt / ferment_total × 100`
- The owner's batches are all about 3.0 %. This definition must reproduce the seed data (test it):

| Batch | Salt % |
|---|---|
| 1 | 3.00 |
| 2 | 2.96 |
| 3 | 3.04 |
| 4 | 2.97 |

**Suggested salt for the target %**
- `target_pct × ferment_total / 100`, shown live while entering the ferment step.

**Ferment days**
- Ferment step date → date of the first later step that has one, falling back to the `bottled` event date.
- Seed data expects **20, 17, 22 and 19** days.

**Sauce total**
- Sum of `sauce`. Show it as "additions"; it is not the yield. Water lost while cooking is not tracked. A measured `total_g` at bottling overrides it for display.

**Xanthan %**
- `thickener / sauce total × 100`. Only shown when the sauce includes mash. Batch 4 expects ≈ **0.042 %**.

**Heat estimate** (rough)
- `Σ(pepper grams × SHU) / solids`
- Show a range: the SHU minimums give the low end, the maximums the high end.
- If a variety has only one bound, use it for both.
- Label it clearly as a rough estimate.

**Net weight** for weigh events
- `gross_g − vessel_tare_g`

**Bottled volume**
- `Σ(count × volume_ml)` over the fills.

### 7.3 Recipes with goals

A recipe is a reusable template. You fix what you have (usually pepper amounts from the harvest) plus goals, and the app computes the rest.

**`recipes`**
- `id`, `name`, `notes_md`
- `heat_target_shu`: optional
- `created_from_batch_id`: optional

**`recipe_lines`**
- `id`, `recipe_id`
- `step_index` and `step_type`, mirroring the batch steps
- `position`, `name`, `kind`, `variety_id?`, `catalog_id?`
- `mode`: `grams | percent | remainder`
  - `grams`: an absolute amount
  - `percent`: `percent` of `base` (one of the bases in §7.1)
  - `remainder`: reserved, not in v1
- `solve_for_heat`: boolean; at most one line per recipe

Percentages are **baker's-percentage style**: relative to a base, not to the total. Example: garlic `5 %` of `peppers`, salt `3 %` of `ferment_total`, water `120 %` of `solids`, xanthan `0.3 %` of `sauce`.

**Evaluation order** (avoids circular definitions):
1. Absolute (`grams`) lines.
2. Percent lines, base by base in the order `peppers → solids → ferment_total → mash → sauce`.
3. Each base's sum includes only the lines already computed. A line never counts towards its own base.
   - Example: water at 120 % of `solids` is not part of `solids`.
   - Example: xanthan at 0.3 % of `sauce` is computed from the sauce without itself.
4. `mash`-based and post-ferment `sauce`-based lines stay "pending" until the mash is actually weighed.

**Heat goal**
- If `heat_target_shu` is set and one `grams` line is marked `solve_for_heat`, find that line's grams so the heat-estimate midpoint (§7.2) meets the target.
- Use bisection: recompute the whole recipe each iteration, since percent lines move with it.
- If no non-negative solution exists, say so plainly; don't clamp silently.
- Without a solve line, just show the estimated range against the target.

**Using a recipe**
- "Start batch from recipe" → the user enters the actual pepper grams → planned amounts are computed and snapshotted into `planned_g`.
- In weighing mode the user then logs the actual grams per line, with the planned value shown large and the deviation shown.

**Saving a recipe**
- "Save batch as recipe" converts a batch's actual lines into a recipe: peppers become `grams`, the other ferment lines become percent of `peppers`, and salt becomes percent of `ferment_total`.
- The user can edit the result afterwards.

### 7.4 pH display rule

| pH | Colour | Text label |
|---|---|---|
| ≥ 4.6 | Red | "Above 4.6 safety threshold" |
| 4.0 – 4.6 | Amber | "Below 4.6, above common 4.0 target" |
| < 4.0 | Green | "Below 4.0" |

- Always show the text label, never colour alone.
- Show it as information, not as a blocker.
- Provide a short info sheet linking sources.

## 8. Client app

### 8.1 Dirty-hands UX — hard requirements

Assume imprecise input: a knuckle, a gloved finger, a wet finger, phone propped on the counter, screen partly splattered.

1. **Big targets.**
   - Primary actions in active flows: full width, at least 64 px tall.
   - Anything tappable: at least 56 px, with at least 12 px gaps.
2. **Thumb zone.** Actions live in the bottom half of the screen; nothing important sits in the top corners.
3. **Tap only.**
   - No core action may require a swipe, long-press, drag, pinch or double-tap.
   - Don't fight the iOS edge-swipe-back gesture.
4. **Forgiving.**
   - No confirmation dialogs in flows. Every action shows a large **Undo** toast (8 s).
   - Destructive edits live only in the edit screen.
   - Primary buttons are debounced (about 500 ms) against accidental double taps. Only a second tap near the first (within about 48 px) is dropped; a quick tap elsewhere goes through.
5. **Custom numpad for grams.**
   - Full-screen 3×4 keypad with huge keys, decimal key, backspace and a big **Next** button. The iOS keyboard is not used for weights.
   - Accept comma or dot.
6. **Weighing mode.**
   - One ingredient per screen, in order.
   - The name, planned grams (if any) and the number being typed are shown at at least 48 px type.
   - **Tare first.** Weighing mode for a ferment step always opens with "Put the empty crock on the scale": pick the vessel (chips) and enter its weight. That becomes the step's tare.
   - Tare helper for additions: "container on the scale?" → enter the container weight once and type gross weights; the app stores net.
7. **One thing per screen** in flows (new batch, step additions, bottling). No scrolling needed for the current action.
8. **Keep the screen awake** during flows, using the Screen Wake Lock API. It works in Home Screen web apps since iOS/iPadOS 18.4. Fail silently where unsupported.
9. **Voice notes.**
   - A big tap-to-start, tap-to-stop record button creates a `voice` event, via `MediaRecorder` (Safari produces MP4/AAC).
   - Plain text notes are also fine; iOS keyboard dictation works on them.
10. **Photos.** One big button opens the camera directly.
11. **Readable.** Base text at least 18 px, key numbers at least 32 px, high contrast in both light and dark mode.
12. **Choices over typing.** Chips for kind, recent and catalog names, varieties, and bottle types. The next batch number is pre-filled.
13. **Autosave.** Every entry is saved immediately; there is no "Save" step. Leaving a flow mid-way loses nothing.
14. **Standalone mode.** Respect safe-area insets; don't rely on browser chrome.
15. **Language.** The UI is English with i18n-ready strings. Data is whatever the user types.

### 8.2 Screens

1. **Batch list**
   - One card per batch: number, colour dot, status, and a day counter for fermenting batches ("Day 7").
   - Newest first. A big **New batch** button.
2. **New batch**
   - Number and start date (default today), whether the container needs burping (§15.11), then "from recipe" or "blank".
   - Then weighing mode, which starts with the vessel and tare (§8.1 item 6) and continues with the ferment additions.
   - Live salt % and suggested salt are shown throughout.
3. **Batch detail**
   - Header: key stats (salt %, days, status, heat range).
   - Steps with their additions.
   - Timeline, newest first, with thumbnails and audio players.
   - Bottom bar: **Photo**, **Voice**, **pH**, **Note**, **More** (weigh, issue, tasting); **Burped** for a jar that needs burping (§15.11).
   - **Add step** button (blend / cook / strain / rest / other), which opens weighing mode for that step's additions.
4. **Bottling checklist**
   - Fills: pick a bottle type and a count, with repeatable rows; add a new bottle type inline.
   - Required: pH (or "not measured" with a reason), at least one fill row, at least one photo, and confirmation that the step additions are complete.
   - Optional: leftover grams, measured total.
   - Shows the bottled volume. Saving creates a `bottled` event.
5. **Edit batch:** all fields, step and line CRUD, manual status override.
6. **Recipes:** list, edit (a desktop-friendly table is fine), and the live calculator with a heat-goal readout.
7. **Varieties and lots:** edit pepper reference data; add lots per season.
8. **Catalog and bottle types:** small edit lists.
9. **Export:** download a zip of everything, or a single batch `.md`. Shows the last nightly export time.
10. **Settings:** target salt %; in M6, notifications and the list of reminders (§15.11).

### 8.3 Photos

- Capture with `<input type="file" accept="image/*" capture="environment">`.
- Read EXIF (`exifr`) for `taken_at` before resizing.
- Resize client-side to a JPEG: long edge about 2048 px, plus a thumbnail of about 400 px. Upload both.
- The server validates MIME type and size.
- **Verify on a real iPhone** that HEIC captures decode and resize correctly; handle failure gracefully.

### 8.4 Voice notes

- `MediaRecorder` on the microphone stream, with a maximum length of 3 minutes.
- Upload as `audio/mp4`. Show the duration in the timeline.
- Request microphone permission on the first tap, with a short explanation.

### 8.5 Connectivity (online-first with an outbox)

- The service worker caches the app shell so the app opens without the server.
- Writes (lines, steps, events, attachments) go through an **IndexedDB outbox**. They are replayed in order with backoff, and are idempotent because of client UUIDs.
- The UI shows a pending-items count.
- If `/api/me` is unreachable, show a large banner: "Can't reach the server — is Tailscale on?" Keep the outbox.
- Reads are shown from the last cached data when offline. Full offline-first sync is out of scope.

## 9. Nudges (M6)

- **Delivery.** Web Push with VAPID. The server sends to Apple's push service, which delivers to the phone.
  - **Delivery does not depend on Tailscale being on** for the phone. The server only needs outbound HTTPS to `*.push.apple.com`.
- **Tapping a notification** opens the app.
  - If Tailscale is off, the cached shell still loads, deep-links to the batch from cached data and shows the §8.5 banner.
  - New entries queue in the outbox.
- **Subscribing.** This (one time per device) needs the server reachable.
- **iOS requirements.** The app must be installed to the Home Screen. The permission prompt must be triggered by a user tap ("Enable reminders" button). Every push must show a notification, because Safari revokes permission for invisible pushes.
- **Scheduler.** In-process. The reminders are a list of rules edited in Settings (§15.11): an action (photo, burp, pH check, own text) on a ferment day, repeating every few days or once, from an hour.
- **Quiet hours:** 22:00–08:00.

## 10. Export and import

### 10.1 Batch file format (canonical; see `seed/`)

- Markdown with YAML frontmatter, one file per batch, named `batch-NNN.md`.
- The frontmatter holds the structured data; the body holds free-form notes.
- Frontmatter keys:
  - `batch`, `color`, `status`, `recipe` (name or null)
  - `steps[]`: each with `{ type, date, params?, add[] }`; a ferment step's `params` may include `vessel` (name) and `vessel_tare_g`
  - `bottled` (date)
  - `output`: `{ ph, fills[]: { bottle, ml, count }, leftover_g?, total_g? }`
- Each `add` entry: `{ name, local?, kind, g, planned_g?, lot?, shu?, shu_source?, note? }`
  - `lot`: `{ origin, propagation?, season?, supplier?, acquired? }`
  - `shu`: a number, `[min, max]`, or `[null, max]`
- Body sections: `## Notes`, `## Timeline` (export only, generated from events, with attachment paths `media/<file>`), `## Tasting`.

### 10.2 Export

- On demand from the UI.
- Nightly at 03:00 local, written to `DATA_DIR/exports/`:
  - one `.md` file per batch
  - `all.json` (a full dump of every table)
  - a `media/` folder with copies or hard links
- Nightly `VACUUM INTO DATA_DIR/backups/ferment-YYYYMMDD.db`, keeping the last 14.

### 10.3 Import

- CLI: `npm run import -- seed/*.md`. This creates batches, steps, lines, varieties and lots as needed, and resolves catalog aliases.
- Also import legacy JSON files from the original log. Their format: `batchNumber`, `color`, `fermentationStartDate`, `bottlingDate`, and `ingredients[]` with `name`, `amountInG`, `isFermented`, `spicinessInShu`, `isPartiallyUsed`.
- Mapping for legacy JSON:
  - `isFermented: true` → the ferment step; otherwise one blend step
  - `spicinessInShu` → `shu_min = shu_max`, with `shu_source: legacy-log`
  - Ignore a batch-level `spicinessInShu`
- Import is idempotent by batch number: skip existing batches unless `--force`.
- **Round-trip test:** import the seeds, export, and compare the frontmatter (normalised).

## 11. API sketch

All routes are under `/api` and are JSON unless noted. Every route requires an allowed login. Use valibot for validation on both sides.

**Identity and health**
- `GET /api/me` → `{ login, name }`
- `GET /healthz` → `ok` (no auth, any peer)

**Batches**
- `GET /api/batches`
- `POST /api/batches`
- `GET /api/batches/:id` (includes steps, lines, events, attachments and derived values)
- `PATCH /api/batches/:id`

**Steps and lines**
- `POST /api/batches/:id/steps`
- `PATCH /api/steps/:id`
- `DELETE /api/steps/:id`
- `POST /api/steps/:id/lines`
- `PATCH /api/lines/:id`
- `DELETE /api/lines/:id`

**Events and attachments**
- `POST /api/batches/:id/events`
- `PATCH /api/events/:id`
- `DELETE /api/events/:id`
- `POST /api/events/:id/attachments` (multipart: `file`, optional `thumb`)
- `GET /media/:file` (auth, immutable cache headers)

**Reference data:** `GET`/`POST`/`PATCH` for each of
- `/api/varieties`
- `/api/lots`
- `/api/catalog`
- `/api/bottle-types`
- `/api/vessels`

**Recipes**
- `GET /api/recipes`
- `POST /api/recipes`
- `GET /api/recipes/:id`
- `PATCH /api/recipes/:id`
- `POST /api/recipes/:id/evaluate` (body: actual pepper grams → computed plan; the maths lives in `src/shared` so the client can also compute locally)
- `POST /api/batches/:id/save-as-recipe`

**Export**
- `GET /api/export.zip`
- `GET /api/batches/:id/export.md`

**Push (M6)**
- `POST /api/push/subscribe`
- `DELETE /api/push/subscribe`

All `POST` routes accept the client-generated `id` and are idempotent: a repeated `id` returns the existing record.

## 12. Milestones and acceptance criteria

**Priority: get to real use fast.** The owner wants to log batches 5+ in the app right away and iterate on it while using it. Ship the thinnest end-to-end slice first (M0–M2a), deploy it, then improve in small increments. Each milestone ends in a deployable image.

**M0 — Deployment spike and fast deploy loop**
- Dockerfile, hello-world server and README deploy steps for Unraid (template settings: bridge network, Use Tailscale on, Serve on the app port, no port mappings, `/data` volume, env vars).
- Checks 1–4 in §3.1 pass, or the documented fallback is in place. Check 5 is recorded.
- A one-command redeploy, `scripts/deploy.sh`: build the image on the NAS (or build locally and push to a registry), then restart the container. Iterating must not require clicking through the Unraid UI.
- Migrations run automatically on start-up, and every deploy is preceded by an automatic `VACUUM INTO` backup.

**M1 — Data and API**
- Migrations, every table in §6, the API in §11 (recipes may be stubbed) and the derived values in §7.2 with tests.
- The import CLI loads `seed/batch-001.md` … `batch-004.md`.
- Tests reproduce the salt %, day counts and the batch-4 xanthan % in §7.2.

**M2a — Walking skeleton (deploy and start logging)**
- Batch list, new batch (blank, no recipe) with tare-first weighing mode and the custom numpad, and batch detail with the timeline.
- Photo, note and pH events; add a step with its additions.
- Undo on every action.
- The §8.1 sizing and thumb-zone rules apply from day one; polish comes later.
- After this, batches 5+ get entered in the app (or via a hand-written `seed/batch-005.md` + import, whichever is faster).

**M2b — Rest of the kitchen UX**
- Remaining screens from §8.2 (bottling checklist, edit, varieties and lots, catalog, bottle types). No vessels screen; see §15.
- The §15 changes: soft-deleted batches, no saved crocks, one-off bottles at bottling, English names and normalized ingredients.
- Every §8.1 requirement is met. Do a checklist review against it, and test on a real iPhone with wet fingers or gloves.
- Voice notes, wake lock and the bottling checklist's required fields.

**M3 — Export and backups**
- §10.2 nightly and on-demand export, backups with retention, and the round-trip test.

**M4 — Outbox and offline shell**
- §8.5 behaviour.
- Kill the server mid-session → entries queue → restart → entries sync, with no duplicates.

**M5 — Recipes**
- §7.3 evaluation with tests: base ordering, no self-reference, the heat solve (including the no-solution case) and save-batch-as-recipe.
- Start-from-recipe flow with planned vs actual in weighing mode.

**M6 — Nudges**
- §9.

**Later / ideas (do not build without asking)**
- Home Assistant temperature history attached to ferments.
- Cross-batch comparison view.
- Printable labels.
- Audio transcription.

## 13. Conventions for the implementer

- Keep it small. Every new dependency needs a one-line justification in the commit message.
- README covers: local dev (`DEV_USER`), building the image, Unraid template settings, the iOS install and VPN On Demand tip, backup and restore.
- Never log media data or full request bodies.
- Commit seeds and migrations; never commit `/data`.

## 14. Open data questions

- **Sparkler:** the seed shop page lists it as *C. annuum*, up to 160,000 SHU; the minimum is unknown, so it is seeded as `[null, 160000]`.
- **Batch 4 vessel:** which of the two crocks was used is unknown; the 1669 g tare is the empty crock.
- **Batches 5+** are in progress on paper. Enter them as soon as M2a is deployed.

## 15. Addendum — 2026-10-29, owner review of M2a — **Decided**

Where this section conflicts with an earlier one, this section wins.

### 15.1 Settled in M2a

- **Ferment day counter.** The start date is **Day 1**. This is display only: the API's `ferment_day` stays days elapsed (0 on the start date), and ferment duration (§7.2: 20, 17, 22 and 19 days) is unchanged.
- **Numpad screens.** Next takes two thirds of the bottom row, beside Back, rather than the full width of §8.1 item 1. This keeps the typed number on screen on smaller phones.
- **API additions to §11:**
  - `DELETE /api/batches/:id`
  - `GET /api/lines/recent`, for the ingredient chips
  - `GET`/`PATCH /api/settings`, for the target salt %

### 15.2 For M2b

**Soft delete for batches**
- `DELETE /api/batches/:id` marks the batch deleted (`deleted_at`) instead of removing its rows. Undo restores it.
- Deleted batches are left out of the list, the next-number suggestion and exports. Their numbers can be used again.
- Bottled and archived batches can't be deleted; the API answers 409. A finished batch is archived instead.

**No saved fermentation vessels**
- The owner has two crocks that look identical but weigh slightly differently. Naming them adds nothing, because the empty crock is weighed at every ferment step anyway (§6.2).
- Weighing mode goes straight from "Put the empty crock on the scale" to the tare numpad. There are no crock chips and no "New crock".
- New ferment steps store only `vessel_tare_g`. `vessel_id` values recorded earlier stay readable but nothing new sets one, and there is no vessels screen.

**Bottling: saved bottle types plus one-off bottles**
- Bottle types (name, volume) stay for bottles used regularly, and they appear as chips in the bottling checklist.
- A fill row can instead be a one-off bottle: volume in ml, count and an optional label. It doesn't create a bottle type.
- `bottled` fills become `{ bottle_type_id, count }` or `{ volume_ml, count, label? }`. Bottled volume (§7.2) sums both kinds.

### 15.3 From the first M2a test

**Settled**
- **One scroller per screen.** The page itself scrolls, with the title and the actions pinned. There are no scroll areas inside scroll areas.
- **Ingredient chips.**
  - Before anything is typed, up to 8 chips show: the names this step type usually takes come first, then the most recent.
  - A search shows up to 12, and it matches the name, the aliases and the kind ("salt" finds Soľ).
  - Matching ignores case and accents, so an existing name is never entered a second time. A new name gets single spaces and a capital first letter.
- **No nicknames in the UI.** `local_name` and a variety's `local_names` stay in the data for imported batches but aren't shown or asked for.

**For M2b**
- **English everywhere.** The UI and the data are English, so ingredient and variety names are English (Water, Salt, Garlic).
  - The Slovak names become aliases, so typing "soľ" still finds Salt.
  - A migration converts the existing data once.
  - The `seed/` files stay as the original Slovak record; the importer maps their names through the aliases.
- **Normalized ingredients.** Every ingredient line refers to one entry:
  - A non-pepper line refers to a catalog item (name, kind, aliases).
  - A pepper line refers to a variety through a new `variety_id` on the line. The lot stays optional, and when one is given it must belong to that variety.
  - The line's `name` is a copy of the entry's name, and it is updated when the entry is renamed.
  - Typing a new name in weighing mode creates the entry.
  - When a name is entered through an alias, the original text goes in the line's `note`, as in §6.2.
  - The catalog screen can rename an entry, change its kind, edit its aliases, merge two entries and delete unused ones. When two entries are merged, the lines move to the one kept and the other's name becomes an alias.

### 15.4 Details settled while building M2b

- **API additions to §11:**
  - `POST /api/batches/:id/restore` undoes a delete. It answers 409 if a live batch has taken the number since.
  - Ingredient lines take `variety_id`. On POST and PATCH the server resolves the entry: the ids sent win, a lot sets the variety, and otherwise the name finds an entry or creates one. The line then takes the entry's name and kind.
  - Varieties take `aliases`. A name or alias can belong to only one entry (ignoring case and accents); a clash answers 409. Catalog items can't have the kind `pepper`.
  - Renaming an entry, or changing a catalog item's kind, updates its lines.
- **More API additions to §11:**
  - `POST /api/catalog/:id/merge` and `POST /api/varieties/:id/merge` take `{ into }`. The lines (and a variety's lots) move to `into`, the merged entry's names become aliases, and it is deleted. A variety without SHU takes the merged one's.
  - `DELETE` on catalog items, varieties, lots and bottle types answers 409 while anything uses them. Their lists carry a `uses` count.
  - Moving a lot to another variety moves its lines with it.
- **Merging has no Undo.** It's the one edit that can't be taken back with a tap. The edit screen asks for the entry to keep and then a separate "Merge into …" tap.
- **Bottling photos** are ordinary `photo` events taken during the checklist; the `bottled` event itself has no attachments.
- **Alias notes.** Weighing mode still writes "recorded as '…'" in the note when a name is picked through an alias. The importer doesn't, because the seed files keep the original names.

### 15.5 From the M2b test

- **Batch colour at bottling.** The colour marks the caps or labels, so it is chosen in the bottling checklist, right after the bottles, rather than when the batch is started (§8.2 item 2). The edit screen can still change it.
- **No voice notes.** They are dropped: text notes with iOS dictation cover the same need, and stay searchable. This replaces §8.1 item 9's record button, §8.4, Voice in the §8.2 bottom bar, and the voice notes in M2b. The `voice` event type and audio uploads stay in the API, so nothing recorded earlier is lost.

### 15.6 Details settled while building M3

- **Batch file additions to §10.1.** A step may carry `note`. `output` may carry `ph_not_measured_reason`. A fill without `bottle` is a one-off bottle, `{ ml, count, label? }` (§15.2). Exports write these and the importer reads them, so importing an export and exporting again changes nothing.
- **Names in exports** are the entries' English names (§15.3). The round-trip test maps the seed files' names through the aliases before comparing.
- **Deleted batches** are left out of `all.json` and `media/` as well as the batch files. The database snapshots still have them.
- **Timeline.** One list item per event, oldest first, in `TZ`: `- YYYY-MM-DD HH:MM · <what>: <text>`, with continuation lines and media links (`media/<file>`) indented under it.
- **API addition to §11:** `GET /api/export/status` returns `{ last_export_at, last_backup_on }` for the Export screen.
- **A missed night.** If the server was down at 03:00, the export and snapshot run when it next starts.
- **The zip** is written by a small built-in writer (no dependency). Photos are stored, not recompressed. It has no zip64, so it refuses an export over 4 GiB or 65,535 files.

### 15.7 Details settled while building M4

- **What goes through the outbox:** every write to batches, steps, lines, events and attachments (§8.5 lists lines, steps, events and attachments; batches are included so a batch can be started offline). Reference data (catalog, varieties, lots, bottle types, settings, merges) is saved directly, and offline it fails with "Not saved".
- **Queued writes show at once.** They are laid over the cached batch views and the batch list until the server's data includes them, so weighing keeps its live salt % and the timeline shows the entry. Status and derived values are recomputed on the phone from the same shared code. A batch started offline is built from its queued writes.
- **Event times.** An event is dated when it is logged (`occurred_at` set on the phone), not when it reaches the server.
- **Retries.** Server errors, timeouts, 401, 403, 408 and 429 keep the write queued and retry with backoff (1 s doubling to 60 s), and also when the network or the app comes back. Any other 4xx is the server refusing that write: it is dropped and an error toast says why (for example a batch number taken in the meantime).
- **Offline reads.** Responses are kept in IndexedDB and shown when the server can't be reached. The reference lists weighing and bottling need are fetched when the app starts, so they are there offline. Photos are cached by the service worker (the newest 500).
- **The banner** sits in each screen's pinned header. Offline it shows "Waiting to sync: N"; online, while entries are still being sent, a quiet "Syncing: N".
- **Limits.** There is no screen to inspect or discard queued entries; a write the server keeps failing blocks the ones after it. The outbox assumes one open tab per device.

### 15.8 Details settled while building M5

- **Bases in a recipe.** Lines on the same base are computed from that base as it stood before any of them, so they don't count towards each other either. The weighed mash stands in for any mash line of the recipe.
- **Heat goal.** The solve line's grams are found by bisection between 0 g and 10 t. When the goal can't be reached, the message gives the heat range the line can reach, and the line gets no amount.
- **Save batch as recipe**, for the steps after the ferment, which §7.3 leaves open: thickeners become percent of `sauce`, other additions percent of `mash`, and the mash line itself is left out (it is weighed, not added). A line whose base is empty keeps its grams. The recipe is named after the batch ("Batch #9"), and the request goes through the outbox.
- **Recipe steps in a batch.** The n-th step of a type in the batch follows the n-th step of that type in the recipe.
- **Starting from a recipe** creates the ferment step with the recipe's ferment lines, still to weigh. Adding a later step to such a batch creates that recipe step's lines, with a Mash line first when their plan depends on the mash.
- **Planned vs actual.** A line's plan follows what has actually been weighed so far: percent lines from the real bases, and the heat line solved with the peppers actually weighed. The plan is snapshotted into `planned_g` when the line is weighed. While a base is still empty, the rule ("5 % of peppers") is shown instead of 0 g.
- **The recipe editor** saves each change at once with Undo, like the other edit screens; a change to a line sends all the lines (PATCH replaces them). `remainder` lines are not offered. There is no delete for recipes yet.
- **New lot while weighing** (asked for while testing M4): the lot step shows for every known pepper, with a New lot chip for this season's lot (grown from seed or sapling, bought, gift). New lots go through the outbox, so this works offline.

### 15.9 Recipe steps and the 2026 season

Asked for after M5, when loading the season's planned recipes.

- **Recipe steps** get their own table, `recipe_steps` (`recipe_id`, `step_index`, `type`, `note`), so a recipe can have steps without additions: a cook that only heats, the final strain. The note holds the step's method. A line's step always exists and the line takes its type; PATCH with `steps` replaces them, like `lines`. Migration 0005 gives existing recipes the steps their lines imply. Save batch as recipe keeps every batch step.
- **Adding a step to a batch from a recipe** offers the recipe's next step first, with its method: the first recipe step the batch has no step for yet, by the n-th-of-a-type matching above.
- **Migration 0006** deletes every batch the import didn't create (author other than `import`): the batches made in the app before the season were tests. Their photo and voice files stay in `media/`. It then adds the six planned recipes for 2026. Peppers keep the plan's grams; the rest of the ferment is a percentage of the peppers, water of the solids, salt 3 % of the ferment. Later additions are a percentage of the mash, taken to weigh what the ferment's solids do, and xanthan 0.15 % of the sauce. A range takes its middle; the plan's ranges and optional ingredients are in the recipe's notes. Every recipe goes ferment, blend, cook, blend (after cooling, xanthan last), strain.

### 15.10 Details settled while building M6

The schedule below was replaced by a list of rules after the M6 review (§15.11); the rest still holds.

- **The reminder hour** (`nudge_hour`, 8–21, default 18) is when the day's reminders start. A reminder that couldn't go out (no device subscribed, server down, push service failing) is tried every 5 minutes until the quiet hours, then let go. `nudges_sent (batch_id, day)` records a day once a device received it.
- **One reminder per batch per ferment day**, saying everything due that day: a photo on day 0; a photo and the pH on days 7 and 14; the burp from day 1 when on; "Ready for the next step?" on the ready day. Whatever was already logged that day (photo, pH, burp) is left out, and a day with nothing left sends nothing. Only batches that are fermenting and have a ferment date get reminders; day 0 is the ferment date in the server's time zone.
- **The notification** is titled `#N Name · day D`, opens the batch, and replaces an earlier one for the same batch.
- **Settings keys:** `nudge_hour`, `nudge_day0_photo`, `nudge_checks`, `nudge_burp` (0 or 1, burp off by default) and `nudge_ready_days` (0 turns it off). The schedule is shared; each phone turns its own reminders on or off.
- **Subscriptions** are stored by endpoint and dropped when the push service answers 404 or 410. They aren't in the export: they belong to a device, and a restored backup re-registers each phone the next time it opens Settings.
- **Without VAPID keys** the server runs as before, `GET /api/push` returns no key and the subscribe and test routes answer 409 (not 503, which the app reads as offline). Settings says reminders aren't set up.
- **Settings has "Send a test"**, which pushes to that phone only, to check the setup without waiting for a ferment day.

### 15.11 Owner review after M6 — 2026-10-30 — **Decided**

- **Burping is per batch.** Only a sealed jar needs burping; a crock with a water seal or an airlock burps itself. New batch asks which (starting from this phone's last answer), the ferment step stores it as `params.needs_burping`, and the edit screen can change it. A batch that needs burping gets **Burped** in its main buttons while it ferments; More no longer has it.
- **pH is the "ready to end the ferment?" check**, separate from burping and from photos.
- **Reminders are a list of rules** (`reminder_rules`): an action (`photo`, `burp`, `ph`, or `custom` with its own text), the ferment day it starts on, every how many days it repeats (0: once) and the hour it goes out from (8–21). Settings edits the list; each change saves the whole list (`PUT /api/reminders`) with Undo. Burp rules only reach batches that need burping. Rules due for a batch at the same time share one notification; a rule whose action was already logged that day (photo, burp, pH) is left out. `reminders_sent (batch_id, rule_id, day)` records each rule once a device got it.
- **Days count from 1:** the start date is Day 1, in the app and in reminders alike.
- **Migration 0008** turns the old settings into rules at the old hour: a photo on Day 1 (if it was on), a photo from Day 8 every 7 days (if the checks were on), a pH check from the day after the old "ready" day every 3 days (if set), and a daily burp from Day 2. The `nudge_*` settings and `nudges_sent` go.
- **Smaller fixes from the review:**
  - New batch puts the short choices first; recipes are a list, the picked one showing its ferment right under it.
  - A recipe batch takes the recipe's name.
  - Weighing: no salt figure until salt is in, a warning at Done when the salt is missing, low or high; with a container on, the big number is the net; plans show before the peppers are weighed (counting their plan), with a unit; a mash without a plan gets an estimate (the ferment's solids); the container doesn't carry over to the next ingredient; "Sauce" instead of "Additions" once the mash is in.
  - Back from the crock tare of an untouched new batch discards it, with Undo.
  - Step cards show the recipe's method, their lines open for editing, and the button says "Weigh the rest (N left)". Cook, strain and rest steps without lines don't open an empty weighing screen.
  - While fermenting, the timeline comes before the steps.
  - Ingredient search also finds close spellings; the new-name chip comes last.
  - The double-tap guard only drops a tap near the previous one (§8.1 item 4).
  - A toast goes along with its own screen change but not a later one.
  - Numbers keep their units on the same line, and nothing reads "−0 %".
