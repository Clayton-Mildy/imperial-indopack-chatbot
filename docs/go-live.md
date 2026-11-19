# Go-live guide

How to run the Imperial Indopack WhatsApp bot for real: configure it, set the bot up and fill the catalog,
connect the WhatsApp number with the AI switched off, then switch the AI on and test it from a personal phone
before the first customer. Follow the sections in order.
Names (variables, buttons, pages) are exactly what the code and the dashboard use.

Never paste a real key, token or password into chat, a ticket or this repo. Values live only in
`api/.env` and `dashboard/.env.local`.

## 0. Test locally first (no real number needed)

Do this before touching the real WhatsApp number. Needs Node 24 and Postgres 17 with pgvector.

1. In `api/.env` set the local overrides listed in `api/.env.example` ("Local dev overrides"):
   `NODE_ENV=development`, `WHATSAPP_TRANSPORT=capture`, `PUBLIC_BASE_URL=http://localhost:50070`,
   `SEED_API_KEY` (32+ characters, `openssl rand -hex 32`), and the Claude credentials the same way
   as production: `CLAUDE_CODE_OAUTH_TOKEN_1`, `_2`, `_3`, ... (one `claude setup-token` per account;
   `_1` serves until its limit, then `_2`, and so on) with `USE_CLAUDE_CLI=false` and any non-empty
   `ANTHROPIC_API_KEY` (never sent). Without tokens, `USE_CLAUDE_CLI=true` uses your own Claude Code
   login instead.
2. `cd api && npm install && npm run db:migrate && npm run seed:local` (admin, API key, a test phone number row).
   Then `npx tsx scripts/seed-default-prompt.ts` once for the default prompt.
   Login: `seed:local` creates the admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `api/.env`; if those
   are unset it uses `admin@imperial-indopack.example.com` / `changeme123` (local only).
3. From the repo root (`cd ..` if you are still in `api/`), if `dashboard/.env.local` does not exist yet:
   `cp dashboard/.env.example dashboard/.env.local`. Then set the two secrets without printing them (macOS
   `sed`; on Linux drop the `''` after `-i`):
   - `sed -i '' "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" dashboard/.env.local`
   - `sed -i '' "s|^API_SECRET_KEY=.*|API_SECRET_KEY=$(grep '^SEED_API_KEY=' api/.env | cut -d= -f2-)|" dashboard/.env.local`
     (the key is the hex string from `openssl rand -hex 32` in step 1; it must equal `SEED_API_KEY`).
   - Check, no values shown: `grep -c '^API_SECRET_KEY=.\+' dashboard/.env.local` and
     `grep -c '^AUTH_SECRET=.\+' dashboard/.env.local` must each print `1`.
4. `cd api && npm run catalog:demo` loads a DEMO catalog (product names end with `(CONTOH)`, fake prices).
5. Start both apps, each in its own terminal:
   - `cd api && npm run dev` (API, port 50070)
   - `cd dashboard && npm run dev` (dashboard, port 40070), then open http://localhost:40070/app/login and log in with the admin from step 2
6. Send a fake customer message: `cd api && npm run qa:say -- 081200000070 "berapa harga kertas supreme?"`
   (`qa:say` is added by the QA harness; if it is missing from `api/package.json`, that task is not merged yet).
   The bot's replies are appended to `api/logs/whatsapp-capture.jsonl` instead of going to WhatsApp.
7. Optional conversation QA suite (also added by the QA harness): `npm run qa:setup`, `npm run qa:api`,
   `npm run qa:run` (in `api/`). The report is `docs/qa/conversation-qa-report.md`. It uses the separate
   `imperial_indopack_qa` database and port 50071.

`WHATSAPP_TRANSPORT=capture` is for local testing only. The API refuses to send with it (error "for local testing only") when
`NODE_ENV=production`.

**Never run the test suite (`npm test`, `npx vitest`) or the QA harness (`npm run qa:*`) on the live host or
against the live database.** The tests switch off every product, write fake PO links and load and purge demo
products, and put things back only at the end. The test setup refuses to start unless `WHATSAPP_TRANSPORT=capture`
and the database is `imperial_indopack` or a name ending in `_qa` or `_test`; do not rely on that, keep tests on
a development machine.

## 1. What runs

| Part | How | Port |
|---|---|---|
| API (Fastify) | `cd api && npm run build && npm start` | 50070 (`PORT`) |
| Dashboard (Next.js) | `cd dashboard && npm run build && npm start` | 40070 |
| Postgres 17 + pgvector | any host; migration 0007 runs `CREATE EXTENSION vector` | 5432 |

- Dashboard start: `dashboard/next.config.ts` sets `output: "standalone"`. `npm start` (`next start -p 40070`)
  still works with that: Next 16 only logs `"next start" does not work with "output: standalone" configuration`
  as a warning and serves the normal build, reading `dashboard/.env.local`. The smaller standalone server is the
  alternative: after `npm run build`, from `dashboard/` copy `public` to `.next/standalone/public`, `.next/static`
  to `.next/standalone/.next/static` and `.env.local` to `.next/standalone/.env.local` (the build copies only
  `.env` and `.env.production`), then start it with `PORT=40070 HOSTNAME=127.0.0.1 node .next/standalone/server.js`.
  Redo the copies after every build.

- The dashboard is normally reached through the API: the API proxies `/app/*` to `DASHBOARD_UPSTREAM`
  (default `http://127.0.0.1:40070`). That way the PC needs only one public hostname, and it is the same
  host staff open in the browser, so browser notifications (which are tied to the hostname) stay valid.
  Staff open `https://<host>/app`.
- The WhatsApp webhook needs a public HTTPS URL (section 3, step 5; the webhook itself is section 5). Hosting of the PC or server is still the
  client's choice (spec section 9, item 8).

## 2. Environment variables

`api/.env.example` and `dashboard/.env.example` list every variable with comments. Copy them to `api/.env`
and `dashboard/.env.local`. Required means the app does not start, or does not work, without it.

### API (`api/.env`)

| Name | Required | Go-live value / how to get it |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `PORT` | no | `50070` (default) |
| `DATABASE_URL` | yes | Postgres connection string of the production database |
| `API_SECRET_KEY` | yes | The API key printed once by `scripts/seed.ts` (section 3). The same value goes in `dashboard/.env.local` |
| `ANTHROPIC_API_KEY` | yes | From console.anthropic.com. With `CLAUDE_CODE_OAUTH_TOKEN_1..N` it must still be non-empty (never sent) |
| `CLAUDE_CODE_OAUTH_TOKEN_1`, `_2`, ... | no | Claude subscription tokens (`claude setup-token`), used in number order instead of the API key |
| `USE_CLAUDE_CLI` | no | Leave unset or `false` in production (local-dev only) |
| `OPENAI_API_KEY` | no | Embeddings for product search; unset falls back to keyword search |
| `PUBLIC_BASE_URL` | yes | The public https URL of this API, no trailing slash, e.g. `https://bot.example.com`. WhatsApp fetches price-list PDFs and photos from it |
| `DASHBOARD_ORIGIN` | yes | The dashboard's public origin. With the `/app` proxy this is the same as `PUBLIC_BASE_URL`. Empty blocks every cross-origin browser call |
| `DASHBOARD_UPSTREAM` | no | `http://127.0.0.1:40070` (default). Empty turns the `/app` proxy off |
| `WHATSAPP_TRANSPORT` | yes | `chakra` (section 5) or `meta` (section 6). `capture` is local testing only and is refused in production |
| `CHAKRA_BASE_URL` | no | `https://api.chakrahq.com` (default) |
| `CHAKRA_PLUGIN_ID` | chakra | Chakra, WhatsApp setup, the three-dot menu (top right), Copy Plugin Id |
| `CHAKRA_ACCESS_TOKEN` | chakra | Chakra, API Keys, create key, Access Tokens |
| `CHAKRA_WEBHOOK_SECRET` | chakra | Chakra, Admin, Team, Secrets (signs inbound webhooks) |
| `CHAKRA_API_VERSION` | no | `v22.0` (default) |
| `CHAKRA_SYNC_INTERVAL_MS` | no | How often the bot pulls what staff typed on the phone. Example file uses `120000` (2 minutes); the code default is hourly. `0` = no timer |
| `META_ACCESS_TOKEN` | meta; optional on chakra | Meta system-user token. On chakra it is only used to download customers' photos/documents that Chakra cannot serve |
| `META_WEBHOOK_SECRET` | meta | The Meta App Secret (Meta for Developers, App Settings, Basic) |
| `META_WEBHOOK_VERIFY_TOKEN` | meta | A string you choose; type the same one in Meta's webhook setup |
| `META_API_VERSION` | no | `v19.0` (default) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | recommended | Browser notifications for staff. Generate once with `npx web-push generate-vapid-keys`; `VAPID_SUBJECT=mailto:<a real address>`. Changing the pair makes every staff member enable notifications again |
| `ESCALATION_NOTIFY_WA` | no | Staff WhatsApp number that is pinged on a hand-off (also covers phones push cannot reach) |
| `ESCALATION_NUDGE_AFTER_MS`, `ESCALATION_NUDGE_INTERVAL_MS` | no | Reminder for a hand-off nobody answered. Only on/off and how often it is checked: `ESCALATION_NUDGE_AFTER_MS=0` turns it off, any other value leaves it on (the value itself is not used); `ESCALATION_NUDGE_INTERVAL_MS` is how often it checks (default 10 minutes, `0` = off). How many minutes count as unanswered is set in the dashboard: Pengaturan, **Tim & notifikasi**, "Ingatkan tim bila chat Perlu Tim belum dibalas" (default 30) |
| `RESET_COMMAND_NUMBERS` | no | Numbers allowed to type `/new` to wipe their own test chat. Leave empty in production unless you are testing |
| `CAPTURE_LOG_PATH`, `CAPTURE_MEDIA_DIR` | local only | Used only by `WHATSAPP_TRANSPORT=capture`. Never set capture on the live server |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | seed only | The first dashboard admin. The script's fallback password is weak: always set your own before running the seed |
| `TYPING_DEBOUNCE_MS`, `PHOTO_DEBOUNCE_MS`, `CACHE_WARMUP_INTERVAL_MS`, `ANTHROPIC_TIMEOUT_MS`, `LEAD_INSIGHTS_*`, `LOG_LEVEL` | no | Defaults are fine; see the comments in `.env.example` |

### Dashboard (`dashboard/.env.local`)

| Name | Required | Go-live value |
|---|---|---|
| `AUTH_URL` | yes | The dashboard's public URL as staff open it, e.g. `https://bot.example.com/app` |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` (at least 32 random bytes) |
| `AUTH_TRUST_HOST` | yes | `true` |
| `NEXT_PUBLIC_API_URL` | yes | The API's public URL (`PUBLIC_BASE_URL`) |
| `NEXT_PUBLIC_BASE_PATH` | yes | `/app` (must match the API's proxy prefix) |
| `API_SECRET_KEY` | yes | The same API key as in `api/.env` (server-side only) |

`NEXT_PUBLIC_*` values are baked in at build time: change them, then rebuild the dashboard.

## 3. First deploy

Use a fresh, empty production database. Never point the live API at the local `imperial_indopack` development
database or a copy of it: it holds the demo `(CONTOH)` catalog, test chats and leads, and the seeded capture number
row (label `Nomor lokal (capture)`, Phone Number ID `local-phone-70`) that makes the WhatsApp check in Pengaturan
read connected although no real number is set up. If a development database is ever reused anyway, delete that
number on **Nomor WhatsApp** and purge the demo catalog (section 4, step 3) before going further.

From `api/`. Every `npx tsx scripts/X.ts` below becomes `node dist-scripts/X.js` on the server after
`npm run build:scripts` (e.g. `node dist-scripts/migrate.js`, `node dist-scripts/seed.js`,
`node dist-scripts/seed-default-prompt.js`, `node dist-scripts/reseed-prompt-defaults.js`):

1. `npx tsx scripts/migrate.ts` creates the tables (reads `MIGRATIONS_DIR`, default `./migrations`; from a
   checkout use `MIGRATIONS_DIR=src/db/migrations`).
2. Set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`, then `npx tsx scripts/seed.ts`. It creates
   the real admin and prints the API key once ("Raw key"). Copy it now into `API_SECRET_KEY` in both
   `api/.env` and `dashboard/.env.local`. It is never shown again.
3. `npx tsx scripts/seed-default-prompt.ts` stores the AI's default prompt.
4. `npm run build && npm start` for the API, then `cd dashboard && npm run build && npm start`.
5. Public HTTPS address (before the first login). `AUTH_URL` (section 2) is `https://bot.example.com/app`, and
   the dashboard login only works at that address: it rewrites requests to that origin and sets Secure cookies.
   Create it now:
   - Create a remote-managed Cloudflare Tunnel (Cloudflare Zero Trust, Networks, Tunnels) with a public
     hostname such as `bot.example.com` pointing to `http://localhost:50070`. Never use a temporary
     `trycloudflare.com` address: it changes, and the webhook would break.
   - In Cloudflare for that hostname: Security, Bots, **Bot Fight Mode OFF**; and no WAF, rate-limit or
     challenge rule on `/webhook`, `/webhooks/whatsapp` or `/uploads/*`. Chakra and WhatsApp fetch the
     price-list PDFs and photos from `/uploads/...`; a challenge page makes sends fail silently.
   - Check: `curl -I https://bot.example.com/uploads/` must not return a Cloudflare challenge page (a 404 from
     the API is fine).

   The tunnel exposes nothing to WhatsApp customers until the Chakra webhook is pointed at it (section 5,
   webhook step), and the AI stays off until every step of section 4 is done.
6. Log in to the dashboard at `https://bot.example.com/app` with the admin from step 2, open **Pengaturan**, section **Bot**, and turn
   **Balasan otomatis AI** OFF. A fresh database starts with it ON. Leave it OFF until section 7: with it off the
   bot answers nobody, so connecting the number (section 5) cannot let it talk to a customer before it is set up.
7. Every later deploy of new code: `npx tsx scripts/reseed-prompt-defaults.ts` after the new code is in
   place. It updates prompt sections nobody edited and keeps the staff's edits (`--force` would replace them).

## 4. Set up the bot (before connecting WhatsApp)

Do all of this before the number is connected (section 5), with **Balasan otomatis AI** still OFF (section 3,
step 6). Tick off every step below before the AI is switched on (section 7).

1. **Pengaturan, Pemesanan & harga**: enter both PO form links (https). On a fresh production database they
   are placeholders and the bot will not send a placeholder:
   - **Form order cetak** (customer has a design): `https://forms.gle/mybbNDzzfEETKP9h9`
   - **Form order plano** (no design): `https://forms.gle/eiw2k43yrhTZ6odbA`

   When the bot does not know whether the customer has a design, it sends both, labelled. Also check the
   **Minimum order** value there.
2. **Pengaturan, Bot**: **Nama bot** and **Sapaan pertama** (the first greeting).
3. **Katalog, the real catalog.** The client's workbook only held customer-specific quotes, so there is no
   generic price list yet.
   - If you loaded the demo catalog: `cd api && npm run catalog:demo -- --purge` deletes only the `(CONTOH)`
     products. Until they are gone, customers would be quoted the demo prices.
   - Import the client's generic price list: **Katalog, Import Excel, Unduh template-katalog.xlsx**, fill it
     (one row per price tier), upload it.
   - Upload both brand price-list PDFs under "Daftar harga untuk dikirim bot" (Kertas Supreme and Imperial Indopack, PDF, max 20 MB each).
   - On each product add up to 3 reference photos ("Foto referensi desain", JPG/PNG, max 5 MB). The bot sends
     them to customers who have no design yet.
   - Until a real catalog exists the bot hands every price question to the team.
4. **Admin**: create the staff accounts. Each staff member opens the dashboard on their own phone/PC (at the
   public address from section 3, step 5) and turns on browser notifications (button "Aktifkan
   notifikasi"; it then reads "Notifikasi aktif"). On iPhone it needs iOS 16.4+ and the site added to the
   Home Screen.
5. Check once more: both PO links are real (no "Masih link contoh." hint), Katalog has no `(CONTOH)` products
   and shows both price-list files, and Pengaturan, WhatsApp reads "Belum terhubung" (it changes in section 5).
   If WhatsApp already reads **Terhubung** here, a number row is already stored (see the database note in
   section 3).

## 5. Connect WhatsApp: ChakraHQ (primary path)

Chakra is the BSP between your WhatsApp Business number and this API. Both directions go through it.

Before step 6 (the webhook) check Pengaturan, section **Bot**: **Balasan otomatis AI** must be OFF. From the moment
the webhook points here, real customers' messages arrive; with the AI off they wait in **Percakapan** for the team
and the bot sends nothing.

**A. API settings** (`api/.env`, never print them)

1. `WHATSAPP_TRANSPORT=chakra`
2. `CHAKRA_PLUGIN_ID`: Chakra, WhatsApp setup, the three-dot menu (top right), Copy Plugin Id.
3. `CHAKRA_ACCESS_TOKEN`: Chakra, API Keys, create key, Access Tokens.
4. `CHAKRA_WEBHOOK_SECRET`: Chakra, Admin, Team, Secrets.
5. `PUBLIC_BASE_URL=https://bot.example.com` (https, no trailing slash) and `DASHBOARD_ORIGIN` (the same
   value when the dashboard rides the `/app` proxy). `NODE_ENV=production`.

**B. Webhook in Chakra**

6. In Chakra, set the pass-through webhook URL to `https://bot.example.com/webhook`. The API serves the same
   handler on `/webhook` and `/webhooks/whatsapp` (GET for Meta's verification, POST for messages); the two
   are equivalent, `/webhook` is the one to use for Chakra. Chakra signs each message with `X-Chakra-Signature-256`,
   checked against `CHAKRA_WEBHOOK_SECRET`; a wrong secret makes every inbound message be rejected.

**C. Add the number in the dashboard**

7. Dashboard, **Nomor WhatsApp**, **Tambah Nomor**. Fill the form "Daftarkan Nomor WhatsApp":
    - **Label**: any name, e.g. `CS Utama`.
    - **Nomor Telepon**: the number in `+62...` form.
    - **WABA ID (Meta)**: the WhatsApp Business Account ID.
    - **Phone Number ID (Meta)**: Meta's numeric phone number ID, **not** the +62 phone number. Find it in
      Chakra's WhatsApp setup for this number, or Meta Business Manager, WhatsApp Accounts, Phone numbers.
    - The form has no access-token field; nothing else to fill.
    - Press **Daftarkan**.
    Without a number row the API ignores every inbound message and logs
    `[messageRouter] No phone number configured — ignoring inbound message`.

**D. Restart and check**

8. Restart the API.
9. Dashboard, **Pengaturan**, section **WhatsApp**: it must read **Terhubung · ChakraHQ · 1 nomor**. If it says
    "Belum terhubung", the text under it names what is missing (one of the three `CHAKRA_*` values, or no number row).
10. Same section, **Riwayat percakapan ChakraHQ**, press **Sinkronkan sekarang** so the bot learns what staff
    already answered from the phone. After that it runs by itself on the interval set above it (field "Ambil
    balasan tim dari HP WhatsApp tiap ... menit"); the bot can talk over a staff reply that arrived on the
    phone less than one interval ago, so keep the interval short.
11. Optional: set `META_ACCESS_TOKEN` (a system-user token with access to this WhatsApp Business Account) only
    if customers' photos or documents arrive unreadable. Chakra's media API cannot serve newer files, and this
    token lets the API fetch them from Meta. Without it the bot still answers from the caption.

## 6. Connect WhatsApp: Meta Cloud API (alternative)

Same rule as section 5: **Balasan otomatis AI** stays OFF until section 7.

1. `api/.env`: `WHATSAPP_TRANSPORT=meta`, `META_ACCESS_TOKEN` (system-user token), `META_WEBHOOK_SECRET` (the
   App Secret), `META_WEBHOOK_VERIFY_TOKEN` (a string you choose).
2. Meta for Developers, your app, WhatsApp, Configuration, Webhook: callback URL
   `https://bot.example.com/webhooks/whatsapp`, Verify token = `META_WEBHOOK_VERIFY_TOKEN`, then subscribe to
   the `messages` field. (The API answers Meta's verification request on both webhook paths.)
3. Same Cloudflare rules as section 3, step 5.
4. Add the number on **Nomor WhatsApp** as in section 5C (Phone Number ID is Meta's numeric ID). The form has
   no token field: the API uses `META_ACCESS_TOKEN` from `.env`.
5. Restart the API; Pengaturan, WhatsApp shows **Terhubung · Meta · 1 nomor**. The Chakra sync box does not appear on meta.

## 7. Switch the AI on and test from a personal phone

Every step of section 4 is done and Pengaturan, WhatsApp reads **Terhubung**. Only then turn **Balasan otomatis
AI** ON (Pengaturan, section **Bot**).

The switch is global and the dashboard has no per-contact AI switch, so from that moment the bot answers every
customer who writes to the number, not only your test phone: this test runs on live traffic. Do it at a quiet time
(outside business hours) and turn the AI OFF again if a step goes wrong. Or run sections 5 to 7 first with a
separate test WhatsApp number, and connect the real number only once the test has passed.

Use a phone that is not the business number, and note down the result of each step. Test numbers like
`0812-0000-00NN` are only for the local tests in section 0; here use your own.

1. `berapa harga kertas supreme?`: the Kertas Supreme price list (PDF) arrives.
2. Ask for a catalog item with a quantity: the bot answers with the tier price and the total.
3. Ask for a custom size: the chat shows up in **Perlu Tim**, and the staff push notification arrives.
4. Reply from the dashboard (Percakapan): the phone receives it and the AI pauses on that chat.
5. After a quote say `oke saya ambil`: the bot sends the PO form link, **Form order cetak** if you said you
   have a design, **Form order plano** if not, both labelled if it is unknown. The lead becomes **Menang**.
6. **Leads** and **Ringkasan** show the lead with its brand.
7. Reply to the customer from the business phone itself, press **Sinkronkan sekarang**, and check the bot
   does not repeat or contradict that reply.

## 8. If something goes wrong

- **Only staff replies**: Pengaturan, **Balasan otomatis AI** off. The bot stops answering; staff reply from the dashboard.
- **One product misbehaves**: Katalog, deactivate the product (the bot stops offering it).
- **Reset a test chat**: send `/new` from a number listed in `RESET_COMMAND_NUMBERS` (restart the API after editing it).
- **Nothing arrives**: check Pengaturan, WhatsApp first; then the Cloudflare rules (section 3, step 5), the webhook URL and
  `CHAKRA_WEBHOOK_SECRET` (5B), the Phone Number ID (5C), and the API log for `No phone number configured`.
- **Stuck on a bad prompt edit**: Pengaturan, Instruksi bot, or run `reseed-prompt-defaults.ts --force` to
  put the shipped prompt back (this replaces staff edits).
