# Imperial Indopack Dashboard, API Additions and QA Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Imperial Indopack staff dashboard on real API data, add the API endpoints its screens need, and prove the bot and the dashboard end to end, so the only steps left for the user are connecting the WhatsApp number and testing.

**Architecture:** Three phases.
- **A (API, Tasks 1–12):** new Fastify routes, repositories and two migrations in `api/`, each test-driven with Vitest against the local `imperial_indopack` database.
- **B (dashboard, Tasks 13–21):** `dashboard/` is copied from Legacy's Next.js app (git-tracked files only), rebranded, and every designed screen is rebuilt on Phase A endpoints through `lib/api/*` wrappers and server actions. Pure helpers carry Vitest tests; screens are proven by `tsc`, `next build` and the smoke checklist.
- **C (proof, Tasks 22–25):** static checks, a conversation QA harness that drives the real bot through a capture WhatsApp transport (Claude through `USE_CLAUDE_CLI=true`), a browser smoke checklist, and the go-live doc.

**Tech Stack:** API as in Plan 1 (Node 24, TypeScript 5.8 ESM with `.js` suffixes, Fastify 5, Drizzle 0.43, Postgres 17 + pgvector, Zod 4, Vitest 3, sharp). Dashboard: Next.js 16 app router, next-auth 5.0.0-beta.28, React 19, Tailwind 3, Zod 3, Vitest 3 (added in Task 13).

**Spec:** `docs/superpowers/specs/2026-11-18-imperial-indopack-chatbot-design.md` (§7.9 is the dashboard). **Plan 1:** `docs/superpowers/plans/2026-11-18-imperial-indopack-api.md`; this plan consumes its interfaces by name. **Designs:** `docs/superpowers/designs/*.dc.html` (copied in Task 0). They fix layout, fields, copy and states. Their sample rows, `[N]` and `[%]` are placeholders for real data.

## Global Constraints

- **Prerequisite:** Plan 1 Tasks 0–14 are merged, `npx tsc --noEmit` and `npx vitest run` in `api/` are green, and the starter catalog draft is imported into the local DB.
- API work runs from `api/`, dashboard work from `dashboard/`. Never touch `../legacy-app` except the read-only copy in Task 13.
- **Ports, set by env and by default:** API `50070`, dashboard `40070`, QA API instance `50071`. Never `50050` or `40050`, which are the Legacy app's.
- **Brand tokens (Brand.dc.html):** leaf `#88B44E`, olive `#586B34` (text-safe green), lime `#ADCF6D`, pale `#F5F8F2`, charcoal `#252C30`, sage `#B0B9AE`, Royale gold `#C49A3C`, deep gold `#8A6A2A` (text-safe gold).
- **UI tints used by the screen designs:** page `#F2F5EF`, sidebar `#F8FAF6`, borders `#E1E7DC`, body text `#1F2421`, muted text `#5F6B5A`, link `#445428`, primary button `#586B34` on white, secondary button white with border `#D5DECF`, active nav `border-left #586B34` on `#EAF2DD` with text `#3E4C24`.
- **Tags:** Kertas Supreme tag `#EAF2DD` / `#445428` (green). Imperial Indopack tag `#F4EBD8` / `#6E531E` (gold). Hot `#FBE3DA` / `#9A2E12`. Cold `#E2EAF2` / `#2F4A66`.
- **Fonts:** headings Montserrat (600–800), body Open Sans (400/600), from Google Fonts.
- **Brands:** slugs `kertas_supreme`, `imperial_indopack`, displayed `Kertas Supreme`, `Imperial Indopack`. Kertas Supreme is listed first wherever both appear, as the designs do.
- **Copy:** the UI is Indonesian, with the existing ID/EN switch. Every new UI string goes in `lib/i18n/id.ts` with its English twin in `en.ts`. Customer messages, catalog data and Excel headers are never translated.
- Rupiah renders as `Rp 1.850.000`. Dates and times render in WIB (`formatDate` in `lib/i18n/core.ts`).
- **No Legacy** name, data, brand asset or customer data anywhere. Synthetic test data uses phones `0812-0000-00NN` / `62812000070NN` and business names containing `Contoh`.
- Staff tools never send the placeholder PO link (`https://forms.gle/REPLACE-ME`) to a customer.
- **Databases:** Vitest uses `imperial_indopack`, the QA harness uses `imperial_indopack_qa`. The guard refuses any URL containing `legacy`.
- Never print API keys or passwords. Test credentials live only in `api/.env` and `dashboard/.env.local` (both ignored) and are documented in `api/.env.example`.
- **API conventions:** responses are `{ data, error }`, error codes are UPPER_SNAKE. The staff identity sent to the API always comes from the dashboard session, never from the browser.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **A product is switched off or deleted mid-chat.** The bot must stop offering and pricing it on the next turn, with no restart. Task 6 pins this: after deactivation the catalog block has no product and `runPriceTool` gives `not_in_catalog`.
2. **Staff press "Kirim form PO" before the real link is set.** The placeholder must never reach a customer. Task 11 pins this: 409 `PO_FORM_PLACEHOLDER`, and nothing is captured.
3. **Rupiah typed the Indonesian way.** `1.450` is one thousand four hundred fifty, never 1.45, and `Rp 185.000` or `185000` parse the same. Task 18 pins this in `parseRupiah`.
4. **Team notes beside a busy bot.** The AI rewrites `conversations.follow_up_notes` every turn, and `/new` wipes AI state. Staff notes must survive both. Task 10 pins this.
5. **"Kirim daftar harga" when the profile has both brands or none.** Both brands send both files. None returns `BRAND_UNKNOWN` so the dashboard asks staff to pick. Task 11 pins this.

---

## File map

| Area | Files | Task |
|---|---|---|
| Designs kept in the repo | `docs/superpowers/designs/*.dc.html` | 0 |
| Ports, capture transport, local seed | `api/src/config.ts`, `api/src/app.ts`, `api/src/services/captureClient.ts`, `api/src/services/whatsappSender.ts`, `api/scripts/seed-local.ts`, `api/.env.example` | 1 |
| Price calls on the turn | `api/src/services/priceTool.ts`, `api/src/services/aiLayer.ts`, `api/src/services/messageRouter.ts`, `api/src/domain/messageSources.ts` | 2 |
| Handoff category | `api/src/db/migrations/0027_conversation_handoff_and_notes.sql`, `api/src/domain/handoff.ts`, `api/src/repositories/conversations.ts`, `api/src/services/escalationHandler.ts` | 3 |
| Bot settings | `api/src/domain/botSettings.ts`, `api/src/repositories/appSettings.ts`, `api/src/services/escalationNudge.ts`, `api/src/services/chakraSync.ts`, `api/src/index.ts`, `api/src/routes/dashboard/settings.ts` | 4 |
| Go-live status | `api/src/domain/brands.ts`, `api/src/services/goLive.ts` | 5 |
| Product editor API | `api/src/db/migrations/0028_catalog_editor.sql`, `api/src/domain/productSpec.ts`, `api/src/services/catalogEditor.ts`, `api/src/repositories/catalogAudit.ts`, `api/src/routes/dashboard/catalogProducts.ts`, `api/src/routes/dashboard/catalogCache.ts` | 6 |
| Preview, price check, price lists | `api/src/routes/dashboard/catalogProducts.ts`, `api/src/routes/dashboard/brandPriceLists.ts`, `api/src/services/catalogDelivery.ts` | 7 |
| Import preview | `api/src/services/catalogImport.ts`, `api/src/services/catalogTemplate.ts`, `api/src/routes/dashboard/catalog.ts` | 8 |
| Inbox list, team queue | `api/src/domain/orderDetails.ts`, `api/src/services/teamQueue.ts`, `api/src/routes/dashboard/teamQueue.ts` | 9 |
| Order panel | `api/src/services/nearestCatalog.ts`, `api/src/services/orderPanel.ts` | 10 |
| Quick-send | `api/src/services/quickSend.ts` | 11 |
| Leads, report, detail extras | `api/src/repositories/leads.ts`, `api/src/repositories/leadReport.ts`, `api/src/services/leadDetailExtras.ts`, `api/src/routes/webhooks.ts` | 12 |
| Dashboard shell | `dashboard/**` (copy), `dashboard/lib/{brands,format}.ts`, `dashboard/components/BrandTag.tsx`, `dashboard/components/layout/Sidebar.tsx` | 13 |
| Leads, Bukan Lead | `dashboard/app/(dashboard)/leads/**`, `dashboard/lib/leads/{tabs,items}.ts` | 14 |
| Lead detail | `dashboard/app/(dashboard)/leads/[id]/**`, `dashboard/lib/leads/itemsForm.ts` | 15 |
| Ringkasan | `dashboard/app/(dashboard)/summary/**`, `dashboard/lib/summary/series.ts` | 16 |
| Katalog list and dialogs | `dashboard/app/(dashboard)/catalog/**`, `dashboard/components/catalog/*`, `dashboard/lib/catalog/tierTable.ts` | 17 |
| Product form | `dashboard/app/(dashboard)/catalog/{new,[id]}/**`, `dashboard/components/catalog/ProductForm.tsx`, `dashboard/lib/catalog/productForm.ts` | 18 |
| Percakapan | `dashboard/app/(dashboard)/conversations/**`, `dashboard/components/conversations/*`, `dashboard/lib/conversations/labels.ts` | 19 |
| Perlu Tim | `dashboard/app/(dashboard)/team-queue/**`, `dashboard/lib/teamQueue.ts` | 20 |
| Pengaturan | `dashboard/app/(dashboard)/settings/**`, `dashboard/lib/settings.ts` | 21 |
| QA harness | `api/scripts/qa/*`, `docs/qa/conversation-qa-report.md` | 23 |
| Smoke results, go-live | `docs/qa/dashboard-smoke.md`, `docs/go-live.md` | 24, 25 |

---

### Task 0: Keep the designs in the repo, confirm Plan 1

**Files:**
- Create: `docs/superpowers/designs/` (12 screen files plus `Brand.dc.html`)

- [ ] **Step 1: Confirm Plan 1 is done**

Run: `cd api && npx tsc --noEmit && npx vitest run 2>&1 | tail -4 && test -f ../docs/client/starter-catalog-draft.xlsx && echo OK`
Expected: tsc exits 0, `0 failed`, and `OK`. Otherwise stop: Plan 1 is not finished.

- [ ] **Step 2: Copy the designs, which today live only in a temporary scratchpad**

```bash
S="/private/tmp/claude-501/-Users-claytonmildy-WidaProject-FDE-Projects-imperial-indopack-chatbot/e80d50a5-9a8e-4c0f-9428-1a73522b754b/scratchpad/canvas/project"
mkdir -p docs/superpowers/designs
for f in Brand Leads LeadDetail NonLeads Summary Catalog ProductCreate ProductEdit ImportExcel DeleteProduct Conversations TeamQueue Settings; do cp "$S/$f.dc.html" docs/superpowers/designs/; done
grep -liE "legacy|08[1-9][0-9]{8,}" docs/superpowers/designs/* ; ls docs/superpowers/designs | wc -l
```
Expected: the grep prints nothing, and the count is `13`. If `$S` is gone, ask the user for the design files before going on.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/designs && git commit -m "Keep the approved screen designs in the repo"
```

---

## Phase A: API additions

### Task 1: Local ports, capture transport, local seed

**Files:**
- Modify:
  - `api/src/config.ts`: `PORT` default `50070`, `PUBLIC_BASE_URL` default `http://localhost:50070`, `WHATSAPP_TRANSPORT` enum adds `'capture'`, add `CAPTURE_LOG_PATH` (default `logs/whatsapp-capture.jsonl`) and `CAPTURE_MEDIA_DIR` (default `scripts/qa/fixtures/files`)
  - `api/src/app.ts`: the `DASHBOARD_UPSTREAM` default becomes `http://127.0.0.1:40070`
  - `api/src/services/whatsappSender.ts` (`sender()`)
  - `api/package.json` (script `seed:local`)
  - `api/.env.example`
  - `.gitignore`: add `api/logs/`, `api/scripts/qa/fixtures/files/`
- Create: `api/src/services/captureClient.ts`, `api/scripts/seed-local.ts`
- Test: `api/tests/capture-transport.test.ts`

**Interfaces:**
- Produces:
```ts
// captureClient.ts: the same positional signatures as chakraClient / metaClient
export interface CapturedMessage { id: string; at: string; kind: 'text' | 'image' | 'document'; phoneNumberId: string; to: string; text?: string; path?: string; caption?: string; filename?: string }
export function sendTextMessage(phoneNumberId: string, to: string, text: string): Promise<string>;        // resolves 'capture-<uuid>'
export function sendImageMessage(phoneNumberId: string, to: string, imagePath: string, caption: string): Promise<string>;
export function sendDocumentMessage(phoneNumberId: string, to: string, filePath: string, filename: string): Promise<string>;
export function downloadMedia(mediaId: string): Promise<{ base64: string; mimeType: string }>;           // reads CAPTURE_MEDIA_DIR/<mediaId>
export function readCaptured(logPath: string, filter?: { to?: string; afterId?: string }): CapturedMessage[];
```
- Behaviour:
  - Each send appends one JSON line to `CAPTURE_LOG_PATH`, creating the folder if needed. `to` is stored as digits only (the part before `@`).
  - `downloadMedia` refuses any id whose `basename` differs from itself. MIME type comes from the extension (`.png`, `.jpg`/`.jpeg`, `.webp`, `.pdf`).
  - `sender()` throws `WHATSAPP_TRANSPORT=capture is for local testing only` when `NODE_ENV === 'production'`.
- Seed: `npx tsx scripts/seed-local.ts`
  - refuses a `DATABASE_URL` matching `/legacy/i`
  - upserts the admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` (defaults as in `scripts/seed.ts`, role `admin`)
  - inserts `api_keys` for `sha256(SEED_API_KEY)` (required, at least 32 characters), label `local dashboard`
  - inserts the phone number `{ number: '+620000000070', label: 'Nomor lokal (capture)', wabaId: 'local-waba', phoneNumberId: 'local-phone-70' }`
  - every insert is `onConflictDoNothing`, and the script prints counts only

- [ ] **Step 1: Write the failing test `tests/capture-transport.test.ts`**

Set `process.env.WHATSAPP_TRANSPORT = 'capture'`, a temp `CAPTURE_LOG_PATH`, and a temp `CAPTURE_MEDIA_DIR` holding `logo.png` (written with sharp), then import dynamically.
```ts
it('records a text in WhatsApp markup and returns a capture id', async () => {
  const id = await sendTextMessage('local-phone-70', '6281200007001@s.whatsapp.net', 'Harga **Rp 165.000**/rim');
  expect(id).toMatch(/^capture-/);
  expect(readCaptured(LOG, { to: '6281200007001' }).at(-1)).toMatchObject({ kind: 'text', text: 'Harga *Rp 165.000*/rim', phoneNumberId: 'local-phone-70' });
});
it('records a document with its file name', async () => {
  await sendDocumentMessage('local-phone-70', '6281200007001', '/uploads/catalogs/a.pdf', 'Daftar Harga Kertas Supreme.pdf');
  expect(readCaptured(LOG).at(-1)).toMatchObject({ kind: 'document', filename: 'Daftar Harga Kertas Supreme.pdf' });
});
it('serves inbound media from the fixtures folder', async () => expect(await downloadMedia('logo.png')).toMatchObject({ mimeType: 'image/png' }));
it('refuses a media id outside the folder', async () => expect(downloadMedia('../.env')).rejects.toThrow());
it('refuses capture in production', async () => { /* vi.resetModules(); NODE_ENV=production; re-import */ await expect(sendTextMessage('p', '1', 'x')).rejects.toThrow(/local testing only/); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/capture-transport.test.ts`
Expected: FAIL. `captureClient.js` not found.

- [ ] **Step 3: Implement `captureClient.ts`, the `sender()` branch, the config defaults and `seed-local.ts`**

- [ ] **Step 4: Run the test and tsc**

Run: `npx vitest run tests/capture-transport.test.ts && npx tsc --noEmit`
Expected: PASS (5), and tsc exits 0.

- [ ] **Step 5: Add the local dev settings to `api/.env` without printing secrets, and seed**

`.env.example` documents each of these lines:
```bash
grep -q '^SEED_API_KEY=' .env || echo "SEED_API_KEY=$(openssl rand -hex 32)" >> .env
grep -q '^API_SECRET_KEY=' .env || echo "API_SECRET_KEY=$(sed -n 's/^SEED_API_KEY=//p' .env)" >> .env
cat >> .env <<'EOF'
PORT=50070
PUBLIC_BASE_URL=http://localhost:50070
DASHBOARD_UPSTREAM=http://127.0.0.1:40070
NODE_ENV=development
WHATSAPP_TRANSPORT=capture
SKIP_HMAC_IN_DEV=true
USE_CLAUDE_CLI=true
ANTHROPIC_API_KEY=unused-in-cli-mode
EOF
npx tsx scripts/seed-local.ts
```
Expected: the seed prints `admin: 1, api key: 1, phone number: 1` (or `0` when already present). Remove any line the `>>` duplicated.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/app.ts src/services/captureClient.ts src/services/whatsappSender.ts scripts/seed-local.ts package.json .env.example ../.gitignore tests/capture-transport.test.ts
git commit -m "Capture WhatsApp transport for local testing; ports 50070/40070; local seed"
```

---

### Task 2: Price calls recorded on the turn

**Files:**
- Create: `api/src/domain/messageSources.ts`
- Modify:
  - `api/src/services/priceTool.ts` (`runPriceTool` also returns `call`)
  - `api/src/services/aiLayer.ts` (both call paths collect `priceCalls`, next to `toolFigures`)
  - `api/src/domain/types.ts` (`AIResponse.priceCalls?: PriceToolCall[]`)
  - `api/src/services/messageRouter.ts` (reply-row metadata and the source tags of the three bot sends)
- Test: `api/tests/price-tool.test.ts`, `api/tests/price-tool-loop.test.ts`, `api/tests/messageRouter-debounce.test.ts` (add cases)

**Interfaces:**
- Consumes: `PriceToolInput`, `runPriceTool` (Plan 1 Task 5), `PriceQuote` (Plan 1 Task 2)
- Produces:
```ts
// priceTool.ts
export type PriceOutcome = 'quote' | 'below_minimum' | 'above_top_tier' | 'not_in_catalog';
export interface PriceToolCall {
  input: z.infer<typeof PriceToolInput>;
  outcome: PriceOutcome;
  productId: string | null; productName: string | null; variantName: string | null;
  quote: Exclude<PriceQuote, { kind: 'no_tiers' }> | null; // null for not_in_catalog (a variant with no tiers is not_in_catalog)
}
export async function runPriceTool(input, catalog?): Promise<{ text: string; figures: number[]; call: PriceToolCall }>;
// messageSources.ts
export const MESSAGE_SOURCE = { poForm: 'po_form', priceList: 'price_list', referencePhoto: 'reference_photo' } as const;
```
- Metadata written:
  - the assistant reply row gets `priceCalls: PriceToolCall[]` when the turn called the tool
  - the PO text row gets `source: 'po_form'`
  - each reference photo row gets `source: 'reference_photo'` and `productId` (when the URL belongs to a product)
  - each price-list document row gets `source: 'price_list'` and `brand`

- [ ] **Step 1: Write the failing tests**

```ts
// price-tool.test.ts (Plan 1's CATALOG fixture)
it('a quote call carries the match and the quote', async () => {
  const { call } = await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: '30x30', qty: 12, unit: 'rim' }, CATALOG);
  expect(call).toMatchObject({ outcome: 'quote', productName: 'Kertas Supreme 64 gsm cetak 1 warna', quote: { kind: 'quote', unitPriceIdr: 165000, totalIdr: 1980000 } });
  expect(call.variantName).not.toBeNull();
});
it.each([[3, 'below_minimum'], [21, 'above_top_tier']])('%i rim is %s', async (qty, outcome) =>
  expect((await runPriceTool({ ...SUPREME_30, qty, unit: 'rim' }, CATALOG)).call.outcome).toBe(outcome));
it('an unknown size is not_in_catalog with a null quote', async () =>
  expect((await runPriceTool({ ...SUPREME_30, size: '32x32' }, CATALOG)).call).toMatchObject({ outcome: 'not_in_catalog', quote: null }));
// price-tool-loop.test.ts
expect(result.priceCalls?.map((c) => c.outcome)).toEqual(['quote', 'quote']);
// messageRouter-debounce.test.ts
it('stores the turn price calls on the reply row', ...);   // the reply insertMessage call has metadata.priceCalls with length 1
it('tags the PO form row as po_form', ...);                 // the PO insertMessage call has metadata.source === 'po_form'
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/price-tool.test.ts tests/price-tool-loop.test.ts tests/messageRouter-debounce.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

Build `call` from the same match and `quotePrice` result that already produce `text`. Collect calls in a turn-local `priceCalls: PriceToolCall[]` beside `figures`, and attach them wherever `toolFigures` is attached (failsafe path included).

- [ ] **Step 4: Run the tests and tsc**

Run: the Step 2 command, then `npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Record each hitung_harga call on the reply and tag bot sends by source"
```

---

### Task 3: Handoff category

**Files:**
- Create:
  - `api/src/db/migrations/0027_conversation_handoff_and_notes.sql`, with journal idx 27 (`when` 1794200000000)
  - `api/src/domain/handoff.ts`
- Modify:
  - `api/src/db/schema.ts`, `api/src/domain/types.ts` (`Conversation.handoffCategory`, `teamNotes`, `teamNotesUpdatedAt`, `teamNotesUpdatedBy`)
  - `api/src/repositories/conversations.ts`: `updateConversationStatus`, `mapConversation`, and `resetConversationToActive` clears the category
  - `api/src/services/escalationHandler.ts` (`escalateConversation`)
  - `api/src/services/messageRouter.ts`: three escalation sites and the still-checking refresh
  - `api/src/services/humanTakeover.ts` (`markHumanTakeover`)
- Test: `api/tests/handoff-category.test.ts` (pure, plus a DB block), `api/tests/human-takeover.test.ts` (adjust)

**Interfaces:**
- Consumes: `PriceOutcome` (Task 2), `detectComplaint`, `detectHumanRequest`, `detectNonSalesTopic`
- Produces:
```ts
export const HANDOFF_CATEGORIES = ['harga_custom', 'desain_masuk', 'pesanan_besar', 'minta_orang', 'komplain', 'bukan_pembeli', 'lainnya'] as const;
export type HandoffCategory = (typeof HANDOFF_CATEGORIES)[number];
export const HANDOFF_LABEL: Record<HandoffCategory, string>; // 'Harga custom','Desain masuk','Pesanan besar','Minta bicara dengan orang','Komplain','Bukan pembeli','Lainnya'
export interface HandoffSignals { nonSales: boolean; complaint: boolean; humanRequested: boolean; priceOutcomes: PriceOutcome[]; designReceived: boolean }
export const NO_SIGNALS: HandoffSignals;
export function classifyHandoff(s: HandoffSignals, reason: string): HandoffCategory;
// conversations.ts
updateConversationStatus(id, status, escalationReason?, assignedAgent?, handoffCategory?: HandoffCategory): Promise<Conversation | null>; // cleared to null with the reason when leaving the held state
// escalationHandler.ts
escalateConversation(conversation, reason, customerWaId, askProfileGap?, knownPhoneNumber?, lead?, category?: HandoffCategory): Promise<void>;
```
- Migration:
```sql
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_category text CHECK (handoff_category IN ('harga_custom','desain_masuk','pesanan_besar','minta_orang','komplain','bukan_pembeli','lainnya')),
  ADD COLUMN IF NOT EXISTS team_notes text,
  ADD COLUMN IF NOT EXISTS team_notes_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS team_notes_updated_by text;
```
- Priority: `bukan_pembeli` (nonSales) > `komplain` > `minta_orang` > `pesanan_besar` (an `above_top_tier` outcome) > `harga_custom` (a `not_in_catalog` outcome) > `desain_masuk` (designReceived).
- Fallback on the reason text:
  - `/di luar katalog|tidak ada di katalog|custom/i` → `harga_custom`
  - `/tingkat teratas|pesanan besar/i` → `pesanan_besar`
  - `/logo|desain|file/i` → `desain_masuk`
  - `/bukan pertanyaan produk/i` → `bukan_pembeli`
  - anything else → `lainnya`
- Call sites:
  - **text turn:** signals from `nonSales`, `complaint`, `humanRequested`, `aiResponse.priceCalls` outcomes, and `designReceived` = the batch held a document
  - **photo turn:** `designReceived: true`
  - **non-sales and unsupported-media paths:** `nonSales: true`
- `escalateConversation` uses `category ?? classifyHandoff(NO_SIGNALS, reason)`, and its `notifyStaff` title becomes `Perlu tim: ${HANDOFF_LABEL[category]}`.
- `markHumanTakeover(conversationId, agent)` keeps the hand-off visible to the team. It passes `conv.escalationReason ?? \`Dibalas langsung oleh ${agent}\`` as the reason and `agent` as `assignedAgent`, so the Perlu Tim banner keeps the bot's reason and the queue shows the assignee. Today it overwrites the reason and never sets the assignee.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  [{ nonSales: true, complaint: true }, 'bukan_pembeli'],
  [{ complaint: true, humanRequested: true }, 'komplain'],
  [{ humanRequested: true, priceOutcomes: ['not_in_catalog'] }, 'minta_orang'],
  [{ priceOutcomes: ['quote', 'above_top_tier'] }, 'pesanan_besar'],
  [{ priceOutcomes: ['not_in_catalog'], designReceived: true }, 'harga_custom'],
  [{ designReceived: true }, 'desain_masuk'],
])('%o → %s', (s, want) => expect(classifyHandoff({ ...NO_SIGNALS, ...s }, 'Low confidence')).toBe(want));
it('falls back to the reason text', () => expect(classifyHandoff(NO_SIGNALS, 'ukuran 22x22x7 tidak ada di katalog')).toBe('harga_custom'));
it('defaults to lainnya', () => expect(classifyHandoff(NO_SIGNALS, 'AI call failed: timeout')).toBe('lainnya'));
// DB, sendTextMessage mocked
it('stores the category on escalation and clears it on return to AI', async () => {
  await escalateConversation(conv, 'di atas tingkat teratas', WA, false, phone, undefined, 'pesanan_besar');
  expect((await findConversationById(conv.id))?.handoffCategory).toBe('pesanan_besar');
  await resetConversationToActive(conv.id);
  expect((await findConversationById(conv.id))?.handoffCategory).toBeNull();
});
it('a staff takeover keeps the reason and category and records the assignee', async () => {
  await escalateConversation(conv, 'ukuran 22x22x7 tidak ada di katalog', WA, false, phone, undefined, 'harga_custom');
  await markHumanTakeover(conv.id, 'Admin QA');
  expect(await findConversationById(conv.id)).toMatchObject({ status: 'needs_human', escalationReason: 'ukuran 22x22x7 tidak ada di katalog', handoffCategory: 'harga_custom', assignedAgent: 'Admin QA' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/handoff-category.test.ts`
Expected: FAIL. Module not found.

- [ ] **Step 3: Write the migration, apply it, and implement**

Run: `npx tsx scripts/migrate.ts`, then implement the module and the call sites.

- [ ] **Step 4: Run the tests, the escalation suites and tsc**

Run: `npx vitest run tests/handoff-category.test.ts tests/escalationHandler.test.ts tests/messageRouter-debounce.test.ts tests/human-takeover.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Store a handoff category for the Perlu Tim queue"
```

---

### Task 4: Bot settings in the prompt, minimum order, reminder, sync

**Files:**
- Create: `api/src/domain/botSettings.ts`
- Modify:
  - `api/src/repositories/appSettings.ts`
  - `api/src/services/aiLayer.ts`: `buildSystemPrompt`, both branches, puts the block right after `identitySection`
  - `api/src/domain/constants.ts`, `api/src/services/escalationHandler.ts`
  - `api/src/services/escalationNudge.ts`
  - `api/src/services/chakraSync.ts` (`shouldStartSync`), `api/src/index.ts` (`scheduleChakraSync`)
  - `api/src/routes/dashboard/settings.ts`
- Test: `api/tests/bot-settings.test.ts` (pure), `api/tests/bot-settings-routes.test.ts` (DB). Add cases to `api/tests/prompt-warmup.test.ts` and `api/tests/escalationHandler.test.ts`.

**Interfaces:**
- Consumes: `PCS_PER_RIM`, `FALLBACK_MIN_PCS` (Plan 1 Task 2), `getPoFormUrl`, `PO_FORM_PLACEHOLDER_URL`, `poFormMessage` (Plan 1 Task 7)
- Produces:
```ts
export type SignAs = 'brand_discussed' | 'imperial_indopack';
export interface BotSettings { botName: string; signAs: SignAs; greeting: string; fallbackMinPcs: number; teamReminderMinutes: number; whatsappSyncMinutes: number }
export const DEFAULT_BOT_SETTINGS: BotSettings = { botName: 'Admin', signAs: 'brand_discussed',
  greeting: 'Halo kak, terima kasih sudah menghubungi {merek}. Boleh tahu kertas atau box-nya untuk produk apa?',
  fallbackMinPcs: 2500, teamReminderMinutes: 30, whatsappSyncMinutes: 60 };
export const BotSettingsPatchSchema; // botName 1–40 chars, greeting 1–500, fallbackMinPcs int 1–1_000_000, teamReminderMinutes int 5–1440, whatsappSyncMinutes int 0–1440 (0 = off); all optional
export function formatMinOrder(pcs: number): string;      // 2500 → '2.500 pcs / 5 rim'; 1200 → '1.200 pcs' (rim only when whole)
export function buildBotSettingsBlock(s: BotSettings): string;
// appSettings.ts
export async function getBotSettings(): Promise<BotSettings>;               // row 'bot_settings'; a missing or invalid field falls back to its default
export async function patchBotSettings(patch: unknown): Promise<BotSettings>; // throws ZodError on bad input
// constants.ts
export function escalationAskQuantity(minPcs: number): string; // `Sambil menunggu, kira-kira mau pesan berapa banyak kak? (minimal ${formatMinOrder(minPcs)})`
// ESCALATION_ASK_QUANTITY stays, = escalationAskQuantity(FALLBACK_MIN_PCS)
// escalationHandler.ts
pickProfileGapQuestion(profile, recent, minPcs = FALLBACK_MIN_PCS): string | null; // escalateConversation passes getBotSettings().fallbackMinPcs
// escalationNudge.ts
nudgeStaleEscalations(afterMs?: number): Promise<void>; // undefined → teamReminderMinutes from settings; ESCALATION_NUDGE_AFTER_MS=0 still disables the schedule
// chakraSync.ts
export function shouldStartSync(lastStartMs: number | null, nowMs: number, minutes: number): boolean;
```
- Block, exact:
```
--- PENGATURAN BOT ---
Nama kamu: {botName}. Perkenalkan diri dengan nama ini, jangan nama lain.
Menyebut diri dari: {signAs line}
Sapaan pertama (pakai di balasan PERTAMA percakapan, sesuaikan dengan pesan pelanggan termasuk teks bawaan iklan; ganti {merek}): "{greeting}"
Minimum order untuk produk tanpa tingkat harga: {formatMinOrder(fallbackMinPcs)}.
--- AKHIR PENGATURAN BOT ---
```
- The `{signAs line}`:
  - `brand_discussed` → `merek yang sedang dibahas (Kertas Supreme atau Imperial Indopack); bila belum jelas, Imperial Indopack.`
  - `imperial_indopack` → `selalu Imperial Indopack.`
- Routes:
  - `GET /api/v1/settings/bot` → `{ data: BotSettings }`
  - `PATCH /api/v1/settings/bot` (partial) → `{ data: BotSettings }`, or 400 `VALIDATION_ERROR`
  - `GET /api/v1/settings/po-form-url` (Plan 1) returns `{ url, isPlaceholder, message: poFormMessage(url) }`
- `scheduleChakraSync`:
  - `CHAKRA_SYNC_INTERVAL_MS=0`, or a transport other than `chakra`, disables it
  - otherwise it ticks every 60 s after `FIRST_SYNC_DELAY_MS` and starts a sync when `shouldStartSync(last, now, settings.whatsappSyncMinutes)`

- [ ] **Step 1: Write the failing tests**

```ts
// bot-settings.test.ts
it('names the bot, keeps {merek} in the greeting and states the minimum', () => {
  const b = buildBotSettingsBlock({ ...DEFAULT_BOT_SETTINGS, botName: 'Sari' });
  expect(b).toContain('Nama kamu: Sari.'); expect(b).toContain('menghubungi {merek}.'); expect(b).toContain('2.500 pcs / 5 rim');
});
it('signs as Imperial Indopack when set', () => expect(buildBotSettingsBlock({ ...DEFAULT_BOT_SETTINGS, signAs: 'imperial_indopack' })).toContain('selalu Imperial Indopack.'));
it('formats the minimum', () => { expect(formatMinOrder(2500)).toBe('2.500 pcs / 5 rim'); expect(formatMinOrder(1200)).toBe('1.200 pcs'); });
it('decides when a sync is due', () => {
  expect(shouldStartSync(null, 0, 2)).toBe(true); expect(shouldStartSync(0, 119_000, 2)).toBe(false);
  expect(shouldStartSync(0, 120_000, 2)).toBe(true); expect(shouldStartSync(0, 1e9, 0)).toBe(false);
});
// bot-settings-routes.test.ts (DB; save and restore the row)
it('patches one field and keeps the rest', ...);            // PATCH { botName: 'Sari' } → GET has botName 'Sari' and the default greeting
it('refuses an empty greeting and a 2-minute reminder', ...); // both 400
it('falls back per field on a bad stored row', ...);         // value { botName: 5, greeting: 'Hai' } → botName 'Admin', greeting 'Hai'
it('po-form-url reports the placeholder and the message', ...); // isPlaceholder true, message === poFormMessage(PO_FORM_PLACEHOLDER_URL)
// prompt-warmup.test.ts: add getBotSettings to the appSettings mock (botName 'Sari'); the system text contains 'Nama kamu: Sari.'
// escalationHandler.test.ts
it('asks quantity with the configured minimum', () =>
  expect(pickProfileGapQuestion(P({ items: [{ product: 'box', size: '20x20x7' }] }), [], 1000)).toBe(escalationAskQuantity(1000)));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/bot-settings.test.ts tests/bot-settings-routes.test.ts tests/prompt-warmup.test.ts tests/escalationHandler.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests, the nudge suite and tsc**

Run: the Step 2 command plus `tests/escalation-nudge.test.ts`, then `npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Bot name, greeting and minimum in the prompt; reminder and sync from settings"
```

---

### Task 5: WhatsApp status and go-live checks

**Files:**
- Create: `api/src/domain/brands.ts`, `api/src/services/goLive.ts`
- Modify:
  - `api/src/repositories/products.ts` (`getBrandRowsBySlug`)
  - `api/src/services/catalogDelivery.ts`: if it holds its own slug ↔ name map, import `brands.ts` instead
  - `api/src/routes/dashboard/settings.ts`
- Test: `api/tests/go-live.test.ts`

**Interfaces:**
- Consumes: `BrandSlug` (Plan 1 Task 8), `getPoFormUrl`, `PO_FORM_PLACEHOLDER_URL`, `getConfig`
- Produces:
```ts
// brands.ts
export const BRAND_SLUGS: readonly BrandSlug[] = ['kertas_supreme', 'imperial_indopack'];
export const BRAND_NAME: Record<BrandSlug, string> = { kertas_supreme: 'Kertas Supreme', imperial_indopack: 'Imperial Indopack' };
export function brandSlugOfName(name: string): BrandSlug | null; // case-insensitive
// products.ts
export async function getBrandRowsBySlug(): Promise<Record<BrandSlug, Brand | null>>;
// goLive.ts
export type WhatsAppTransport = 'chakra' | 'meta' | 'capture';
export interface WhatsAppStatus { transport: WhatsAppTransport; credentialsSet: boolean; numberCount: number; connected: boolean; lastInboundAt: string | null }
export type GoLiveIssue = { code: 'po_form_placeholder' } | { code: 'whatsapp_not_connected' } | { code: 'catalog_empty' } | { code: 'price_list_missing'; brand: BrandSlug };
export function credentialsSet(c: Config): boolean;
export async function getWhatsAppStatus(): Promise<WhatsAppStatus>;
export async function getGoLiveIssues(): Promise<GoLiveIssue[]>; // in the order of the union above, price lists in BRAND_SLUGS order
```
- `credentialsSet` rules:
  - `chakra` needs `CHAKRA_ACCESS_TOKEN`, `CHAKRA_PLUGIN_ID` and `CHAKRA_WEBHOOK_SECRET`
  - `meta` needs `META_ACCESS_TOKEN`, `META_WEBHOOK_SECRET` and `META_WEBHOOK_VERIFY_TOKEN`
  - `capture` is always `false`
- `connected` = `credentialsSet && numberCount > 0`. `lastInboundAt` = the newest `messages.created_at` with role `user`.
- `catalog_empty` = no active product has a variant with a tier.
- Routes: `GET /api/v1/settings/whatsapp-status` → `{ data: WhatsAppStatus }`, and `GET /api/v1/settings/go-live` → `{ data: { issues: GoLiveIssue[] } }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('credentials per transport', () => {
  expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'chakra', CHAKRA_ACCESS_TOKEN: 't', CHAKRA_PLUGIN_ID: 'p', CHAKRA_WEBHOOK_SECRET: 's' })).toBe(true);
  expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'meta', META_ACCESS_TOKEN: 't' })).toBe(false);
  expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'capture' })).toBe(false);
});
// DB: save and restore the PO setting and the Kertas Supreme catalog_file_url
it('flags the placeholder PO link until a real one is saved', ...); // codes include 'po_form_placeholder'; after setPoFormUrl('https://forms.gle/x') they do not
it('flags a brand with no price list', ...);                       // Kertas Supreme url null → { code: 'price_list_missing', brand: 'kertas_supreme' }
it('capture is never connected', ...);                             // getWhatsAppStatus() → connected false; issues include 'whatsapp_not_connected'
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/go-live.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/go-live.test.ts tests/catalog-delivery.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "WhatsApp connection status and go-live checklist endpoints"
```

---

### Task 6: Product editor API (tier-aware create, update, activate, delete, history)

**Files:**
- Create:
  - `api/src/db/migrations/0028_catalog_editor.sql`, with journal idx 28 (`when` 1794300000000)
  - `api/src/domain/productSpec.ts`, `api/src/services/catalogEditor.ts`, `api/src/repositories/catalogAudit.ts`
  - `api/src/routes/dashboard/catalogProducts.ts`
  - `api/src/routes/dashboard/catalogCache.ts`: the `onResponse` invalidation hook moved out of `catalog.ts` as `invalidateCatalogOnWrite(app)`; both files register it
- Modify:
  - `api/src/db/schema.ts`
  - `api/src/repositories/products.ts`: `listProducts` gains `activeOnly?: boolean`. The cached catalog source behind `getFullCatalogBlock` and `runPriceTool` passes `true`.
  - `api/src/services/catalogTemplate.ts`: join and split the spec through `productSpec.ts`; behaviour unchanged
  - `api/src/app.ts` (register the routes)
- Test: `api/tests/product-spec.test.ts`, `api/tests/catalog-editor.test.ts` (pure), `api/tests/catalog-products-routes.test.ts` (DB)

**Interfaces:**
- Consumes: `PriceTier`, `QtyUnit`, `toPcs` (Plan 1 Task 2), `replaceVariantTiers`, `listTiersByVariant` (Task 3 of Plan 1), `normalizeSize` (Plan 1 Task 5), `getBrandRowsBySlug` (Task 5)
- Produces:
```ts
// productSpec.ts
export interface ProductSpec { gsm: string | null; print: string | null; finishing: string | null }
export function formatProductSpec(s: ProductSpec): string | null; // 'Gramasi: 64 gsm · Cetak: 1 warna · Finishing: Laminasi food grade'; all empty → null
export function parseProductSpec(description: string | null): ProductSpec; // inverse; unlabelled text → all null
// catalogEditor.ts
export const ProductDraftSchema; // { brand: BrandSlug; name: string; gsm, print, finishing: string|null; use: string; isActive: boolean;
                                 //   sizes: { id?: uuid; size: string; tiers: { minQty: int>0|null; qtyUnit; priceIdr: >0|null; priceUnit; includesDelivery }[] }[] }
export type ProductDraft = z.infer<typeof ProductDraftSchema>;
export interface ProductInput { brand: BrandSlug; name: string; gsm: string | null; print: string | null; finishing: string | null; use: string; isActive: boolean; sizes: { id?: string; size: string; tiers: PriceTier[] }[] }
export type ProductInputErrorCode = 'name_required' | 'use_required' | 'no_sizes' | 'size_required' | 'duplicate_size' | 'no_tiers' | 'qty_missing' | 'price_missing' | 'duplicate_tier' | 'tier_order';
export interface ProductInputError { code: ProductInputErrorCode; sizeIndex?: number; tierIndex?: number }
export function validateProductDraft(d: ProductDraft): { ok: true; input: ProductInput } | { ok: false; errors: ProductInputError[] };
export type CatalogChange =
  | { kind: 'created'; via: 'form' | 'import'; fileName?: string }
  | { kind: 'field'; field: 'name' | 'brand' | 'gsm' | 'print' | 'finishing' | 'use'; from: string | null; to: string | null }
  | { kind: 'active'; to: boolean }
  | { kind: 'size_added' | 'size_removed'; size: string } | { kind: 'size_renamed'; from: string; to: string }
  | { kind: 'tier_added' | 'tier_removed'; size: string; minQty: number; qtyUnit: QtyUnit }
  | { kind: 'tier_price'; size: string; minQty: number; qtyUnit: QtyUnit; priceUnit: QtyUnit; from: number; to: number }
  | { kind: 'delivery'; size: string; minQty: number; qtyUnit: QtyUnit; to: boolean };
export function diffProduct(before: ProductInput, after: ProductInput): CatalogChange[]; // fields, active, sizes removed/added/renamed, then tiers per kept size
export interface CatalogProduct extends Omit<ProductInput, 'sizes'> { id: string; sizes: { id: string; size: string; tiers: PriceTier[] }[]; referenceImages: { id: string; imageUrl: string; sort: number }[]; updatedAt: string }
export interface Actor { staffId: string | null; name: string }
export class ProductNameTakenError extends Error {}
export async function listCatalogProducts(f: { brand?: BrandSlug; search?: string; status?: 'active' | 'inactive' }): Promise<{ items: CatalogProduct[]; counts: Record<'all' | BrandSlug, number> }>;
export async function getCatalogProduct(id: string): Promise<CatalogProduct | null>;
export async function createCatalogProduct(input: ProductInput, actor: Actor): Promise<CatalogProduct>;
export async function updateCatalogProduct(id: string, input: ProductInput, actor: Actor): Promise<CatalogProduct | null>;
export async function setCatalogProductActive(id: string, isActive: boolean, actor: Actor): Promise<CatalogProduct | null>;
export async function deleteCatalogProduct(id: string, actor: Actor): Promise<{ sizes: number; tiers: number } | null>;
export async function getProductUsage(productName: string): Promise<{ quotedLast30Days: number; wonLeads: number }>;
// catalogAudit.ts
export type CatalogChangeType = 'created' | 'updated' | 'imported' | 'activated' | 'deactivated' | 'deleted';
export interface CatalogHistoryEntry { id: string; changeType: CatalogChangeType; changes: CatalogChange[]; actorName: string; changedAt: string }
export async function recordCatalogChange(tx: DbOrTx, productId: string, type: CatalogChangeType, changes: CatalogChange[], actor: Actor): Promise<void>;
export async function listCatalogHistory(productId: string, limit = 20): Promise<CatalogHistoryEntry[]>; // newest first
```
- Migration:
```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS catalog_file_name text, ADD COLUMN IF NOT EXISTS catalog_file_uploaded_at timestamptz;
ALTER TABLE catalog_audit ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE catalog_audit DROP CONSTRAINT IF EXISTS catalog_audit_changed_by_staff_profiles_id_fk;
ALTER TABLE catalog_audit ADD CONSTRAINT catalog_audit_changed_by_staff_profiles_id_fk FOREIGN KEY (changed_by) REFERENCES staff_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_audit_item ON catalog_audit (item_id, changed_at DESC);
```
- Validation:
  - Names and sizes are trimmed.
  - `duplicate_size` is reported on the later of two sizes with equal `normalizeSize`.
  - `duplicate_tier` = the same `(minQty, qtyUnit)` twice.
  - `tier_order` = tiers not strictly ascending in pcs in the order given, reported on the first offending tier.
  - `qty_missing` and `price_missing` = a `null` in the draft.
- Saving:
  - one transaction per save; product name unique, case-insensitive
  - a size with an `id` of this product updates that variant (rename included); a size without one matches by `normalizeSize`, else it is inserted; variants left unmatched are deleted
  - `product_variants.price_idr` = the smallest-quantity tier's price, the rule `importCatalogFromXlsx` uses (align that import if it differs)
  - then `replaceVariantTiers`, then `recordCatalogChange`
  - create writes `[{ kind: 'created', via: 'form' }]`
- `getProductUsage`:
  - `quotedLast30Days` = assistant rows in the last 30 days whose `metadata.priceCalls` holds this `productName`
  - `wonLeads` = won leads whose `items::text ILIKE` the name
- Routes (staff from the session, sent in the body as `{ staffId?, staffName }`):
  - `GET /api/v1/catalog/products?brand&search&status` → `{ data: CatalogProduct[], meta: { counts } }`
  - `GET /api/v1/catalog/products/:id` → `{ data: { product, history, usage } }`, or 404
  - `POST /api/v1/catalog/products` with `{ draft, staffId?, staffName }` → 201, or 400 `{ error: 'VALIDATION_ERROR', details: ProductInputError[] }`, or 409 `NAME_TAKEN`
  - `PUT /api/v1/catalog/products/:id` (same body) → 200, or 400 / 404 / 409
  - `PATCH /api/v1/catalog/products/:id/active` with `{ isActive, staffId?, staffName }` → 200 (history `activated` / `deactivated`)
  - `DELETE /api/v1/catalog/products/:id?staffName=` → 200 `{ data: { sizes, tiers } }` (history `deleted` with the product name)

- [ ] **Step 1: Write the failing pure tests**

```ts
it('spec round-trips', () => expect(parseProductSpec(formatProductSpec({ gsm: '64 gsm', print: '1 warna', finishing: null }))).toEqual({ gsm: '64 gsm', print: '1 warna', finishing: null }));
it('flags tier order, duplicate size and a missing price by index', () => {
  const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(10), T(5)]), S('30 x 30 cm', [T(5, null)])] }));
  expect(r.ok === false && r.errors).toEqual(expect.arrayContaining([
    { code: 'tier_order', sizeIndex: 0, tierIndex: 1 }, { code: 'duplicate_size', sizeIndex: 1 }, { code: 'price_missing', sizeIndex: 1, tierIndex: 0 }]));
});
it('diff lists a price change, an added size and a removed tier', () =>
  expect(diffProduct(BOX, { ...BOX, sizes: [EDIT_10RIM_1450, NEW_SIZE] })).toEqual([
    { kind: 'size_added', size: '25 x 8 x 6 cm' },
    { kind: 'tier_price', size: '21 x 14 x 5 cm', minQty: 10, qtyUnit: 'rim', priceUnit: 'pcs', from: 1500, to: 1450 }]));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/product-spec.test.ts tests/catalog-editor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the failing DB route tests `tests/catalog-products-routes.test.ts`**

Product names are prefixed `__qa_editor__`, and `afterAll` deletes them.
```ts
it('creates a two-size product and lists it under its brand', ...);   // 201; list ?brand=kertas_supreme includes it; sizes[0].tiers has 3; variant price_idr '185000'
it('400 VALIDATION_ERROR with tier_order details', ...);
it('409 NAME_TAKEN for a second product with the same name in other case', ...);
it('a price edit writes one history entry with from and to', async () => {
  // PUT the same draft with the 10-rim price 165000 → 160500
  expect((await get(id)).history[0]).toMatchObject({ changeType: 'updated', actorName: 'Admin QA',
    changes: [{ kind: 'tier_price', size: '30 x 30 cm', minQty: 10, qtyUnit: 'rim', priceUnit: 'rim', from: 165000, to: 160500 }] });
});
it('renaming a size keeps its variant id', ...);                       // sizes[0].id kept, change size_renamed
it('deactivating hides the product from the bot at once', async () => {
  await patch(`/api/v1/catalog/products/${id}/active`, { isActive: false, staffName: 'Admin QA' });
  expect(await getFullCatalogBlock()).not.toContain(NAME);
  expect((await runPriceTool({ product: NAME, size: '30x30', qty: 5, unit: 'rim' })).call.outcome).toBe('not_in_catalog');
});
it('deleting removes sizes and tiers and keeps the history row', ...); // { sizes: 2, tiers: 4 }; GET 404; no tiers left for those variants; a 'deleted' audit row exists
```

- [ ] **Step 4: Write the migration, apply it, implement everything, and run all three test files**

Run: `npx tsx scripts/migrate.ts && npx vitest run tests/product-spec.test.ts tests/catalog-editor.test.ts tests/catalog-products-routes.test.ts tests/catalog-template.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Tier-aware product editor API with active flag and change history"
```

---

### Task 7: Editor preview, price check, brand price-list files

**Files:**
- Modify:
  - `api/src/routes/dashboard/catalogProducts.ts` (preview, price check)
  - `api/src/repositories/products.ts` (`setBrandPriceList`)
  - `api/src/services/catalogDelivery.ts` (document file name)
  - `api/src/app.ts`
- Create: `api/src/routes/dashboard/brandPriceLists.ts`
- Test: `api/tests/catalog-preview-routes.test.ts` (DB)

**Interfaces:**
- Consumes: `ProductDraftSchema`, `validateProductDraft`, `diffProduct`, `getCatalogProduct` (Task 6), `formatProducts` (Plan 1 Task 3), `runPriceTool`, `PriceToolInput` (Plan 1 Task 5, Task 2), `BRAND_NAME` (Task 5)
- Produces:
```ts
export interface ProductPreview { botText: string; hiddenSizes: string[]; errors: ProductInputError[]; changes: CatalogChange[] }
// POST /api/v1/catalog/products/preview  { productId?: string; draft: ProductDraft } → { data: ProductPreview }
//   botText = formatProducts([draft as a Product]) over the sizes whose tiers are complete; hiddenSizes = the other sizes, as typed;
//   changes = diffProduct(stored, input) when productId is given and the draft is valid, else []
// POST /api/v1/catalog/price-check  PriceToolInput → { data: { text: string; call: PriceToolCall } }   (the live, active-only catalog)
export interface BrandPriceList { brand: BrandSlug; url: string | null; fileName: string | null; uploadedAt: string | null }
export async function setBrandPriceList(slug: BrandSlug, file: { url: string; fileName: string } | null): Promise<BrandPriceList>;
// GET    /api/v1/brands/price-lists        → { data: BrandPriceList[] }    (both brands, BRAND_SLUGS order)
// POST   /api/v1/brands/:slug/price-list   multipart, one PDF ≤ 20 MB → { data: BrandPriceList } | 400 UNSUPPORTED_MIME_TYPE | 404 unknown slug
// DELETE /api/v1/brands/:slug/price-list   → { data: BrandPriceList } (url null)
```
- Uploads are stored like `POST /api/v1/upload/catalog` (`uploads/catalogs/<uuid>.pdf`) and invalidate the catalog cache.
- `catalogDelivery` sends `brand.catalogFileName ?? \`Daftar Harga ${BRAND_NAME[slug]}.pdf\`` as the document file name.

- [ ] **Step 1: Write the failing tests**

Save and restore both brands' price-list columns in `beforeAll` / `afterAll`.
```ts
it('preview shows tier lines exactly as the bot reads them and hides an incomplete size', async () => {
  const p = (await post('/api/v1/catalog/products/preview', { draft: SUPREME_DRAFT_WITH_EMPTY_35 })).json().data;
  expect(p.botText).toContain('  • mulai 5 rim (2.500 pcs): Rp 185.000/rim, belum termasuk ongkir');
  expect(p.hiddenSizes).toEqual(['35 x 35 cm']);
  expect(p.errors).toEqual([{ code: 'price_missing', sizeIndex: 1, tierIndex: 0 }]);
});
it('preview of a stored product lists the unsaved change', ...);    // changes [{ kind: 'tier_price', from: 1500, to: 1450, ... }]
it('price check answers what the bot would', ...);                  // test product, 12 rim → text /^HARGA:/, call.quote.totalIdr 1980000
it('uploads a price list with name and date; GET lists both brands', ...); // fileName 'Daftar Harga KS QA.pdf', uploadedAt set; the other brand url null
it('refuses a PNG', ...);                                            // 400 UNSUPPORTED_MIME_TYPE
it('the bot sends the uploaded file name', ...);                     // resolveCatalogDelivery(C, 'berapa harga kertas supreme?').files[0].filename === 'Daftar Harga KS QA.pdf'
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/catalog-preview-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/catalog-preview-routes.test.ts tests/catalog-delivery.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Product preview and diff, price check, per-brand price-list files"
```

---

### Task 8: Import preview, history and template download

**Files:**
- Modify:
  - `api/src/services/catalogImport.ts`: add `previewCatalogImport`; `importCatalogFromXlsx` takes `opts` and writes history
  - `api/src/services/catalogTemplate.ts` (error copy; brand must be one of the two)
  - `api/src/routes/dashboard/catalog.ts`: `dryRun`, `fileName` and staff params; template route; export file name
- Test: `api/tests/catalog-import-preview.test.ts` (DB), `api/tests/catalog-template.test.ts` (add the copy cases)

**Interfaces:**
- Consumes: `parseTemplateRows`, `TEMPLATE_COLUMNS`, `buildTemplateRows` (Plan 1 Task 4), `diffProduct`, `recordCatalogChange`, `Actor` (Task 6)
- Produces:
```ts
export interface ImportPreview { newProducts: number; newSizes: number; changedPrices: number; unchanged: number; validRows: number; totalRows: number; errors: { row: number; message: string }[] }
export async function previewCatalogImport(buffer: Buffer): Promise<ImportPreview>; // writes nothing
export async function importCatalogFromXlsx(buffer: Buffer, opts?: { fileName?: string; actor?: Actor }): Promise<CatalogImportResult>; // Plan 1's shape kept
// POST /api/v1/catalog/import?dryRun=1                  → { data: { preview } }
// POST /api/v1/catalog/import?fileName=&staffName=      → { data: { preview, result } }
// GET  /api/v1/catalog/template                         → template-katalog.xlsx (header row only)
// GET  /api/v1/catalog/export                           → katalog-imperial-indopack-YYYY-MM-DD.xlsx
```
- Preview counts:
  - `newProducts` = product names not in the DB (case-insensitive)
  - `newSizes` = sizes not yet on an existing product
  - `changedPrices` = tier rows of existing variants that are new or differ in price or delivery
  - `unchanged` = valid rows that change nothing
  - `validRows` = rows with no error; `totalRows` = data rows
- Error copy, exact, from ImportExcel.dc.html:
  - `Satuan "${v}" tidak dikenal. Pakai rim atau pcs.`
  - `Harga ${v}. Harga harus lebih dari 0.`
  - `Kolom Merek kosong. Isi Kertas Supreme atau Imperial Indopack.`
  - `Merek "${v}" tidak dikenal. Isi Kertas Supreme atau Imperial Indopack.`
  - `Kolom Produk kosong.`
  - `Kolom Ukuran kosong.`
  - `Min Qty "${v}" bukan angka bulat lebih dari 0.`
- History on apply: a new product gets `created` with `[{ kind: 'created', via: 'import', fileName }]`; a changed one gets `imported` with its `diffProduct` changes, actor name `Sistem` unless a staff name is given.

- [ ] **Step 1: Write the failing tests**

```ts
it('error copy matches the dialog', () => expect(parseTemplateRows([HEADER, ROW({ satuanQty: 'box' }), ROW({ harga: '0' }), ROW({ merek: '' })]).errors.map((e) => e.message)).toEqual([
  'Satuan "box" tidak dikenal. Pakai rim atau pcs.', 'Harga 0. Harga harus lebih dari 0.', 'Kolom Merek kosong. Isi Kertas Supreme atau Imperial Indopack.']));
it('dry run counts and writes nothing', async () => {
  const p = (await importRoute(FILE_1NEW_1CHANGED_3BAD, { dryRun: true })).preview;
  expect(p).toMatchObject({ newProducts: 1, changedPrices: 1, totalRows: 6, validRows: 3 });
  expect(p.errors.map((e) => e.row)).toEqual([5, 6, 7]);
  expect(await priceOf(EXISTING_VARIANT, 10)).toBe(165000); // unchanged
});
it('apply records history with the file name', ...); // new product history[0].changes[0] = { kind: 'created', via: 'import', fileName: 'katalog-november.xlsx' }; the changed one has a tier_price change
it('the template download is exactly the template header', ...); // rows[0] equals [...TEMPLATE_COLUMNS], one row only
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/catalog-template.test.ts tests/catalog-import-preview.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests, Plan 1's import test and tsc**

Run: `npx vitest run tests/catalog-template.test.ts tests/catalog-import-preview.test.ts tests/catalog-template-import.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Catalog import preview before apply, with history and template download"
```

---

### Task 9: Conversation list and the team queue

**Files:**
- Create: `api/src/domain/orderDetails.ts`, `api/src/services/teamQueue.ts`, `api/src/routes/dashboard/teamQueue.ts`
- Modify:
  - `api/src/repositories/conversations.ts` (`listConversations`)
  - `api/src/domain/schemas.ts`: `ConversationsQuerySchema` gets `view` and `search`
  - `api/src/routes/dashboard/conversations.ts`, `api/src/app.ts`
- Test: `api/tests/order-details.test.ts` (pure), `api/tests/conversation-list-queue.test.ts` (DB)

**Interfaces:**
- Consumes: `OrderItem`, `BrandSlug` (Plan 1 Task 8), `HandoffCategory`, `HANDOFF_CATEGORIES` (Task 3), `getBotSettings` (Task 4), `MESSAGE_SOURCE` (Task 2)
- Produces:
```ts
// orderDetails.ts
export const ORDER_DETAIL_KEYS = ['name', 'business_name', 'model', 'size', 'qty', 'design'] as const;
export type OrderDetailKey = (typeof ORDER_DETAIL_KEYS)[number];
export interface OrderDetailRow { key: OrderDetailKey; filled: boolean; value: string | null }
export function orderDetailRows(facts: Record<string, unknown>): OrderDetailRow[]; // always 6, in key order; several items join with '; '
export function formatItemQty(qty: number, unit: QtyUnit): string;               // 5000 pcs → '5.000 pcs (10 rim)'; 12 rim → '12 rim (6.000 pcs)'; 2700 pcs → '2.700 pcs'
export function orderItemsSummary(items: OrderItem[]): string;                   // '<product> · <size> · <qty> · desain ada|belum ada desain', unknown parts dropped, items joined ' + '
// conversations.ts
export type ConversationView = 'team' | 'ai' | 'resolved';
export interface ConversationListRow { /* every field the current list row has */ customerName: string | null; businessName: string | null; brands: BrandSlug[];
  lastMessage: { body: string; role: string; senderName: string | null } | null; handoffCategory: HandoffCategory | null; poFormSentAt: Date | null; escalatedAt: Date | null }
listConversations(params & { view?: ConversationView; search?: string }): Promise<{ items: ConversationListRow[]; total: number; counts: { all: number; team: number; ai: number; resolved: number } }>;
// teamQueue.ts
export interface TeamQueueItem { conversationId: string; customerName: string | null; businessName: string | null; waId: string; brands: BrandSlug[];
  itemsSummary: string; detailsFilled: number; missing: OrderDetailKey[]; waitingSince: string; assignedAgent: string | null; status: 'escalated' | 'needs_human' }
export interface TeamQueue { waitingCount: number; oldestWaitingSince: string | null; reminderMinutes: number; groups: { category: HandoffCategory; items: TeamQueueItem[] }[] }
export async function getTeamQueue(opts?: { assignedTo?: string }): Promise<TeamQueue>;
// GET /api/v1/conversations?view=&search=&page=&limit=   → meta adds counts
// GET /api/v1/team-queue?assignedTo=                      → { data: TeamQueue }
```
- Views: `team` = status `escalated` or `needs_human`; `ai` = `active`; `resolved` = `resolved`.
- `search` is ILIKE, with `%`, `_` and `\` escaped, over `contacts.wa_id`, `contacts.display_name`, `profile->>'name'` and `profile->>'business_name'`.
- `customerName` = profile `name` ?? `display_name`. `brands` come from profile `brands`, known slugs only.
- `poFormSentAt` = the newest row with `metadata.source = 'po_form'`.
- Queue:
  - all 7 categories in `HANDOFF_CATEGORIES` order; a null category counts as `lainnya`
  - items oldest first; `waitingSince` = `escalatedAt ?? updatedAt`
  - `reminderMinutes` = `teamReminderMinutes`

- [ ] **Step 1: Write the failing pure tests**

```ts
const ANDI = { name: 'Andi', business_name: 'Katering Contoh Sehat', items: [{ product: 'Box Ivory', print: 'full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs', has_design: true }] };
it('six rows in order, all filled', () => {
  const rows = orderDetailRows(ANDI);
  expect(rows.map((r) => r.key)).toEqual([...ORDER_DETAIL_KEYS]); expect(rows.every((r) => r.filled)).toBe(true);
  expect(rows.find((r) => r.key === 'qty')?.value).toBe('5.000 pcs (10 rim)'); expect(rows.find((r) => r.key === 'design')?.value).toBe('Ada');
});
it('design unknown is not filled; false is "Belum ada"', ...);
it.each([[5000, 'pcs', '5.000 pcs (10 rim)'], [12, 'rim', '12 rim (6.000 pcs)'], [2700, 'pcs', '2.700 pcs']])('formatItemQty(%i, %s)', (q, u, s) => expect(formatItemQty(q, u)).toBe(s));
```

- [ ] **Step 2: Write the failing DB tests**

```ts
it('view=team lists escalated and needs_human only, with counts', ...);
it('search finds a business name and treats % literally', ...);        // 'Contoh Sehat' → the row; '%' → none of the test rows
it('a row carries name, business, brands, last message and PO time', ...);
it('the queue groups by category oldest first and filters by assignee', ...); // groups[0].category 'harga_custom'; assignedTo 'Admin QA' leaves only that row
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/order-details.test.ts tests/conversation-list-queue.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement, then run the tests and tsc**

Run: the Step 3 command, then `npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Inbox list by view and search; Perlu Tim queue grouped by handoff category"
```

---

### Task 10: Order panel (six details, nearest catalog item, customer files, team notes)

**Files:**
- Create: `api/src/services/nearestCatalog.ts`, `api/src/services/orderPanel.ts`
- Modify:
  - `api/src/repositories/conversations.ts` (`setTeamNotes`)
  - `api/src/routes/dashboard/conversations.ts`
  - `api/src/services/messageRouter.ts`: inbound documents are saved like images
- Test: `api/tests/nearest-catalog.test.ts` (pure), `api/tests/order-panel.test.ts` (DB)

**Interfaces:**
- Consumes: `orderDetailRows` (Task 9), `quotePrice`, `PriceTier` (Plan 1), `normalizeSize` (Plan 1 Task 5), the active catalog source (Task 6), `findCurrentLeadForContact`
- Produces:
```ts
export function parseSizeDims(size: string): number[] | null;   // '22×22×7' → [22,22,7]; '20 x 20 x 7,5 cm' → [20,20,7.5]; 'besar' → null
export interface NearestMatch { item: OrderItem; productId: string; productName: string; variantName: string; exact: boolean; quote: PriceQuote | null; tier: PriceTier | null }
export function nearestCatalogItem(item: OrderItem, catalog: Product[]): NearestMatch | null;
export interface CustomerFile { messageId: string; kind: 'image' | 'document'; url: string | null; filename: string; at: string }
export interface TeamNotes { text: string; updatedAt: string | null; updatedBy: string | null }
export type PanelDetailRow = OrderDetailRow & { note?: { kind: 'out_of_catalog' } | { kind: 'file_sent'; at: string } };
export interface OrderPanel { brands: BrandSlug[]; lead: { id: string; status: LeadStatus; kind: LeadKind; temperature: 'hot' | 'cold' | null } | null;
  details: PanelDetailRow[]; detailsFilled: number; nearest: NearestMatch[]; files: CustomerFile[]; teamNotes: TeamNotes }
export async function getOrderPanel(conversationId: string): Promise<OrderPanel | null>;
// repositories/conversations.ts
export async function setTeamNotes(conversationId: string, text: string, by: string): Promise<TeamNotes | null>;
// GET   /api/v1/conversations/:id/order-panel  → { data: OrderPanel } | 404
// PATCH /api/v1/conversations/:id/team-notes   { text: string (≤ 2000), staffName: string } → { data: TeamNotes } | 400 | 404
```
- `nearestCatalogItem`, product: the words of `item.product` (lowercase, split on non-alphanumerics, length ≥ 2) are counted in each active product's name. The highest count of at least 1 wins; ties go to the product name that sorts first.
- `nearestCatalogItem`, variant: only variants with as many dimensions as the item; the smallest sum of `|Δ|` wins. `exact` = equal `normalizeSize`.
- `nearestCatalogItem`, price: `quote` = `quotePrice(tiers, qty, qty_unit)` when both are known. `tier` = the quote's tier, else the lowest tier. No size, or no dimension match, gives `null`.
- Panel notes: the `size` row gets `out_of_catalog` when an item with a size has no exact match. The `design` row gets `file_sent` with the newest customer file's time.
- Files: inbound rows with `metadata.attachmentType` `image` or `document`. `url` = `metadata.mediaUrl`. `filename` = `metadata.filename` ?? the URL's basename.
- Inbound documents are saved to `uploads/inbound/<ts>_<wamid>_<name>`. `name` is the basename with `[^a-zA-Z0-9._-]` → `_`, at most 80 characters. `metadata.mediaUrl` is set.
- Team notes live in the Task 3 columns. Neither `updateConversationFollowUp` nor `resetConversationContext` touches them.

- [ ] **Step 1: Write the failing pure tests**

```ts
const BOXES = [BOX_IVORY({ sizes: ['21 x 7 x 5 cm', '21 x 14 x 5 cm'], tiers: [T(5, 1900), T(10, 1500)] })];
it('parses dimensions', () => { expect(parseSizeDims('22×22×7')).toEqual([22, 22, 7]); expect(parseSizeDims('20 x 20 x 7,5 cm')).toEqual([20, 20, 7.5]); expect(parseSizeDims('besar')).toBeNull(); });
it('22x22x7 is nearest to 21 x 14 x 5 cm, not exact, at the 10-rim tier for 5000 pcs', () =>
  expect(nearestCatalogItem({ product: 'box ivory full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs' }, BOXES))
    .toMatchObject({ variantName: '21 x 14 x 5 cm', exact: false, tier: { minQty: 10, priceIdr: 1500 } }));
it('30 x 30 cm matches 30x30 exactly', ...);
it('a two-dimension size never matches a box', ...);
it('no shared word gives null', ...);
```

- [ ] **Step 2: Write the failing DB tests**

```ts
it('lists six details, the out-of-catalog size and both customer files', ...); // profile ANDI; inbound image + document rows → files.length 2, size note out_of_catalog
it('team notes survive an AI follow-up write and /new', async () => {
  await setTeamNotes(conv.id, 'Sudah ditelepon, minta sampel', 'Admin QA');
  await updateConversationFollowUp(conv.id, 'AI note'); await resetConversationContext(conv.id);
  expect((await getOrderPanel(conv.id))?.teamNotes).toMatchObject({ text: 'Sudah ditelepon, minta sampel', updatedBy: 'Admin QA' });
});
it('refuses notes over 2000 characters', ...); // 400
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/nearest-catalog.test.ts tests/order-panel.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement, then run the tests, the router suite and tsc**

Run: `npx vitest run tests/nearest-catalog.test.ts tests/order-panel.test.ts tests/messageRouter-debounce.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Order panel: six details, nearest catalog item, customer files, team notes"
```

---

### Task 11: Quick-send (price list, reference photos, PO form)

**Files:**
- Create: `api/src/services/quickSend.ts`
- Modify: `api/src/routes/dashboard/conversations.ts`
- Test: `api/tests/quick-send.test.ts` (DB with the capture transport: set `WHATSAPP_TRANSPORT=capture` and a temp `CAPTURE_LOG_PATH` before importing)

**Interfaces:**
- Consumes: `getBrandRowsBySlug` (Task 5), `getPoFormUrl`, `PO_FORM_PLACEHOLDER_URL`, `poFormMessage` (Plan 1 Task 7), reference images (Plan 1 Task 3), `markHumanTakeover`, `MESSAGE_SOURCE` (Task 2), `readCaptured` (Task 1)
- Produces:
```ts
export type QuickSendAction = { kind: 'price_list'; brand?: BrandSlug } | { kind: 'reference_photos'; productId: string } | { kind: 'po_form' };
export type QuickSendError = 'NOT_FOUND' | 'BRAND_UNKNOWN' | 'NO_PRICE_LIST' | 'NO_REFERENCE_PHOTOS' | 'PO_FORM_PLACEHOLDER';
export type QuickSendResult = { ok: true; sent: { messageId: string; kind: 'text' | 'image' | 'document' }[] } | { ok: false; error: QuickSendError };
export async function quickSend(conversationId: string, action: QuickSendAction, staffName: string): Promise<QuickSendResult>;
// POST /api/v1/conversations/:id/quick-send { action: QuickSendAction; staffName: string } → 200 { data: { sent } } | 404 | 409 { error: QuickSendError }
```
- `price_list`:
  - brands = `[action.brand]` or else the profile's brands; none → `BRAND_UNKNOWN`
  - each brand that has a file is sent as a document with its file name; none has one → `NO_PRICE_LIST`
- `reference_photos`: the product's images in `sort` order, at most 3; none → `NO_REFERENCE_PHOTOS`.
- `po_form`: the placeholder URL → `PO_FORM_PLACEHOLDER` and nothing is sent; otherwise one text, `poFormMessage(url)`.
- Each item sent:
  - goes through `whatsappSender` (best effort, like `/api/v1/send`)
  - becomes a row with role `assistant`, `senderName: staffName` and status `sent` or `saved`
  - its metadata has the `MESSAGE_SOURCE` tag plus the attachment fields `attachments.ts` writes
- After the first successful send: `markHumanTakeover(conversationId, staffName)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('sends both price lists when the profile has both brands', ...);   // two captured documents with each brand's fileName
it('BRAND_UNKNOWN when no brand is known and none is given', ...);    // 409, nothing captured
it('NO_PRICE_LIST for a brand without a file', ...);
it('refuses the placeholder PO link and sends nothing', async () => {
  const before = readCaptured(LOG).length;
  expect((await inject('POST', `/api/v1/conversations/${conv.id}/quick-send`, { action: { kind: 'po_form' }, staffName: 'Admin QA' })).statusCode).toBe(409);
  expect(readCaptured(LOG)).toHaveLength(before);
});
it('sends the PO message once a real link is set', ...);              // captured text === poFormMessage('https://forms.gle/qa-imperial-form'); the row's metadata.source 'po_form'
it('sends reference photos in order and hands the chat to the staff member', ...); // 2 captured images in sort order; status 'needs_human'; a system_note row
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/quick-send.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/quick-send.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Quick-send price list, reference photos and PO form from the inbox"
```

---

### Task 12: Leads by brand, report brand filter, lead detail extras

**Files:**
- Create: `api/src/services/leadDetailExtras.ts`
- Modify:
  - `api/src/repositories/leads.ts`: `getBrandSummary`; the `listLeads` search covers business name and items
  - `api/src/repositories/leadReport.ts`: `brand` filter and `dailyByBrand`
  - `api/src/routes/dashboard/leads.ts`, `api/src/domain/schemas.ts`
  - `api/src/domain/types.ts`: `LOST_REASONS` adds `'di_bawah_minimum'`; `LeadReport.dailyByBrand`
  - `api/src/services/leadInsights.ts`: the prompt's `lost_reason` line lists `di_bawah_minimum`
  - `api/src/routes/webhooks.ts`, `BaileysInboundPayloadSchema` and the `messageRouter` inbound metadata: the click-to-WhatsApp `referral`
- Test: `api/tests/leads-brand-report.test.ts` (DB), `api/tests/lead-detail-extras.test.ts` (DB), `api/tests/webhooks-referral.test.ts` (follow `tests/webhooks-caption.test.ts`), `api/tests/lead-insights-parse.test.ts` (add a case)

**Interfaces:**
- Consumes: `nearestCatalogItem` (Task 10), `PriceToolCall` (Task 2), `MESSAGE_SOURCE`, `BRAND_SLUGS`
- Produces:
```ts
export interface BrandPerformance { brand: BrandSlug; leads: number; chats: number; won: number; lost: number; winPct: number | null } // winPct = round(won / leads * 100), null when leads = 0
export async function getBrandSummary(p: { startDate?: string; endDate?: string }): Promise<BrandPerformance[]>; // both brands, BRAND_SLUGS order; a two-brand lead counts in both
// GET /api/v1/leads/brand-summary?startDate&endDate → { data: BrandPerformance[] }
getLeadReport(p: { startDate?: string; endDate?: string; brand?: BrandSlug }): Promise<LeadReport>; // every lead block filtered by brand = ANY(leads.brands)
// LeadReport adds: dailyByBrand: { day: string; kertas_supreme: number; imperial_indopack: number }[]   (new leads per WIB day)
export interface QuotedPrice { unitPriceIdr: number; priceUnit: QtyUnit; totalIdr: number; at: string }
export interface LeadDetailExtras { source: { kind: 'ad' | 'direct'; headline: string | null }; poFormSentAt: string | null; closingMinutes: number | null; quotedPrices: (QuotedPrice | null)[] }
export async function getLeadDetailExtras(lead: Lead): Promise<LeadDetailExtras>;
// GET /api/v1/leads/:id → data adds `extras`
// BaileysInboundPayloadSchema adds: referral: { sourceType?: string | null; sourceId?: string | null; headline?: string | null } | null | undefined
```
- Rules:
  - **`source`:** `ad` when the first customer row since the lead began has `metadata.referral.sourceType === 'ad'`; `headline` from the referral. Otherwise `direct`.
  - **`poFormSentAt`:** the newest `po_form` row since the lead began.
  - **`closingMinutes`:** for a won lead, `round((closedAt − (firstContactAt ?? submittedAt)) / 60000)`.
  - **`quotedPrices[i]`:** resolve `lead.items[i]` with `nearestCatalogItem`. On an exact match, take the newest `priceCalls` entry since the lead began with that `productName` and `variantName` and outcome `quote`; otherwise `null`.
- The webhook maps Meta's `messages[].referral` (`source_type`, `source_id`, `headline`) into the payload, and the inbound row stores it as `metadata.referral`.

- [ ] **Step 1: Write the failing tests**

```ts
it('counts a two-brand lead under both brands', ...); // KS won, II lost, one lead with both → KS { leads: 2, won: 1, winPct: 50 }, II { leads: 2, won: 0, lost: 1, winPct: 0 }
it('report filters by brand and buckets new leads per brand per day', ...);
it('search finds an item size and a business name', ...);   // search '35x35' and 'Contoh Minang'
it('reads di_bawah_minimum as a lost reason', () => expect(parseInsights('{"lead_kind":"lead","stage":"lost","lost_reason":"di_bawah_minimum"}').lost_reason).toBe('di_bawah_minimum'));
it('ad source, PO time, closing minutes and the quoted price', ...); // referral headline 'Kertas Supreme cetak logo'; won 18 min after first contact → closingMinutes 18; quotedPrices[0].unitPriceIdr 165000
it('direct source without a referral', ...);
it('maps a click-to-WhatsApp referral into the payload', ...);       // routeInboundBaileysMessage mocked: payload.referral { sourceType: 'ad', headline: '…' }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/leads-brand-report.test.ts tests/lead-detail-extras.test.ts tests/webhooks-referral.test.ts tests/lead-insights-parse.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the whole API suite and tsc. Phase A ends green.**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -4`
Expected: tsc exits 0, and `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Leads by brand, report brand filter, lead detail source, PO time and quoted price"
```

---

## Phase B: Dashboard

Each page task follows the same shape:
- **Types:** `types/api.ts` gets the API types the task consumes, copied field for field from the Phase A task named.
- **API calls:** `lib/api/<area>.ts` calls through `apiFetch`.
- **Mutations:** go through server actions in `actions/<area>Actions.ts`. Each action reads the session user for `staffId` and `staffName` and returns `{ ok: true, … } | { ok: false, error }`.
- **Strings:** every string in `lib/i18n/id.ts` and `en.ts`.
- **Tests:** run with `cd dashboard && npx vitest run <file>`.

### Task 13: Copy, rebrand and scaffold the dashboard

**Files:**
- Create:
  - `dashboard/**`, copied from the git-tracked files of `legacy-dashboard` except `public/icon-*.png` and `.env*`
  - `dashboard/.env.example`, `dashboard/README.md`
  - `dashboard/lib/brands.ts`, `dashboard/lib/format.ts`, `dashboard/components/BrandTag.tsx`
  - `dashboard/vitest.config.ts` (alias `@` → the dashboard root), `dashboard/tests/format.test.ts`
  - `dashboard/public/icon.svg`, `icon-192.png`, `icon-512.png`
- Modify:
  - `package.json`: name `imperial-indopack-dashboard`; `dev` = `next dev -p 40070`; `start` = `next start -p 40070`; add `test` = `vitest run`; add `vitest` to devDependencies
  - `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `app/manifest.ts`, `public/sw.js`
  - `components/layout/Sidebar.tsx`, `lib/i18n/{id,en}.ts`, `lib/api/client.ts` (default URL `http://localhost:50070`)
  - `next.config.ts`, `proxy.ts`, `lib/roles.ts` and `app/(auth)/login/LoginForm.tsx`: comments and copy
- Delete: `app/(dashboard)/master-data/**`, `actions/masterDataActions.ts`, `lib/customerType.ts` and every badge using it, the `customerType.*` and `masterData.*` i18n keys
- Move: `app/(dashboard)/escalations/page.tsx` → `app/(dashboard)/team-queue/page.tsx` (rewritten in Task 20)

**Interfaces:**
- Produces:
```ts
// lib/brands.ts
export type BrandSlug = 'kertas_supreme' | 'imperial_indopack';
export const BRAND_SLUGS: readonly BrandSlug[] = ['kertas_supreme', 'imperial_indopack'];
export const BRAND_TAG: Record<BrandSlug, { labelKey: TKey; background: string; color: string }>; // KS #EAF2DD/#445428, II #F4EBD8/#6E531E
export function brandSlugs(v: unknown): BrandSlug[];      // keeps known slugs, BRAND_SLUGS order
// components/BrandTag.tsx
export function BrandTags({ brands }: { brands: BrandSlug[] }): JSX.Element;
// lib/format.ts
export function formatQty(qty: number, unit: 'rim' | 'pcs', lang: Lang): string;   // '5.000 pcs (10 rim)', '12 rim (6.000 pcs)', '2.700 pcs'
export function formatWait(minutes: number, lang: Lang): string;                    // id: '18 mnt', '1 j 12 mnt', '1 hr 2 j'; en: '18 min', '1 h 12 min', '1 d 2 h'
export function relativeTime(iso: string, now: Date, lang: Lang): string;           // '10 mnt lalu', '1 jam lalu', 'kemarin' (previous WIB day), '3 hari lalu'
```
- **Tailwind:**
  - `colors.brand` = the Global Constraints core tokens plus `page`, `sidebar`, `line`, `ink`, `muted` and `link` from the UI tints
  - `primary` scale: `50 #F5F8F2`, `100 #EAF2DD`, `400 #ADCF6D`, `500 #88B44E`, `600 #6C9442`, `700 #586B34`, `800 #445428`, `900 #252C30`
  - `fontFamily.sans` = `['Open Sans', …]`, and `fontFamily.heading` = `['Montserrat', …]`
- **globals.css:** imports Montserrat 500–800 and Open Sans 400/600/700. Body background `#F2F5EF`, text `#1F2421`; `h1`–`h3` use Montserrat.
- **Inline colours:** every inline Legacy red used as brand, active or primary styling becomes a brand token. Reds stay only on error and destructive states.
- **Sidebar:**
  - **Header:** a 26 px white circle with a `#E2D3B2` border and a gold `#8A6A2A` "S" (Montserrat 800), then `IMPERIAL INDOPACK` (Montserrat 800, `#445428`, 0.04em).
  - **Inbox:** Percakapan `/conversations`; Perlu Tim `/team-queue` with the count badge
  - **Penjualan:** Ringkasan `/summary`; Leads `/leads`
  - **Produk:** Katalog `/catalog`
  - **Sistem:** Nomor WhatsApp (admin), Test Prompt, Aktivitas, Admin (admin), Pengaturan (admin)
- **Icons:**
  - `public/icon.svg` = the same mark on a `#F5F8F2` square.
  - Render the PNGs with the API's sharp: `cd ../api && node --input-type=module -e "import sharp from 'sharp'; for (const s of [192, 512]) await sharp('../dashboard/public/icon.svg').resize(s, s).png().toFile('../dashboard/public/icon-' + s + '.png')"`.
- **Names:**
  - manifest `name` = `Imperial Indopack Dashboard`, `short_name` = `Imperial`, `start_url` = `${BASE_PATH}/team-queue`
  - `sw.js` notifications default to the title `Imperial Indopack`
  - login title `Dashboard Imperial Indopack`
- **`.env.example`:** `AUTH_URL=http://localhost:40070`, `AUTH_TRUST_HOST=true`, `AUTH_SECRET=`, `NEXT_PUBLIC_API_URL=http://localhost:50070`, `NEXT_PUBLIC_BASE_PATH=/app`, `API_SECRET_KEY=`.

- [ ] **Step 1: Copy the tracked files**

```bash
V="/Users/claytonmildy/WidaProject/FDE Projects/legacy-app"
git -C "$V" ls-files legacy-dashboard | grep -vE '^legacy-dashboard/(public/icon-[0-9]+\.png|\.env[^/]*)$' | while read -r f; do
  d="dashboard/${f#legacy-dashboard/}"; mkdir -p "$(dirname "$d")"; cp "$V/$f" "$d"; done
ls dashboard/public; test ! -e dashboard/.env.local && echo "no env copied"
```
Expected: `public` holds only `sw.js`, and `no env copied` prints.

- [ ] **Step 2: Add Vitest and write the failing `tests/format.test.ts`**

```ts
it('formats quantities', () => { expect(formatQty(5000, 'pcs', 'id')).toBe('5.000 pcs (10 rim)'); expect(formatQty(12, 'rim', 'id')).toBe('12 rim (6.000 pcs)'); expect(formatQty(2700, 'pcs', 'id')).toBe('2.700 pcs'); });
it('formats waiting time', () => { expect(formatWait(18, 'id')).toBe('18 mnt'); expect(formatWait(72, 'id')).toBe('1 j 12 mnt'); expect(formatWait(72, 'en')).toBe('1 h 12 min'); expect(formatWait(1560, 'id')).toBe('1 hr 2 j'); });
it('relative time in WIB', () => {
  const now = new Date('2026-11-18T10:00:00+07:00');
  expect(relativeTime('2026-11-18T09:50:00+07:00', now, 'id')).toBe('10 mnt lalu'); expect(relativeTime('2026-11-18T09:00:00+07:00', now, 'id')).toBe('1 jam lalu');
  expect(relativeTime('2026-11-17T15:00:00+07:00', now, 'id')).toBe('kemarin'); expect(relativeTime('2026-11-15T10:00:00+07:00', now, 'id')).toBe('3 hari lalu');
});
it('brand tags and slugs', () => { expect(BRAND_TAG.kertas_supreme.color).toBe('#445428'); expect(BRAND_TAG.imperial_indopack.background).toBe('#F4EBD8'); expect(brandSlugs(['imperial_indopack', 'other_brand', 'kertas_supreme'])).toEqual(['kertas_supreme', 'imperial_indopack']); });
```
Run: `cd dashboard && npm install && npx vitest run tests/format.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement the helpers and the rebrand listed under Files**

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit && grep -rniI "legacy" . --exclude-dir=node_modules --exclude-dir=.next ; npm run build 2>&1 | tail -3`
Expected: tests PASS, tsc exits 0, the grep prints nothing (`package-lock.json` included, since `npm install` rewrote it), and the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A . && git status --short | grep -E "\.env|node_modules|\.next" ; git commit -m "Dashboard copied from the CRM template and rebranded for Imperial Indopack"
```
Expected: the grep prints nothing.

---

### Task 14: Leads and Bukan Lead

**Files:**
- Modify: `dashboard/app/(dashboard)/leads/{page.tsx,LeadsClient.tsx}`, `dashboard/app/(dashboard)/leads/non-leads/{page.tsx,NonLeadsClient.tsx}`, `dashboard/lib/api/leads.ts`, `dashboard/types/api.ts`
- Create: `dashboard/lib/leads/tabs.ts`, `dashboard/lib/leads/items.ts`
- Test: `dashboard/tests/leads.test.ts`

**Interfaces:**
- Consumes:
  - Plan 1 Task 12 lead rows (`brands`, `items`, `name`, `company`) and `?brand=`
  - Task 12 `BrandPerformance` and `GET /leads/brand-summary`
  - the Legacy filters `followUpStatus`, `unreplied`, `kind=non_lead`
- Produces:
```ts
export type LeadTab = 'all' | 'kertas_supreme' | 'imperial_indopack' | 'followup' | 'unreplied';
export function leadsQueryForTab(tab: LeadTab, f: { startDate?: string; endDate?: string; status?: LeadStatus; search?: string; page: number }): LeadsQuery;
// LeadsQuery = the parameter type of getLeads in lib/api/leads.ts, exported under that name, with brand?: BrandSlug added
export function itemLine(item: OrderItem, lang: Lang): string; // 'Supreme 64 gsm 30×30 · 12 rim'; no qty → '<product> <size> · jumlah belum ada'; 'x' in sizes shows as '×'
export async function getBrandSummary(p: { startDate?: string; endDate?: string }): Promise<BrandPerformance[]>;
```
- **Leads.dc.html, top:**
  - filters Dari, Sampai, Status, Cari ("Cari nama, usaha, nomor, barang..."), with Reset and Export Excel (the existing `/api/leads-export` proxy, passing the tab's query)
  - a **Performa per Merek** table with columns Merek, Leads, Chat, Menang, Kalah, % Menang
- **Leads.dc.html, list:**
  - tabs Semua, Kertas Supreme, Imperial Indopack, Perlu Follow-up, Belum Dibalas, and `Bukan Lead [N] →` linking to `/leads/non-leads`
  - columns Mulai Chat, Pelanggan (name above phone), Usaha, Merek (tags), Hot / Cold, Barang & Jumlah (one `itemLine` per item), Status (with the lost reason and who set it, e.g. `AI · tidak ada respon`), Total Order, Chat Terakhir (`relativeTime`, plus `belum dibalas · {formatWait}` when waiting)
  - pagination `Halaman X dari Y · N lead`
- **NonLeads.dc.html:**
  - the intro paragraph (id: "Chat yang bukan pembeli: kurir, supplier, pelamar kerja, dan lainnya. Tidak dihitung di jumlah lead maupun laporan. Bot menyerahkan masing-masing ke tim. Kalau ternyata pembeli, pakai Jadikan Lead."; en: the design's English text)
  - tabs Semua, Kurir, Status Pesanan, Lamaran Kerja, Supplier, Lainnya
  - columns Mulai Chat, Kontak, Jenis, Pesan, Diset Oleh (Otomatis / AI / Staf), Aksi (Jadikan Lead)
- Lost-reason labels gain `di_bawah_minimum` → `Di bawah minimum order`.

- [ ] **Step 1: Write the failing tests**

```ts
it('maps tabs to API filters', () => {
  expect(leadsQueryForTab('kertas_supreme', { page: 1 })).toMatchObject({ brand: 'kertas_supreme' });
  expect(leadsQueryForTab('followup', { page: 1 })).toMatchObject({ followUpStatus: 'needs_followup' });
  expect(leadsQueryForTab('unreplied', { page: 2, search: 'dewi' })).toMatchObject({ unreplied: true, page: 2, search: 'dewi' });
  expect(leadsQueryForTab('all', { page: 1 })).not.toHaveProperty('brand');
});
it('item lines', () => {
  expect(itemLine({ product: 'Supreme 64 gsm', size: '30x30', qty: 12, qty_unit: 'rim' }, 'id')).toBe('Supreme 64 gsm 30×30 · 12 rim');
  expect(itemLine({ product: 'Box ivory', size: '21x14x5' }, 'id')).toBe('Box ivory 21×14×5 · jumlah belum ada');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/leads.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helpers and both pages**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/leads.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Leads with brand tabs and brand performance; Bukan Lead"
```

---

### Task 15: Lead detail

**Files:**
- Modify: `dashboard/app/(dashboard)/leads/[id]/{page.tsx,LeadDetailClient.tsx}`, `dashboard/actions/leadActions.ts` (`updateLead` accepts `brands` and `items`), `dashboard/types/api.ts`
- Create: `dashboard/lib/leads/itemsForm.ts`
- Test: `dashboard/tests/lead-items-form.test.ts`

**Interfaces:**
- Consumes: `GET /leads/:id` with `extras` (Task 12), and `PATCH /leads/:id` with `{ status?, kind?, lostReason?, brands?, items? }` (Plan 1 Task 12)
- Produces:
```ts
export interface ItemRow { product: string; size: string; qty: string; qtyUnit: 'rim' | 'pcs'; design: '' | 'yes' | 'no' }
export function fromItems(items: OrderItem[]): ItemRow[];
export function toItemsPayload(rows: ItemRow[]): OrderItem[]; // drops all-empty rows; qty '2.500' → 2500, '' → omitted; design 'yes' → true, 'no' → false, '' → omitted; text trimmed
```
- **LeadDetail.dc.html, header and controls:**
  - breadcrumb `← Leads / {name}`
  - title `{name} · {company}`, brand tags, Hot / Cold, the phone, and `Buka Percakapan`
  - selects Status (Baru, Dihubungi, Penawaran, Menang, Kalah) and Jenis (Lead, Kurir, Status pesanan, Lamaran kerja, Supplier, Lainnya), saved on change
- **LeadDetail.dc.html, Barang yang diminta:**
  - a table with Produk, Ukuran, Jumlah, Desain, Harga dikutip (`extras.quotedPrices[i]` as `Rp 165.000/rim`, or `—`)
  - `Ubah` turns rows into inputs (Produk, Ukuran, Jumlah + Satuan, Desain), with a brand checkbox pair, `Tambah barang`, `Simpan` and `Batal`
  - Simpan sends `{ items: toItemsPayload(rows), brands }`
- **LeadDetail.dc.html, side boxes:**
  - **Bukti menang / Bukti kalah:** the quoted `outcomeEvidence`, `Pesan pelanggan, dikutip AI · {time} · Lihat pesan ini di percakapan`, and `Salah? Ubah Status di atas; perubahan Anda yang berlaku.`
  - **Info:** Kontak pertama, Sumber (`Iklan · {headline}` or `Chat langsung`), Menang, Lama closing (`formatWait(closingMinutes)`), Form PO (`Terkirim {time}` or `—`), Lead sebelumnya (link or `—`)
  - **Riwayat:** the lead events, e.g. `Baru → Dihubungi`, actor and time, evidence

- [ ] **Step 1: Write the failing tests**

```ts
it('builds the PATCH items from the edit rows', () => expect(toItemsPayload([
  { product: ' Kertas Supreme 64 gsm cetak 1 warna ', size: '30 x 30 cm', qty: '12', qtyUnit: 'rim', design: 'yes' },
  { product: '', size: '', qty: '', qtyUnit: 'rim', design: '' },
  { product: 'Box ivory', size: '21x14x5', qty: '2.500', qtyUnit: 'pcs', design: '' },
])).toEqual([
  { product: 'Kertas Supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', qty: 12, qty_unit: 'rim', has_design: true },
  { product: 'Box ivory', size: '21x14x5', qty: 2500, qty_unit: 'pcs' },
]));
it('round-trips stored items', () => expect(toItemsPayload(fromItems(ITEMS))).toEqual(ITEMS));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/lead-items-form.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helper and the page**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/lead-items-form.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Lead detail: editable items and brands, quoted prices, source, PO, history"
```

---

### Task 16: Ringkasan

**Files:**
- Modify: `dashboard/app/(dashboard)/summary/{page.tsx,SummaryClient.tsx}`, `dashboard/lib/api/leads.ts` (`getLeadReport` takes `brand`)
- Create: `dashboard/lib/summary/series.ts`
- Test: `dashboard/tests/summary-series.test.ts`

**Interfaces:**
- Consumes: `LeadReport` with `dailyByBrand` and `?brand=` (Task 12)
- Produces:
```ts
export interface DaySeries { day: string; bars: { brand: BrandSlug; n: number }[] }
export function brandSeries(rows: LeadReport['dailyByBrand'], brand: BrandSlug | null): DaySeries[]; // both brands, KS first, or only the filtered one
export function seriesMax(s: DaySeries[]): number;                                                  // at least 1, so an empty range never divides by zero
```
- **Summary.dc.html:**
  - **filters:** Dari, Sampai, Merek (Semua merek / Kertas Supreme / Imperial Indopack) and Reset
  - **tiles:** Leads baru (with `{returningLeads} pernah kalah`), Leads dihubungi, Menang (with `= form PO dikirim`), Kalah, Konversi (%), Lama closing ({avgDaysToClose} hari)
  - **Per hari:** grouped bars, Kertas Supreme `#88B44E` and Imperial Indopack `#C49A3C`, with a legend
  - **Tahap leads:** Baru, Dihubungi, Penawaran, Menang, Kalah, with the subtitle "Status saat ini dari leads baru di periode ini"
  - **Alasan kalah:** every reason with a count, labels from Task 14
  - **Belum dibalas:** columns Nama, Nomor, Status, Pesan terakhir, Menunggu (`formatWait`), with "Kondisi saat ini, tidak terpengaruh rentang tanggal"

- [ ] **Step 1: Write the failing tests**

```ts
const ROWS = [{ day: '2026-11-17', kertas_supreme: 3, imperial_indopack: 1 }, { day: '2026-11-18', kertas_supreme: 0, imperial_indopack: 0 }];
it('two bars per day, Kertas Supreme first', () => expect(brandSeries(ROWS, null)[0].bars).toEqual([{ brand: 'kertas_supreme', n: 3 }, { brand: 'imperial_indopack', n: 1 }]));
it('one bar when a brand is filtered', () => expect(brandSeries(ROWS, 'imperial_indopack')[0].bars).toEqual([{ brand: 'imperial_indopack', n: 1 }]));
it('max is never zero', () => expect(seriesMax(brandSeries([ROWS[1]], null))).toBe(1));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/summary-series.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helper and the page**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/summary-series.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Ringkasan with a brand filter and per-brand daily bars"
```

---

### Task 17: Katalog list, Cek harga, price-list files, Import and Hapus dialogs

**Files:**
- Replace: `dashboard/app/(dashboard)/catalog/{page.tsx,CatalogClient.tsx}` (the old client is deleted), `dashboard/lib/api/catalog.ts` (Phase A endpoints only), `dashboard/actions/catalogActions.ts`
- Create:
  - `dashboard/components/catalog/{ProductCard,PriceCheckPanel,PriceListFiles,ImportExcelDialog,DeleteProductDialog}.tsx`
  - `dashboard/lib/catalog/tierTable.ts`
  - `dashboard/app/api/catalog-template/route.ts`, `dashboard/app/api/brand-price-list/[slug]/route.ts` (POST and DELETE)
- Modify: `dashboard/app/api/catalog-import/route.ts`: forwards `dryRun` and `fileName`, plus `staffName` from the session, and returns `{ preview, result? }`
- Delete: `dashboard/app/api/catalog-images/`, `dashboard/app/api/upload-catalog/`, `dashboard/app/api/upload-image/` once nothing imports it, and the `catalog.*` i18n keys for MP, pricelist, UoM, categories and stock
- Test: `dashboard/tests/tier-table.test.ts`

**Interfaces:**
- Consumes: Task 6 list, `CatalogProduct`, active and delete; Task 7 price check and `BrandPriceList`; Task 8 import preview and template
- Produces:
```ts
export interface TierColumn { minQty: number; qtyUnit: 'rim' | 'pcs' }
export function tierColumns(sizes: CatalogProduct['sizes']): TierColumn[];              // distinct (minQty, qtyUnit) over every size, ascending by pcs
export function cellFor(size: CatalogProduct['sizes'][number], col: TierColumn): PriceTier | null;
export function deliveryLabel(size: CatalogProduct['sizes'][number]): 'included' | 'excluded' | 'mixed';
// actions/catalogActions.ts
export async function setProductActiveAction(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }>;
export async function deleteProductAction(id: string): Promise<{ ok: true; sizes: number; tiers: number } | { ok: false; error: string }>;
export async function priceCheckAction(input: { product: string; size: string; qty: number; unit: 'rim' | 'pcs' }): Promise<{ ok: true; text: string; call: PriceToolCall } | { ok: false; error: string }>;
```
- **Catalog.dc.html, header:**
  - actions Import Excel, Export Excel (the existing proxy) and `+ Tambah Produk` (→ `/catalog/new`)
  - brand tabs with counts (`Semua · N`), the search "Cari produk, ukuran, kegunaan...", and a Status select (Semua status / Aktif (ditawarkan bot) / Nonaktif)
- **Catalog.dc.html, "Daftar harga untuk dikirim bot":** one row per brand, either `{fileName} · {date} · Ganti` or `Belum ada file · Unggah` (PDF picker).
- **Catalog.dc.html, active product card:**
  - up to 3 photo thumbnails, or `belum ada foto`
  - the name, brand tag, `Aktif`, the spec line, and `Kegunaan: …`
  - `Ubah` and `Hapus`
  - a tier table: Ukuran | `Mulai {n} {unit}` per `tierColumns` | Ongkir (`Sudah termasuk` / `Belum termasuk`), with `—` for empty cells
- **Catalog.dc.html, inactive product:** collapses to one row: `{name} · {brand} · {n} ukuran · Nonaktif · tidak ditawarkan bot · Ubah`.
- **Cek harga panel:** "Sama persis dengan yang akan dijawab bot"; selects Produk (active products), Ukuran (that product's sizes), Jumlah, Satuan.
- **Cek harga results:**
  - **quote:** `Tingkat {n} {unit}`, `Rp {price}/{unit} × {qty} {unit}`, `Total Rp …`, the delivery text, and `{next} {unit} jadi Rp {next price}/{unit}` when there is a next tier
  - **below_minimum, above_top_tier, not_in_catalog:** the bot's rule in words ("Di bawah {min}: bot menjelaskan minimum.", "Di atas {top}: bot menyerahkan ke tim.", "Tidak ada di katalog: bot menyerahkan ke tim.")
- **ImportExcel.dc.html:**
  - step 1, the template link `Unduh template-katalog.xlsx` plus the column list
  - step 2, the file picker showing `name · size · N baris`
  - picking a file runs the dry run
  - step 3, the counts `produk baru`, `harga diubah`, `baris salah, dilewati` and each error as `Baris N` + message
  - the note "Produk yang tidak ada di file tidak berubah. Bot memakai harga baru begitu diterapkan."
  - footer Batal / `Terapkan {validRows} baris`: posts the same file without `dryRun`, then refreshes
- **DeleteProduct.dc.html:**
  - title `Hapus "{name}"?` and `{sizes} ukuran dan {tiers} tingkat harga ikut terhapus. Bot langsung berhenti menawarkannya. Lead yang pernah meminta produk ini tetap ada.`
  - the `Nonaktifkan saja` link (deactivates, then closes)
  - the ack checkbox copy from the design; `Hapus permanen` stays disabled until it is ticked

- [ ] **Step 1: Write the failing tests**

```ts
const SIZES = [S('21 x 7 x 5 cm', [T(5, 'rim', 1500, true), T(10, 'rim', 1300, true)]), S('21 x 14 x 5 cm', [T(5, 'rim', 1900, true), T(20, 'rim', 1200, false)])];
it('columns are the union of tier minimums, ascending', () => expect(tierColumns(SIZES)).toEqual([{ minQty: 5, qtyUnit: 'rim' }, { minQty: 10, qtyUnit: 'rim' }, { minQty: 20, qtyUnit: 'rim' }]));
it('a missing cell is null', () => expect(cellFor(SIZES[0], { minQty: 20, qtyUnit: 'rim' })).toBeNull());
it('delivery label', () => { expect(deliveryLabel(SIZES[0])).toBe('included'); expect(deliveryLabel(SIZES[1])).toBe('mixed'); });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/tier-table.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helper, the page, the dialogs and the route handlers**

- [ ] **Step 4: Run the tests, tsc and a leftovers grep**

Run: `npx vitest run tests/tier-table.test.ts && npx tsc --noEmit && grep -rnE "mpPrice|isiCtn|uomPrice|pricelist|masterData" app components lib actions types`
Expected: PASS, tsc exits 0, and the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Katalog by brand with tier tables, price check, price lists, import preview, delete"
```

---

### Task 18: Tambah Produk and Ubah Produk

**Files:**
- Create:
  - `dashboard/app/(dashboard)/catalog/new/page.tsx`, `dashboard/app/(dashboard)/catalog/[id]/page.tsx`
  - `dashboard/components/catalog/{ProductForm,ProductHistory}.tsx`
  - `dashboard/lib/catalog/productForm.ts`
  - `dashboard/app/api/reference-images/[productId]/route.ts` (multipart proxy to Plan 1's `POST /products/:id/reference-images`)
- Modify: `dashboard/actions/catalogActions.ts`, `dashboard/lib/api/catalog.ts`
- Test: `dashboard/tests/product-form.test.ts`

**Interfaces:**
- Consumes: Task 6 `ProductDraft`, `CatalogProduct`, `CatalogChange`, `CatalogHistoryEntry` and the create/update routes; Task 7 `ProductPreview`; Plan 1's reference-image routes (409 on a 4th photo)
- Produces:
```ts
export interface TierRow { minQty: string; qtyUnit: 'rim' | 'pcs'; price: string; priceUnit: 'rim' | 'pcs'; includesDelivery: boolean }
export interface SizeRow { id?: string; size: string; tiers: TierRow[]; copiedFrom?: string }
export interface ProductFormState { brand: BrandSlug; name: string; gsm: string; print: string; finishing: string; use: string; isActive: boolean; sizes: SizeRow[] }
export function emptyForm(brand: BrandSlug): ProductFormState;               // one size with one tier: 5 rim; price unit rim for kertas_supreme, pcs for imperial_indopack
export function fromCatalogProduct(p: CatalogProduct): ProductFormState;
export function parseRupiah(s: string): number | null;                       // '185.000' → 185000, 'Rp 1.450' → 1450, '1450' → 1450, '' / 'abc' / '0' → null
export function toDraft(f: ProductFormState): ProductDraft;                  // parseRupiah for prices, parseInt for quantities (null when empty), '' → null for gsm/print/finishing
export function copyTiersToOtherSizes(f: ProductFormState, from: number): ProductFormState; // every other size gets the source's rows; a price stays only where that size had the same (minQty, qtyUnit); copiedFrom = source size
export function describeChange(c: CatalogChange, t: TFn): string;           // tier_price → 'Harga 21 × 14 × 5 cm, mulai 10 rim: Rp 1.500 → Rp 1.450/pcs'
// actions/catalogActions.ts
export async function saveProductAction(id: string | null, draft: ProductDraft): Promise<{ ok: true; id: string } | { ok: false; error: 'VALIDATION_ERROR' | 'NAME_TAKEN' | 'FAILED'; details?: ProductInputError[] }>;
export async function previewProductAction(id: string | null, draft: ProductDraft): Promise<ProductPreview>;
export async function deleteReferenceImageAction(id: string): Promise<{ ok: boolean }>;
```
- **ProductCreate.dc.html, section 1 · Produk:**
  - Merek as two radio cards: Kertas Supreme ("Kertas bungkus, greaseproof, paper bag. Harga per rim.") and Imperial Indopack ("Box karton ivory dan kraft. Harga per pcs.")
  - Nama produk, with the hint "Nama ini yang disebut bot ke pelanggan."
  - Gramasi; Cetak select (1 warna, Polos, 2 warna, Full color); Finishing select (Laminasi food grade, Non laminasi)
  - Kegunaan, with the hint "Bot memakai ini untuk merekomendasikan produk ke pelanggan yang belum tahu mau pakai apa."
  - the checkbox `Tawarkan lewat bot · nonaktifkan untuk menyembunyikan dari bot tanpa menghapus`
- **ProductCreate.dc.html, section 2 · Ukuran & harga:**
  - the subtitle "1 rim = 500 lembar / pcs · bot memakai tingkat tertinggi yang tercapai"
  - per size: Ukuran, `Salin tingkat ke ukuran lain`, `Hapus ukuran`
  - tier rows: Mulai jumlah, Satuan, Harga (Rp), Per, Ongkir `Termasuk`, ✕; then `+ Tambah tingkat` and `+ Tambah ukuran`
  - a copied size shows `Tingkat disalin dari {size} · lengkapi harganya`, and an empty price shows `Isi harga untuk mulai {n} {unit}`
- **ProductCreate.dc.html, section 3 · Foto referensi:**
  - the subtitle "Maksimal 3. Dikirim bot ke pelanggan yang belum punya desain. Urutan = urutan kirim."
  - each photo as `{file} {n} · Hapus`, and `Unggah foto` (JPG/PNG, at most 5 MB, refused client-side)
  - on the create page, picked photos wait in memory and upload after the product saves
- **ProductCreate.dc.html, right rail:**
  - **Yang dilihat bot:** `preview.botText` in monospace, plus `Ukuran {s} belum muncul karena harganya belum lengkap.` per hidden size; the preview is requested 400 ms after the last edit
  - **Sebelum simpan:** ✓ Merek dan nama produk, ✓ Kegunaan diisi, per size ✓ `{size}: {n} tingkat, naik berurutan` or ✕ with the error, ○ `Foto referensi: {n} dari 3 (opsional)`
  - `Simpan Produk` stays disabled while there are errors
  - Batal returns to `/catalog`; a save goes to `/catalog`
- **ProductEdit.dc.html, header and banner:**
  - the header status badge `Aktif` / `Nonaktif`
  - the banner `{n} perubahan belum disimpan` with `describeChange` lines and "Bot memakai harga baru setelah disimpan."
  - a changed size is marked `Diubah`, and a changed price shows `Sebelumnya Rp {old}`
- **ProductEdit.dc.html, sizes:**
  - minimums are read-only text (`5 rim (2.500 pcs)`) until `Ubah ukuran` makes that size editable as on the create page
  - `+ Tambah tingkat {next}` adds the next tier (double the top tier's quantity, same units)
  - no photos shows "Belum ada foto. Saat pelanggan belum punya desain, bot akan bilang tim yang mengirim contoh, lalu menyerahkan ke tim."
- **ProductEdit.dc.html, lower cards:**
  - **Berhenti menawarkan produk ini:** the design's text, `Nonaktifkan` / `Aktifkan`, and `Hapus produk` (opens the Task 17 dialog)
  - **Riwayat perubahan:** each change via `describeChange`, with `{actorName} · {date}`; `created` via import shows `Dibuat dari Import Excel ({fileName})`
  - **Dipakai di percakapan:** `Dikutip bot {n}× dalam 30 hari · {m} lead menang` and `Lihat leads yang meminta produk ini →` (→ `/leads?search={name}`)

- [ ] **Step 1: Write the failing tests**

```ts
it.each([['185.000', 185000], ['Rp 1.450', 1450], ['1450', 1450], ['', null], ['abc', null], ['0', null]])('parseRupiah(%s)', (s, n) => expect(parseRupiah(s)).toBe(n));
it('copies tiers, keeping matching prices and emptying the rest', () => {
  const f = copyTiersToOtherSizes(FORM_30_THREE_TIERS_AND_35_WITH_5RIM_245000, 0);
  expect(f.sizes[1].tiers.map((t) => [t.minQty, t.price])).toEqual([['5', '245.000'], ['10', ''], ['20', '']]);
  expect(f.sizes[1].copiedFrom).toBe('30 x 30 cm');
});
it('draft has null for empty prices and quantities', () => expect(toDraft(FORM_WITH_EMPTY_PRICE).sizes[1].tiers[0]).toMatchObject({ minQty: 5, priceIdr: null }));
it('describes a price change', () => expect(describeChange({ kind: 'tier_price', size: '21 x 14 x 5 cm', minQty: 10, qtyUnit: 'rim', priceUnit: 'pcs', from: 1500, to: 1450 }, T_ID))
  .toBe('Harga 21 × 14 × 5 cm, mulai 10 rim: Rp 1.500 → Rp 1.450/pcs'));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/product-form.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helpers, `ProductForm`, both pages and the photo proxy**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/product-form.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Tambah and Ubah Produk: sizes, tiers, copy tiers, photos, bot preview, history"
```

---

### Task 19: Percakapan

**Files:**
- Modify:
  - `dashboard/app/(dashboard)/conversations/{page.tsx,ConversationsClient.tsx}`
  - `dashboard/app/(dashboard)/conversations/[id]/{page.tsx,ConversationDetailClient.tsx}`: keep its polling, bubbles and attachment upload; drop the buyer-type parts
  - `dashboard/actions/conversationActions.ts`, `dashboard/lib/api/conversations.ts`
- Create: `dashboard/components/conversations/{InboxList,ChatPane,OrderPanel,QuickSendBar}.tsx`, `dashboard/lib/conversations/labels.ts`
- Test: `dashboard/tests/conversation-labels.test.ts`

**Interfaces:**
- Consumes: Task 9 `ConversationListRow` and the counts; Task 10 `OrderPanel` and team notes; Task 11 quick-send; Task 2 `PriceToolCall` in `metadata.priceCalls`; the existing resolve and return-to-AI actions
- Produces:
```ts
export function rowStatus(r: ConversationListRow): { key: TKey; vars?: TVars }; // team → 'conversations.status.team' {category label}; poFormSentAt → '…poSent'; active → '…ai'; resolved → '…resolved'
export function toolLine(c: PriceToolCall, lang: Lang): string;                 // 'hitung_harga · 22×22×7 → tidak ada di katalog' | 'hitung_harga · 30×30 · 12 rim → Rp 165.000/rim, total Rp 1.980.000'
export function quickSendErrorKey(e: QuickSendError): TKey;
// actions/conversationActions.ts
export async function quickSendAction(conversationId: string, action: QuickSendAction): Promise<{ ok: true } | { ok: false; error: QuickSendError | 'FAILED' }>;
export async function saveTeamNotesAction(conversationId: string, text: string): Promise<{ ok: true; notes: TeamNotes } | { ok: false }>;
```
- **Conversations.dc.html, layout:** three columns, list, chat and panel. `/conversations` shows the list with an empty chat ("Pilih percakapan"); `/conversations/[id]` shows all three.
- **List column:**
  - search "Cari nama, usaha, nomor...", and view tabs `Semua`, `Perlu Tim · {counts.team}`, `AI`, `Selesai`
  - rows show `{name} · {business}` with the time, the last message (prefixed `Bot:` for the bot), brand tags, and the `rowStatus` line
- **Chat column, header and banner:**
  - the header `{name} · {business}`, `{phone} · Lihat lead`, and a status pill: `Ditangani tim · {assignedAgent}`, `Perlu tim`, `AI menangani` or `Selesai`
  - while `escalated` or `needs_human` with a reason, the banner `Bot menyerahkan ke tim, {time} · Alasan: {escalationReason}`
- **Chat column, thread:** customer bubbles; bot bubbles labelled `Bot`; staff bubbles labelled `{senderName} · tim`; a `toolLine` row before each bot reply that carries `priceCalls`; system notes in grey.
- **Chat column, actions:**
  - the quick-send bar `Kirim daftar harga`, `Kirim foto referensi`, `Kirim form PO`
  - **price list:** with exactly one profile brand it sends that brand; otherwise a menu offers Kertas Supreme, Imperial Indopack and Keduanya
  - **photos:** a product picker that defaults to `nearest[0].productId`
  - **PO:** a confirm dialog showing the message text from `GET /settings/po-form-url`
  - errors show `quickSendErrorKey`
  - the reply box `Membalas sebagai {session name}` with `Kirim`; footer `← Kembalikan ke AI` and `Selesaikan` (the existing actions)
- **Panel column:**
  - `Detail pesanan` with `{detailsFilled} dari 6 terisi`, brand tags, Hot / Cold and the lead status
  - six rows with ✓ or ○: Nama, Usaha, Model, Ukuran (+ `di luar katalog`), Jumlah, Desain (+ `· file dikirim {time}`)
  - `File dari pelanggan` with `Unduh` links (`NEXT_PUBLIC_API_URL + url`)
  - `Terdekat di katalog` per nearest match: `{product} · {size}`, `Mulai {tier} Rp {price}/{unit}, {delivery}`, and `Ukuran beda, jadi tetap dihitung tim.` when not exact
  - `Catatan tim`, saved on blur, with `Disimpan {time} · {by}`

- [ ] **Step 1: Write the failing tests**

```ts
it('labels a team row with its category', () => expect(rowStatus(ROW({ status: 'escalated', handoffCategory: 'harga_custom' }))).toEqual({ key: 'conversations.status.team', vars: { category: expect.any(String) } }));
it('a sent PO form wins over AI', () => expect(rowStatus(ROW({ status: 'active', poFormSentAt: '2026-11-17T02:20:00Z' })).key).toBe('conversations.status.poSent'));
it('tool line for not_in_catalog', () => expect(toolLine(CALL({ outcome: 'not_in_catalog', input: { size: '22x22x7' } }), 'id')).toBe('hitung_harga · 22×22×7 → tidak ada di katalog'));
it('tool line for a quote', () => expect(toolLine(QUOTE_CALL_12_RIM, 'id')).toBe('hitung_harga · 30×30 · 12 rim → Rp 165.000/rim, total Rp 1.980.000'));
it('every quick-send error has copy', () => ['NOT_FOUND', 'BRAND_UNKNOWN', 'NO_PRICE_LIST', 'NO_REFERENCE_PHOTOS', 'PO_FORM_PLACEHOLDER'].forEach((e) => expect(id[quickSendErrorKey(e as QuickSendError)]).toBeTruthy()));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/conversation-labels.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/conversation-labels.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Percakapan: inbox views, handoff banner, quick-send, order panel, team notes"
```

---

### Task 20: Perlu Tim

**Files:**
- Replace: `dashboard/app/(dashboard)/team-queue/page.tsx` (+ `TeamQueueClient.tsx`)
- Create: `dashboard/lib/teamQueue.ts`, `dashboard/lib/api/teamQueue.ts`, `dashboard/actions/teamQueueActions.ts` (`getTeamQueueCount(): Promise<number>`, used by the Sidebar in place of `getEscalationCount`)
- Delete: `dashboard/actions/escalationActions.ts`, `dashboard/lib/api/escalations.ts`
- Test: `dashboard/tests/team-queue.test.ts`

**Interfaces:**
- Consumes: Task 9 `TeamQueue` and `GET /team-queue?assignedTo=`
- Produces:
```ts
export const DESIGNED_GROUPS: HandoffCategory[] = ['harga_custom', 'desain_masuk', 'pesanan_besar', 'minta_orang', 'komplain'];
export function visibleGroups(q: TeamQueue): TeamQueue['groups'];           // the five designed groups always, bukan_pembeli and lainnya only when non-empty
export function detailsBadge(i: TeamQueueItem, t: TFn): string;             // '6/6 detail' | '5/6 · desain?' (first missing key's short label + '?')
export const CATEGORY_COPY: Record<HandoffCategory, { title: TKey; desc: TKey }>;
```
- **Category descriptions, from TeamQueue.dc.html:**
  - Harga custom: "Ukuran, model atau cetak di luar katalog. Bot sudah mengumpulkan detailnya."
  - Desain masuk: "Pelanggan mengirim logo atau file. Tim cek dan siapkan desain."
  - Pesanan besar: "Di atas tingkat harga teratas. Harga dinegosiasi tim."
  - Minta bicara dengan orang; Komplain; Bukan pembeli; Lainnya
- **TeamQueue.dc.html, top:**
  - tabs `Semua tim` / `Ditangani saya` (`assignedTo` = session name)
  - the summary `{waitingCount} menunggu tim · Terlama {formatWait} · Pengingat dikirim ke tim bila belum dibalas {reminderMinutes} menit.`
- **TeamQueue.dc.html, groups:**
  - each group: title with count, description, then rows
  - each row: name above business, brand tags, `itemsSummary`, `detailsBadge`, `formatWait(now − waitingSince)`, and `assignedAgent` or `Belum diambil`; a click opens `/conversations/{id}`
  - an empty group shows `Tidak ada`

- [ ] **Step 1: Write the failing tests**

```ts
it('always shows the five designed groups, others only when non-empty', () =>
  expect(visibleGroups(QUEUE_WITH_ONE_LAINNYA).map((g) => g.category)).toEqual([...DESIGNED_GROUPS, 'lainnya']));
it('details badge', () => { expect(detailsBadge(ITEM({ detailsFilled: 6, missing: [] }), T_ID)).toBe('6/6 detail'); expect(detailsBadge(ITEM({ detailsFilled: 5, missing: ['design'] }), T_ID)).toBe('5/6 · desain?'); });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/team-queue.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the page and the sidebar badge**

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/team-queue.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Perlu Tim queue grouped by handoff reason with wait time and assignee"
```

---

### Task 21: Pengaturan, and copy on the system pages

**Files:**
- Modify:
  - `dashboard/app/(dashboard)/settings/{page.tsx,SettingsClient.tsx,LeadSettingsClient.tsx,PromptSettingsClient.tsx,AiToggleClient.tsx,ChakraSyncClient.tsx}`
  - `dashboard/actions/settingsActions.ts`, `dashboard/lib/api/settings.ts`
  - `dashboard/app/(dashboard)/test-prompt/TestPromptClient.tsx` (sample messages)
- Create: `dashboard/app/(dashboard)/settings/{BotSettingsClient,OrderingSettingsClient,TeamSettingsClient,WhatsAppStatusClient,GoLiveBanner}.tsx`, `dashboard/lib/settings.ts`
- Test: `dashboard/tests/settings.test.ts`

**Interfaces:**
- Consumes:
  - Task 4 `BotSettings`, `GET|PATCH /settings/bot`, `GET /settings/po-form-url` (`url`, `isPlaceholder`, `message`)
  - Plan 1 Task 12 `PATCH /settings/po-form-url` and `GET|PATCH /settings/lead-reopen-months`
  - `GET|PATCH /settings/lead-silence-days`
  - Task 5 `WhatsAppStatus`, `GoLiveIssue`; Task 7 `BrandPriceList[]`
- Produces:
```ts
export function validatePoUrl(url: string): 'ok' | 'not_https' | 'invalid'; // https:// with a host → ok; http:// → not_https; anything else → invalid
export function minOrderHint(pcs: number, lang: Lang): string;              // 2500 → 'pcs (5 rim)'; 1200 → 'pcs'
export function sectionLabelKey(name: string): TKey | string;               // Identity→Identitas, Mission→Misi, Tone→Nada, Brands→Merek, Order Details→Detail pesanan,
                                                                            // Recommendations→Rekomendasi, Pricing→Harga, Design→Desain, PO Form→Form PO, Rules→Aturan, Escalation→Serahkan ke tim; unknown → the name
export async function saveBotSettingsAction(patch: Partial<BotSettings>): Promise<{ ok: true; settings: BotSettings } | { ok: false; error: 'forbidden' | 'invalid' | 'failed' }>;
export async function savePoFormUrlAction(url: string): Promise<{ ok: boolean; error?: 'forbidden' | 'not_https' | 'invalid' | 'failed' }>;
export async function saveReopenMonthsAction(months: number): Promise<{ ok: boolean; error?: string }>;
```
- **Settings.dc.html, page frame:**
  - the header `Pengaturan` with `Hanya admin yang bisa mengubah`
  - `GoLiveBanner`: `{n} hal belum siap untuk go-live` with one line per issue: `Link form PO masih contoh`, `Nomor WhatsApp belum terhubung`, `Katalog masih kosong`, `Daftar harga {brand} belum diunggah`
  - an in-page nav: Bot · Pemesanan & harga · Leads · Tim & notifikasi · WhatsApp · Instruksi bot · Profil saya
- **Bot section:** the AI toggle (existing); Nama bot with "Sementara. Klien belum memilih nama." while `Admin`; `Menyebut diri dari`; `Sapaan pertama` with "{merek} diganti otomatis. Bot tetap menyesuaikan dengan pesan pelanggan, termasuk teks bawaan iklan."; Simpan.
- **Pemesanan & harga section:**
  - the PO link input with Simpan, validated by `validatePoUrl` before sending
  - the hint `Masih link contoh.` when `isPlaceholder`, then "Bot mengirim link ini saat pelanggan setuju harga. Harus diawali https://"
  - `Pesan yang dikirim bersama link` showing `message`
  - Minimum order (bila produk tidak punya tingkat), with `minOrderHint`
  - `Daftar harga per merek: {brand}: terunggah | belum ada · Atur di Katalog` (→ `/catalog`)
- **Leads section:** reopen months (1–12) with "Banyak pelanggan pesan ulang tiap 3 bulan. Kembali sebelum itu: lead lama dibuka lagi.", silence days with "Dihitung dari pesan terakhir kita (bot atau tim). Alasan: tidak ada respon.", and Simpan.
- **Tim & notifikasi section:** reminder minutes (5–1440); browser notifications (the existing `NotificationToggle`); `Diserahkan ke tim bila` listing the seven category titles from Task 20.
- **WhatsApp section:**
  - `Belum terhubung` or `Terhubung · {transport} · {numberCount} nomor`, with "Satu nomor untuk Kertas Supreme dan Imperial Indopack."
  - `Hubungkan nomor` (→ `/numbers`)
  - sync minutes with "Agar bot tahu apa yang sudah dibalas tim langsung dari HP, dan tidak membalas di atasnya.", shown only for `chakra`, plus the existing `ChakraSyncClient`
- **Instruksi bot section:** "Bagian-bagian instruksi yang dibaca bot. Ubah teksnya bila aturan bisnis berubah." with `Coba di Test Prompt →`, and each section labelled by `sectionLabelKey` with `Ubah` (the existing editor).
- **Profil saya section:** Nama, Bahasa dashboard (existing), and change password (existing).
- **System pages:** Nomor WhatsApp, Test Prompt, Aktivitas and Admin keep their behaviour. Their copy is checked for Legacy-era business text (hardware, buyer type, showroom). Test Prompt's sample messages become `berapa harga kertas supreme?`, `mau box ivory 20x20x7,5 5000 pcs`, `saya jualan nasi padang, cocoknya kemasan apa?`.

- [ ] **Step 1: Write the failing tests**

```ts
it('validates the PO link', () => { expect(validatePoUrl('https://forms.gle/abc')).toBe('ok'); expect(validatePoUrl('http://forms.gle/abc')).toBe('not_https'); expect(validatePoUrl('forms.gle')).toBe('invalid'); expect(validatePoUrl('https://')).toBe('invalid'); });
it('minimum hint', () => { expect(minOrderHint(2500, 'id')).toBe('pcs (5 rim)'); expect(minOrderHint(1200, 'id')).toBe('pcs'); });
it('section labels', () => { expect(id[sectionLabelKey('Escalation')]).toBe('Serahkan ke tim'); expect(sectionLabelKey('Custom')).toBe('Custom'); });
```
`sectionLabelKey` returns either a `TKey` or the raw name. Type it `TKey | string`, and render it with `t(key)` only when the key is in `id`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run all dashboard tests, tsc and the build. Phase B ends green.**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -3`
Expected: PASS, tsc exits 0, and the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A . && git commit -m "Pengaturan: bot identity, PO link, minimum, leads, team, WhatsApp status, go-live banner"
```

---

## Phase C: Proving it works

### Task 22: Static verification

**Files:** none (fix whatever the checks find, in the task that owns that file's area).

- [ ] **Step 1: API**

Run: `cd api && npx tsc --noEmit && npx vitest run 2>&1 | tail -4`
Expected: tsc exits 0, and `0 failed`.

- [ ] **Step 2: Dashboard**

Run: `cd dashboard && npx tsc --noEmit && npx vitest run && npm run build 2>&1 | tail -3`
Expected: all exit 0.

- [ ] **Step 3: Leftovers**

```bash
grep -rniI "legacy" api/src api/scripts dashboard --exclude-dir=node_modules --exclude-dir=.next | grep -viE "ported from|porting"
grep -rniI "legacy" api/tests | grep -vE "not\.toMatch|rejects|drops|ignores|unknown brand"
grep -rnE "customerType|customer_type|mpPrice|isiCtn|pricelist|reseller|end_user|master-data|escalationActions" dashboard/app dashboard/components dashboard/lib dashboard/actions dashboard/types
ls dashboard/public
```
Expected: all three greps print nothing. A hit from the second is acceptable only where the test asserts that the word is absent or rejected. `ls` prints `icon-192.png icon-512.png icon.svg sw.js`.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "Static checks clean"
```
Skip the commit when nothing changed.

---

### Task 23: Conversation QA harness

**Files:**
- Create:
  - `api/scripts/qa/start-api.ts`: applies the QA env overlay, then imports `../../src/index.js`
  - `api/scripts/qa/setup.ts`: creates, migrates, resets and seeds `imperial_indopack_qa`
  - `api/scripts/qa/fixtures.ts`: the catalog rows plus generated files in `scripts/qa/fixtures/files/`
  - `api/scripts/qa/lib.ts`, `api/scripts/qa/scenarios.ts`, `api/scripts/qa/run.ts`
  - `api/scripts/qa/say.ts`: `say.ts [--base <url>] [--log <path>] <phone> <text>` posts one customer message (phone number id `local-phone-70`) and prints the captured replies; defaults `http://localhost:50070` and `logs/whatsapp-capture.jsonl`; used by the smoke checklist
- Modify:
  - `api/package.json`: `qa:setup`, `qa:api`, `qa:run`, `qa:say`
  - `api/src/services/leadInsights.ts`: `LeadInsightsPassOptions.quietMs?: number`, default `QUIET_MS`
- Test: `api/tests/qa-lib.test.ts` (pure)
- Output: `docs/qa/conversation-qa-report.md` (committed; synthetic data only)

**Interfaces:**
- Consumes: `readCaptured`, `CapturedMessage` (Task 1); `runLeadInsightsPass`, `closeSilentLeads`, `importCatalogFromXlsx`, `setPoFormUrl`, `setBrandPriceList`, `addReferenceImage`, `poFormMessage`, `writesEnglish`, `getLeadDetailExtras` (earlier tasks)
- Produces:
```ts
// lib.ts
export function inboundPayload(m: { from: string; id: string; phoneNumberId: string; text?: string; image?: { mediaId: string; caption?: string }; referral?: { headline: string }; at?: Date }): unknown; // Meta webhook body
export async function postInbound(baseUrl: string, body: unknown): Promise<void>;            // POST {baseUrl}/webhooks/whatsapp, expects 200
export function settled(msgs: { at: string; kind: string }[], nowMs: number, settleMs: number): boolean; // true when a text has arrived and the newest message is at least settleMs old
// (a price-list document goes out before the model answers, so a document alone never settles a turn)
export async function waitForTurn(o: { logPath: string; to: string; afterId: string | null; settleMs: number; timeoutMs: number }): Promise<CapturedMessage[]>; // [] on timeout
export const PRICE_RE: RegExp;                                                               // /Rp\s?\d{1,3}(\.\d{3})+/
export interface Check { name: string; ok: boolean; detail?: string }
// scenarios.ts
export interface ScenarioCtx { customer: string; say(text: string, o?: { referral?: string }): Promise<CapturedMessage[]>; sendImage(mediaId: string, caption?: string): Promise<CapturedMessage[]>;
  sayExpectingSilence(text: string): Promise<CapturedMessage[]>; leadPass(): Promise<void>; backdate(days: number): Promise<void>; silenceSweep(): Promise<void>;
  lead(): Promise<Lead | null>; leads(): Promise<Lead[]>; conversation(): Promise<Conversation>; profile(): Promise<Record<string, unknown>>; lastReplyRow(): Promise<Message | null> }
export interface Scenario { id: string; title: string; run(ctx: ScenarioCtx): Promise<Check[]> }
export const SCENARIOS: Scenario[];
```
- **QA env overlay (`start-api.ts`):**
  - `DATABASE_URL=$QA_DATABASE_URL`, which must end in `_qa` and must not match `/legacy/i`, or the script exits 1
  - `PORT=50071`, `NODE_ENV=development`, `WHATSAPP_TRANSPORT=capture`, `SKIP_HMAC_IN_DEV=true`, `USE_CLAUDE_CLI=true`
  - `LEAD_INSIGHTS_INTERVAL_MS=0`, `CHAKRA_SYNC_INTERVAL_MS=0`, `ESCALATION_NUDGE_AFTER_MS=0`, `CACHE_WARMUP_INTERVAL_MS=0`
  - `TYPING_DEBOUNCE_MS=2000`, `TYPING_DEBOUNCE_FIRST_MS=2000`, `PHOTO_DEBOUNCE_MS=2000`
  - `CAPTURE_LOG_PATH=logs/qa-capture.jsonl`, `DASHBOARD_UPSTREAM=`
  - `QA_DATABASE_URL` is added to `api/.env` with the Plan 1 Task 0 `sed` pattern, pointed at `imperial_indopack_qa`.
- **Setup (`npm run qa:setup`):** creates the database if missing, runs migrations, then:
  - truncates the conversational tables: contacts, contact_profiles, conversations, messages, leads, lead_events, lead_orders, conversation_reads, catalog_audit
  - deletes products and brands' files
  - runs `seed-local` logic
  - imports the fixture catalog with `importCatalogFromXlsx`
  - sets both price lists: the generated PDFs named `Daftar Harga Kertas Supreme (QA).pdf` and `Daftar Harga Imperial Indopack (QA).pdf`
  - adds 2 reference photos to the Kertas Supreme 64 gsm product, and none to any box
  - `setPoFormUrl('https://forms.gle/qa-imperial-form')`, and default bot settings
  - generates `logo.png` and the photo PNGs with sharp
- **Fixture catalog** (one template row per tier; every tier `Termasuk Ongkir` = `tidak` for Kertas Supreme and Greaseproof, `ya` for boxes):

| Merek | Produk | Ukuran | Tiers (min rim → price / unit) |
|---|---|---|---|
| Kertas Supreme | Kertas Supreme 64 gsm cetak 1 warna | 30 x 30 cm | 5 → 185.000/rim, 10 → 165.000/rim, 20 → 160.000/rim |
| Kertas Supreme | Kertas Supreme 64 gsm cetak 1 warna | 35 x 35 cm | 5 → 245.000/rim, 10 → 217.500/rim, 20 → 207.000/rim |
| Kertas Supreme | Greaseproof 40 gsm polos | 30 x 30 cm | 5 → 150.000/rim |
| Imperial Indopack | Box Ivory 270 gsm cetak full color | 21 x 14 x 5 cm | 5 → 1.900/pcs, 10 → 1.500/pcs |
| Imperial Indopack | Box Ivory 310 gsm cetak full color | 20 x 20 x 7,5 cm | 5 → 2.000/pcs, 10 → 1.800/pcs, 20 → 1.500/pcs |

- **The run (`npm run qa:run [-- --only <id>]`):**
  - refuses unless `GET http://localhost:50071/api/v1/settings/whatsapp-status` (with `SEED_API_KEY`) reports `transport: 'capture'`
  - gives each scenario a fresh customer `62812000070NN`
  - `say` posts a payload, then `waitForTurn` with `settleMs` 8000 and `timeoutMs` 240000
  - `sayExpectingSilence` waits a fixed 90 s and returns what arrived
  - `leadPass` runs `runLeadInsightsPass(50, { conversationIds: [id], ignoreWatermark: true, quietMs: 0 })` in-process against the QA DB
  - `backdate(d)` moves this contact's message, lead and conversation timestamps back `d` days
  - `silenceSweep` runs `closeSilentLeads(30, { contactIds: [id] })`
  - writes the report; the exit code is 1 when any check fails
- **Report:** date, git SHA, the mode (`USE_CLAUDE_CLI`), a summary table (id | title | result | failed checks), then each scenario's transcript (`> customer`, `Bot: …`, `[dokumen] file`, `[foto] path`) and its final DB state (lead status, kind, brands, items; conversation status and category).

| id | Customer steps | Checks (all must hold) |
|---|---|---|
| `ad_default_empty_profile` | `berapa harga kertas supreme?` with referral headline `Kertas Supreme cetak logo` | one document named `Daftar Harga Kertas Supreme (QA).pdf`; no Imperial document; no reply text matches `PRICE_RE`; the reply contains `?`; `getLeadDetailExtras` source `ad` |
| `unsure_recommendation` | `kak saya jualan nasi padang, cocoknya pakai kemasan apa ya?` | a reply matches `/kertas supreme\|greaseproof/i`; none matches `PRICE_RE` |
| `full_order_quote` | `halo kak saya Budi dari RM Siang Contoh`; then `mau kertas supreme 64 gsm cetak 1 warna 30x30, 12 rim, logo sudah ada` | a reply contains `Rp 165.000` and `Rp 1.980.000` and mentions `Rp 160.000`; the last reply row's `metadata.priceCalls[0].outcome` is `quote`; after `leadPass`, lead brands include `kertas_supreme` and an item has `qty` 12, `qty_unit` `rim` |
| `between_tiers` | `mau box ivory 310 gsm 20x20x7,5 cm 8 rim` | `Rp 2.000` and `Rp 8.000.000`; mentions `Rp 1.800` |
| `below_minimum` | `kertas supreme 64 gsm 30x30 3 rim berapa kak?` | a reply matches `/minim/i` and `5 rim`; no `Rp 555.000`; `priceCalls[0].outcome` is `below_minimum`; conversation status is not `escalated` |
| `above_top_tier` | `box ivory 310 gsm 20x20x7,5 150 rim berapa?` | conversation `escalated`, category `pesanan_besar`; no reply matches `PRICE_RE` |
| `custom_size` | `box ivory 22x22x7 cm 5000 pcs, berapa?` | `escalated`, `harga_custom`; no `PRICE_RE`; a reply matches `/tim/i` |
| `both_brands` | `mau kertas supreme 64 gsm 35x35 10 rim`; then `sekalian box ivory 270 gsm 21x14x5 5000 pcs juga` | replies contain `Rp 217.500`, `Rp 2.175.000`, `Rp 1.500` and `Rp 7.500.000`; after `leadPass`, brands include both slugs, with at least 2 items |
| `logo_image` | `mau cetak kertas supreme 64 gsm 30x30 10 rim`; then image `logo.png` with caption `ini logonya kak` | a reply after the image matches `/logo\|desain/i`; `escalated`, `desain_masuk`; a profile item has `has_design: true` |
| `no_design_reference_photos` | `mau kertas supreme 64 gsm cetak 1 warna 30x30 10 rim, belum punya desain. ada contohnya?` | 1–3 captured images, each path ending in one of the product's reference photo URLs |
| `no_design_no_photos` | `mau box ivory 270 gsm 21x14x5 5000 pcs, belum ada desain, ada contoh?` | no captured image; `escalated`; a reply matches `/tim/i` |
| `agrees_po_form` | the `full_order_quote` steps; then `oke kak saya ambil 12 rim` | a captured text equals `poFormMessage('https://forms.gle/qa-imperial-form')`; after `leadPass`, lead status `won` |
| `price_list_no_details` | `kak minta pricelist box nya dong` | one document named `Daftar Harga Imperial Indopack (QA).pdf`; no `PRICE_RE` |
| `courier` | `Paket untuk gudang Jatinegara, penerimanya siapa kak?` | after `leadPass`, lead kind `kurir`; category `bukan_pembeli`; no reply matches `/berapa\|ukuran/` or `PRICE_RE` |
| `supplier` | `Kami supplier kertas kraft roll, boleh kirim penawaran ke bagian pembelian?` | kind `supplier`; `bukan_pembeli` |
| `job_seeker` | `Permisi kak, apakah ada lowongan operator mesin cetak?` | kind `lamaran_kerja`; `bukan_pembeli` |
| `complaint` | `Kak kertas yang saya terima kemarin sobek semua, saya kecewa` | `escalated`, `komplain`; the reply matches `/maaf/i`; no `/berapa\|ukuran/` |
| `asks_human` | `bisa langsung bicara dengan orang/admin saja kak?` | `escalated`, `minta_orang`; no `/berapa\|ukuran/` |
| `english` | `Hi, I need Kertas Supreme 64 gsm printed 1 colour, 30x30 cm, 10 rim. How much?` | a reply where `writesEnglish(text)` is true, containing `Rp 165.000` and `Rp 1.650.000` |
| `ack_only` | `berapa harga kertas supreme?`; then `sayExpectingSilence('terima kasih kak 🙏')` | the second step captures nothing |
| `returning_lost_after_window` | `mau kertas supreme 30x30 5 rim`; `leadPass`; SQL sets the lead `lost`, `lost_reason 'tidak_jadi'`, `closed_at now()`, `human_updated_at NULL`; `backdate(100)`; then `kak mau order lagi kertas supreme 30x30 10 rim`; `leadPass` | the contact has 2 leads; the newest has `previous_lead_id` = the old id and status ≠ `lost` |
| `silence_lost` | `berapa harga box ivory 270 gsm 21x14x5?`; `backdate(31)`; `silenceSweep` | the lead is `lost` with `lost_reason 'tidak_ada_respon'` |

- [ ] **Step 1: Write the failing `tests/qa-lib.test.ts`**

```ts
it('builds a Meta text payload the webhook maps', () => {
  const b = inboundPayload({ from: '6281200007001', id: 'wamid.qa1', phoneNumberId: 'local-phone-70', text: 'halo', at: new Date(1_800_000_000_000) }) as any;
  expect(b.entry[0].changes[0].value).toMatchObject({ metadata: { phone_number_id: 'local-phone-70' }, messages: [{ from: '6281200007001', id: 'wamid.qa1', type: 'text', text: { body: 'halo' }, timestamp: '1800000000' }] });
});
it('an image payload carries the media id and caption', ...); // type 'image', image { id: 'logo.png', mime_type: 'image/png', caption }
it('a referral rides on the message', ...);                    // messages[0].referral { source_type: 'ad', headline }
it('settles only after a text and a quiet period', () => {
  const T = { at: '2026-11-18T03:00:00Z', kind: 'text' }, D = { at: '2026-11-18T03:00:00Z', kind: 'document' };
  expect(settled([T], Date.parse('2026-11-18T03:00:07Z'), 8000)).toBe(false); expect(settled([T], Date.parse('2026-11-18T03:00:09Z'), 8000)).toBe(true);
  expect(settled([D], Date.parse('2026-11-18T03:01:00Z'), 8000)).toBe(false); expect(settled([], 0, 8000)).toBe(false);
});
it('PRICE_RE finds rupiah figures only', () => { expect(PRICE_RE.test('Rp 165.000/rim')).toBe(true); expect(PRICE_RE.test('minimal 5 rim')).toBe(false); });
```

- [ ] **Step 2: Run it to verify it fails, implement `lib.ts`, and run it to pass**

Run: `npx vitest run tests/qa-lib.test.ts`
Expected: first FAIL, then PASS.

- [ ] **Step 3: Implement setup, fixtures, scenarios, run, say and start-api; run setup and start the QA API**

Run: `npm run qa:setup`, then, in a second terminal, `npm run qa:api`
Expected: setup prints the fixture counts (2 brands, 4 products, 5 sizes, 12 tiers). The API logs `listening on port 50071`.

- [ ] **Step 4: Run the harness**

Run: `npm run qa:run`
Expected: `22/22 passed`, and `docs/qa/conversation-qa-report.md` is written. A run takes about 20–40 minutes, because every turn is a real Claude call.

- [ ] **Step 5: Fix the bot, never the checks, until every scenario passes**

For each failure, use superpowers:systematic-debugging on the transcript in the report. The fix goes into the code that owns the behaviour:
- prompt sections in `src/domain/constants.ts`
- reply checks
- router or price tool

A received logo or design file that does not hand off is fixed in the Design and Escalation prompt sections (§7.6). Re-run the failed scenarios with `--only`, then the full harness once more.
Expected: one full run with `22/22 passed`.

- [ ] **Step 6: Commit**

```bash
git add scripts/qa src/services/leadInsights.ts package.json tests/qa-lib.test.ts ../docs/qa/conversation-qa-report.md
git add -A src # only the bot fixes from Step 5
git commit -m "Conversation QA harness: 22 scenarios against the real bot, all passing"
```

---

### Task 24: Dashboard smoke checklist

**Files:**
- Create: `docs/qa/dashboard-smoke.md` (the table below with a Result column filled in)
- Modify: `dashboard/.env.local` (not committed)

- [ ] **Step 1: Configure and start both apps against the dev database**

```bash
cd dashboard && cp .env.example .env.local
sed -i '' "s#^AUTH_SECRET=.*#AUTH_SECRET=$(openssl rand -hex 32)#" .env.local
sed -i '' "s#^API_SECRET_KEY=.*#API_SECRET_KEY=$(sed -n 's/^SEED_API_KEY=//p' ../api/.env)#" .env.local
```
Then run `cd api && npm run dev` and `cd dashboard && npm run dev` in two terminals. The dev DB holds the starter catalog (Plan 1 Task 14) and the Task 1 seed.
Expected: the API listens on 50070. `http://localhost:40070/app/login` loads with the Imperial Indopack mark, Montserrat headings and the green palette.

- [ ] **Step 2: Create chats to look at**

Run each with `cd api && npm run qa:say -- --base http://localhost:50070 <phone> "<text>"`:
- `6281200007101 "berapa harga kertas supreme?"`
- `6281200007102 "mau box ivory 22x22x7 cm 5000 pcs"`
- `6281200007103 "Paket untuk gudang, penerimanya siapa kak?"`
- `6281200007104 "kak saya kecewa, kertasnya sobek"`

Expected: each prints the bot's captured reply within 2 minutes.

- [ ] **Step 3: Log in with the seeded admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `api/.env`), then work through every row in a browser**

Use superpowers:verification-before-completion: a row passes only when the expected result is seen.

| # | Page | Action | Expected |
|---|---|---|---|
| 1 | Sidebar | look | groups Inbox (Percakapan, Perlu Tim + badge), Penjualan (Ringkasan, Leads), Produk (Katalog), Sistem (Nomor WhatsApp, Test Prompt, Aktivitas, Admin, Pengaturan) |
| 2 | Header | switch ID → EN → ID | every label changes language; customer text does not |
| 3 | Percakapan | open | 4 chats; tabs show Perlu Tim count ≥ 3 |
| 4 | Percakapan | search `07102` | only that chat |
| 5 | Percakapan | open the 22x22x7 chat | handoff banner with reason; tool line `hitung_harga · 22×22×7 → tidak ada di katalog`; panel shows Ukuran `di luar katalog` and a nearest box |
| 6 | Percakapan | Catatan tim: type, click away, reload | the note and `Disimpan … · Admin` persist |
| 7 | Percakapan | Kirim daftar harga on the 22x22x7 chat, before any price list is uploaded | the `NO_PRICE_LIST` copy; nothing is sent; the status is unchanged |
| 8 | Percakapan | Kirim form PO with the placeholder link | error copy for `PO_FORM_PLACEHOLDER`; nothing is sent |
| 9 | Percakapan | reply `Halo kak, sedang kami hitungkan` | the bubble appears as `Admin · tim`; the line is in `api/logs/whatsapp-capture.jsonl` |
| 10 | Percakapan | ← Kembalikan ke AI | the pill reads `AI menangani`; the chat leaves the Perlu Tim tab |
| 11 | Percakapan | Selesaikan on the courier chat | the chat moves to the Selesai tab |
| 12 | Perlu Tim | open | groups Harga custom (the 22x22x7 chat), Komplain (the complaint); empty groups show `Tidak ada`; wait times and `Belum diambil` |
| 13 | Perlu Tim | Ditangani saya | only chats assigned to Admin |
| 14 | Ringkasan | open; Merek = Kertas Supreme | tiles, per-day bars and funnel change with the filter; Belum dibalas lists waiting chats |
| 15 | Leads | open | Performa per Merek with both brands; rows show brand tags, Hot/Cold and items |
| 16 | Leads | tab Imperial Indopack | only leads tagged Imperial Indopack |
| 17 | Leads | search `22x22` | the box lead |
| 18 | Leads | Export Excel | an `.xlsx` downloads with columns Merek, Barang, Nama, Usaha |
| 19 | Leads | Bukan Lead → | the courier row as Kurir; `Jadikan Lead` moves it back to Leads |
| 20 | Lead detail | open the box lead | header, Status and Jenis selects, items table, Info (Sumber `Chat langsung`), Riwayat |
| 21 | Lead detail | Ubah items: set Jumlah `2.500` pcs, Desain Ada, tick Kertas Supreme; Simpan | the table shows `2.500 pcs`; the brand tags show both; a reload keeps it |
| 22 | Lead detail | Status → Menang | saved; Riwayat gains the staff change |
| 23 | Katalog | open | brand tabs with counts; price-list rows `Belum ada file · Unggah`; each product shows its tier table |
| 24 | Katalog | Unggah a PDF for Kertas Supreme | the row shows the file name and today's date |
| 25 | Katalog | Cek harga: Kertas Supreme product, first size, 12 rim | the same tier and total `hitung_harga` gives (compare with Test Prompt in row 41) |
| 26 | Katalog | Cek harga 1 rim | the below-minimum message |
| 27 | Katalog | Import Excel: pick `docs/client/starter-catalog-draft.xlsx` | preview counts with 0 new products and 0 changed prices; Terapkan; the toast and the list are unchanged |
| 28 | Katalog | Import Excel with a copy that has one price changed and one unit `box` | preview: 1 harga diubah, 1 baris salah with the `Satuan "box"` copy; Batal changes nothing |
| 29 | Katalog | Unduh template-katalog.xlsx | the file opens with the 13 template columns |
| 30 | Tambah Produk | fill the form, two sizes, Salin tingkat ke ukuran lain | the second size gets the tiers with empty prices and the "disalin dari" note; the checklist shows ✕; Simpan is disabled |
| 31 | Tambah Produk | type prices `185.000` etc., add 2 photos, Simpan | redirects to Katalog; the product shows both sizes and both photos; Yang dilihat bot showed the exact tier lines first |
| 32 | Tambah Produk | tiers 10 rim then 5 rim | ✕ `naik berurutan` |
| 33 | Ubah Produk | change one price | banner `1 perubahan belum disimpan` with the line; `Sebelumnya Rp …`; Simpan; Riwayat shows the change with `Admin` |
| 34 | Ubah Produk | upload photos until there are 3, then one more | the 4th is refused with the max-3 copy |
| 35 | Ubah Produk | Nonaktifkan | the badge reads `Nonaktif`; the Katalog row is collapsed; Cek harga no longer lists it |
| 36 | Hapus produk | open; Hapus permanen | disabled until the checkbox is ticked; counts match; deletion removes it from the list |
| 37 | Pengaturan | open | the go-live banner lists the PO link placeholder and WhatsApp not connected |
| 38 | Pengaturan | PO link `http://x.y` | refused (https copy); `https://forms.gle/test-imperial` saves; the banner line disappears; the message preview updates |
| 39 | Pengaturan | Nama bot `Sari`, greeting edited, Simpan; reload | values persist |
| 40 | Pengaturan | reopen 3 months, silence 30 days, reminder 30 minutes, minimum 2.500 | saved; the hint shows `pcs (5 rim)` |
| 41 | Test Prompt | send `berapa harga kertas supreme 30x30 12 rim?` | the reply introduces itself as Sari and quotes the catalog price (or hands off when the starter catalog lacks that size) |
| 42 | Percakapan | Kirim form PO now that the link is real | confirm dialog with the message; sent; a captured line with `https://forms.gle/test-imperial` |
| 43 | Nomor WhatsApp | open | the local capture number is listed; add/edit form fields work |
| 44 | Aktivitas | open | recent staff actions are listed |
| 45 | Admin | add an agent account; log in as them in a private window | the agent sees no Nomor WhatsApp, Admin or Pengaturan |
| 46 | Percakapan | after row 24, Kirim daftar harga on the `07101` chat | a document bubble `{file name}` from Admin; the status pill reads `Ditangani tim · Admin`; the document line is in the capture log |

- [ ] **Step 4: Fix every failing row in the owning task's files, re-run the row, record the results in `docs/qa/dashboard-smoke.md` (date, SHA, and Pass for each row), and commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A dashboard api/src docs/qa/dashboard-smoke.md && git commit -m "Dashboard smoke checklist: all rows pass"
```

---

### Task 25: Go-live doc

**Files:**
- Create: `docs/go-live.md`
- Modify: `README.md` (link to it, and the two `npm run dev` commands with ports)

- [ ] **Step 1: Write `docs/go-live.md` with these sections, in order, using exact names from `api/src/config.ts` and the dashboard `.env.example`**

1. **What runs.**
   - the API (port, `npm run build && npm start`), the dashboard (`npm run build && npm start` on 40070, or behind the API's `/app` proxy via `DASHBOARD_UPSTREAM`), and Postgres 17 with pgvector
   - the webhook needs a public HTTPS URL; hosting is still the client's choice (spec §9 item 8)
2. **Environment variables.** A table per app: name, required, go-live value or how to get it.
   - API: `DATABASE_URL`, `API_SECRET_KEY`, `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN_1..N` (with `USE_CLAUDE_CLI` unset in production), `PUBLIC_BASE_URL`, `WHATSAPP_TRANSPORT`, the Chakra or Meta variables, `VAPID_*`, `DASHBOARD_ORIGIN` / `DASHBOARD_UPSTREAM`, `RESET_COMMAND_NUMBERS`
   - also `CAPTURE_*`, with a warning that `capture` refuses production
   - Dashboard: `AUTH_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BASE_PATH`, `API_SECRET_KEY`
3. **First deploy.**
   - `npx tsx scripts/migrate.ts`
   - `npx tsx scripts/seed.ts` for the real admin and API key; copy the key once into `API_SECRET_KEY`
   - the dashboard build
4. **Connect WhatsApp: ChakraHQ.**
   - set `WHATSAPP_TRANSPORT=chakra`, `CHAKRA_ACCESS_TOKEN`, `CHAKRA_PLUGIN_ID`, `CHAKRA_WEBHOOK_SECRET`
   - point Chakra's webhook at `https://<host>/webhooks/whatsapp`
   - add the number on **Nomor WhatsApp** (number, WABA ID, phone number ID)
   - restart; Pengaturan → WhatsApp shows `Terhubung`; optional `META_ACCESS_TOKEN` for inbound media
5. **Connect WhatsApp: Meta Cloud API.**
   - set `WHATSAPP_TRANSPORT=meta`, `META_ACCESS_TOKEN`, `META_WEBHOOK_SECRET` (App Secret), `META_WEBHOOK_VERIFY_TOKEN`
   - subscribe the webhook URL with that verify token and the `messages` field
   - add the number; restart
6. **Before the first customer:**
   - Pengaturan → PO link (https), bot name and greeting
   - Katalog → import the client-reviewed starter catalog, upload both price-list PDFs, add up to 3 reference photos per product
   - Admin → staff accounts; each staff member enables browser notifications
   - the go-live banner must be empty
7. **What to test first, from a personal phone, in order:**
   - (1) `berapa harga kertas supreme?` → the price list arrives
   - (2) a full catalog order → tier price and total
   - (3) a custom size → the chat appears in Perlu Tim, the push arrives
   - (4) reply from the dashboard → the phone receives it, the AI pauses
   - (5) `oke saya ambil` after a quote → PO form link; the lead becomes Menang
   - (6) Leads and Ringkasan show the lead with its brand
8. **Switches if something goes wrong:** Pengaturan → Balasan otomatis AI off (only staff reply); deactivate a product; `/new` for numbers in `RESET_COMMAND_NUMBERS`.

- [ ] **Step 2: Check every variable named in the doc exists in code**

Run: `for v in $(grep -oE '\b[A-Z][A-Z0-9_]{3,}\b' docs/go-live.md | sort -u); do grep -rqs "$v" api/src dashboard/.env.example dashboard/lib dashboard/next.config.ts || echo "missing $v"; done`
Expected: no `missing` lines, apart from words that are not variables (review each by eye).

- [ ] **Step 3: Commit**

```bash
git add docs/go-live.md README.md && git commit -m "Go-live guide: env, WhatsApp connection, setup, first tests"
```

---

## After this plan

- The user connects the WhatsApp number (go-live §4 or §5) and tests (§7).
- Client inputs still open (spec §9): the two unreadable note lines, the brand mapping of paper bags and greaseproof, the reviewed catalog, price-list files, reference photos, the PO link, the bot name, the provider and hosting.
