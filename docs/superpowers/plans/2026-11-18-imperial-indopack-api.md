# Imperial Indopack API Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the copied Legacy API (`api/`) into the Imperial Indopack / Kertas Supreme sales bot and CRM backend. It quotes tiered catalog prices through a code-side calculator, collects the six order details, sends price lists, reference photos and the PO form, and tracks one lead per customer, tagged with brands and items.

**Architecture:** Adapt in place. Keep Legacy's engine:
- webhook → `messageRouter` → `aiLayer` tool loop → reply checks → send
- lead stages and the background lead pass

Replace the business layer: catalog tiers, `hitung_harga` tool, strict price check, turn output, profile merge, gap questions, prompt, lead-pass fields, settings. Switch Legacy-only features off. Plan 2 (dashboard) comes after this plan lands.

**Tech Stack:** Node 24, TypeScript 5.8 (Node16 ESM, `.js` import suffixes), Fastify 5, Drizzle ORM 0.43 + node-postgres, Postgres 17 with pgvector, Zod 4, Vitest 3, `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, `read-excel-file` / `write-excel-file`.

**Spec:** `docs/superpowers/specs/2026-11-18-imperial-indopack-chatbot-design.md`. Read it before starting. Section numbers below (§) refer to it.

## Global Constraints

- All work is in `api/` unless a path says otherwise. Run commands from `api/`.
- 1 rim = 500 pcs (`PCS_PER_RIM = 500`). Quantities compare in pcs.
- Tier rule: the tier is the highest one whose minimum the quantity reaches. Below the lowest tier → `below_minimum`. Above the top tier's own quantity → `above_top_tier` (staff). Total = quantity in the price's unit × unit price, rounded to whole rupiah.
- Minimum order fallback when an item has no tiers: 2,500 pcs (5 rim).
- Brand slugs: `imperial_indopack`, `kertas_supreme`. Display names: `Imperial Indopack`, `Kertas Supreme`.
- Customer-facing text is Indonesian. Rupiah renders as `Rp 1.850.000` (`toLocaleString('id-ID')`).
- The model never writes a URL. Price list files, reference photos and the PO link are attached by code.
- PO form placeholder: `https://forms.gle/REPLACE-ME`. Return window default: 90 days (3 months). Silence → Lost stays at 30 days.
- Never quote or store another customer's negotiated price. Never commit the client workbook (`Book1penawaran harga (2).xlsx`), which holds customer names.
- Tests must never run against a Legacy database (Task 0 adds a guard).
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Sizes written many ways:** `30x30`, `30 x 30 cm`, `30*30`, `30×30` and `30 X 30` must all find the same variant. Task 5 pins this.
2. **A quantity the model misreads:** "2.500 pcs" sent as `2.5`. That must fail safe as `below_minimum`, never quote. Task 5 pins this.
3. **Both brands priced in one turn:** two `hitung_harga` calls in one turn, and figures from both must pass the check. Tasks 5 and 6 pin this.
4. **The bare ad text before anything else is known:** "berapa harga kertas supreme?" with an empty profile must send the Kertas Supreme price list, read from the message text. Task 7 pins this.
5. **An empty catalog (before the client's import):** every price question returns `not_in_catalog` and hands off. Task 5 pins this.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `vitest.config.ts`, `tests/setup/db-guard.ts` | test config, refuse a Legacy DB | 0 |
| `src/db/migrations/0026_imperial_catalog_and_lead_fields.sql`, `src/db/migrations/meta/_journal.json`, `src/db/schema.ts` | tiers, reference images, lead brands and items, brand rows | 1 |
| `src/domain/pricing.ts` | pure tier quote | 2 |
| `src/repositories/priceTiers.ts`, `src/repositories/referenceImages.ts`, `src/repositories/products.ts`, `src/services/ragQuery.ts`, `src/domain/types.ts` | load tiers and photos, render the catalog block | 3 |
| `src/services/catalogTemplate.ts`, `src/services/catalogImport.ts`, `src/services/catalogExport.ts` | Excel template in and out | 4 |
| `src/services/priceTool.ts`, `src/services/aiLayer.ts` | `hitung_harga` and wiring it into both call paths | 5 |
| `src/services/replyChecks.ts`, `src/services/aiLayer.ts` (`verifyFit`) | strict price check | 6 |
| `src/services/aiLayer.ts`, `src/domain/types.ts`, `src/services/messageRouter.ts`, `src/services/catalogDelivery.ts`, `src/repositories/appSettings.ts`, `src/domain/constants.ts` | turn output, PO link, images, price-list rule | 7 |
| `src/domain/orderProfile.ts`, `src/repositories/contactProfiles.ts` | array-aware profile merge | 8 |
| `src/services/escalationHandler.ts`, `src/domain/constants.ts` | gap questions, handoff summary | 9 |
| `src/domain/constants.ts`, `src/services/aiLayer.ts`, `src/services/ragQuery.ts`, `src/domain/promptSync.ts` | prompt, canned replies, features off | 10 |
| `src/services/leadInsights.ts`, `src/repositories/leads.ts` | lead pass fields | 11 |
| `src/repositories/leads.ts`, `src/routes/dashboard/leads.ts`, `src/routes/dashboard/settings.ts`, `src/services/leadsExport.ts` | leads API and settings | 12 |
| `tests/**` | Legacy test sweep | 13 |
| `scripts/draft-starter-catalog.ts` | starter catalog draft from the workbook | 14 |

---

### Task 0: Repository, local database, test guard

**Files:**
- Create: `vitest.config.ts`, `tests/setup/db-guard.ts`, `api/.env` (not committed)
- Repo root: `git init`

- [ ] **Step 1: Confirm no Legacy customer identifiers remain before the first commit**

Run: `grep -rnE "\b0[0-9]{9,12}\b|\b62[0-9]{9,12}\b" tests src scripts | grep -vE "081200000|628111|081234567890|628999|628571234567"`
Expected: no output. Any hit is a real-looking number: replace it with an `0812000000NN` fake.

- [ ] **Step 2: Initialise git at the repo root and commit the port as it stands**

```bash
cd .. && git init && git add -A && git status --short | grep -E "\.env$|node_modules|\.xlsx$" ; git commit -m "Port Legacy chatbot API as the starting point"
```
Expected: the `grep` prints nothing, then the commit succeeds.

- [ ] **Step 3: Create the local database and `api/.env` without printing credentials**

Reuse the local Postgres login from Legacy's env file, pointed at a new database:
```bash
sed -n 's#^DATABASE_URL=\(.*\)/[^/?]*#DATABASE_URL=\1/imperial_indopack#p' "../../legacy-app/legacy-api/.env" > .env
psql "$(sed -n 's#^DATABASE_URL=\(.*\)/imperial_indopack#\1/postgres#p' .env)" -c "create database imperial_indopack"
npx tsx scripts/migrate.ts
```
Note: `scripts/migrate.ts` defaults `MIGRATIONS_DIR` to `./migrations`. Run it with `MIGRATIONS_DIR=src/db/migrations` if the default path does not exist.
Expected: `✅ Migrations applied`. Also check `grep -c '^DATABASE_URL=.*imperial_indopack$' .env` prints `1`.

- [ ] **Step 4: Write `tests/setup/db-guard.ts` and `vitest.config.ts`**

The guard throws `Refusing to run tests against a Legacy database` when `process.env.DATABASE_URL` matches `/legacy/i`. It runs after `dotenv/config`. `vitest.config.ts` sets `test.setupFiles: ['dotenv/config', './tests/setup/db-guard.ts']`.

- [ ] **Step 5: Record the baseline**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -5`
Expected: tsc exits 0. Write down the pass/fail counts in the commit message: the DB tests now run, and Legacy-specific failures are expected until Task 13.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/setup/db-guard.ts && git commit -m "Test config with a guard against Legacy databases"
```

---

### Task 1: Migration 0026: tiers, reference images, lead brands and items

**Files:**
- Create: `src/db/migrations/0026_imperial_catalog_and_lead_fields.sql`
- Modify: `src/db/migrations/meta/_journal.json` (append idx 26), `src/db/schema.ts`
- Test: `tests/imperial-schema.test.ts`

**Interfaces:**
- Produces:
  - Drizzle tables `variantPriceTiers` (`id`, `variantId`, `minQty`, `qtyUnit`, `priceIdr`, `priceUnit`, `includesDelivery`, `note`, `createdAt`) and `productReferenceImages` (`id`, `productId`, `imageUrl`, `sort`, `createdAt`)
  - `leads.brands: string[]` (default `{}`) and `leads.items: unknown[]` (jsonb, default `[]`)
  - brand rows `Imperial Indopack` and `Kertas Supreme`

- [ ] **Step 1: Write the failing test `tests/imperial-schema.test.ts` (DB)**

```ts
it('stores a tier and rejects a unit that is not rim or pcs', async () => {
  // insert brand/product/variant with a unique test prefix, then:
  await db.insert(variantPriceTiers).values({ variantId, minQty: 5, qtyUnit: 'rim', priceIdr: '2000', priceUnit: 'pcs', includesDelivery: true });
  const rows = await db.select().from(variantPriceTiers).where(eq(variantPriceTiers.variantId, variantId));
  expect(rows).toHaveLength(1);
  await expect(db.insert(variantPriceTiers).values({ variantId, minQty: 1, qtyUnit: 'box', priceIdr: '1', priceUnit: 'pcs' })).rejects.toThrow();
});
it('gives a new lead empty brands and items', async () => {
  const [l] = await db.insert(leads).values({ contactId }).returning();
  expect(l.brands).toEqual([]);
  expect(l.items).toEqual([]);
});
it('seeds both brands', async () => {
  const names = (await db.select({ n: brands.name }).from(brands)).map((r) => r.n);
  expect(names).toEqual(expect.arrayContaining(['Imperial Indopack', 'Kertas Supreme']));
});
```
Clean up test rows by prefix in `afterAll`, following `tests/catalog-v2.test.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/imperial-schema.test.ts`
Expected: FAIL. `variantPriceTiers` is not exported from schema.

- [ ] **Step 3: Write the migration, the journal entry and the schema**

SQL:
- `variant_price_tiers`:
  - `variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE`
  - `min_qty integer NOT NULL CHECK (min_qty > 0)`
  - `qty_unit text NOT NULL CHECK (qty_unit IN ('rim','pcs'))`
  - `price_idr numeric NOT NULL CHECK (price_idr > 0)`
  - `price_unit text NOT NULL CHECK (price_unit IN ('pcs','rim'))`
  - `includes_delivery boolean NOT NULL DEFAULT false`
  - `note text`
  - `UNIQUE (variant_id, min_qty, qty_unit)`
- `product_reference_images`:
  - `product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE`
  - `image_url text NOT NULL`
  - `sort integer NOT NULL DEFAULT 0`
  - index on `(product_id, sort)`
- `ALTER TABLE leads ADD COLUMN brands text[] NOT NULL DEFAULT '{}', ADD COLUMN items jsonb NOT NULL DEFAULT '[]'::jsonb`
- `INSERT INTO brands (name, description, brand_type) VALUES ('Imperial Indopack', 'Box karton (ivory, kraft) cetak untuk makanan dan produk lain', 'own'), ('Kertas Supreme', 'Kertas bungkus makanan cetak logo (nasi, kebab, burger)', 'own') ON CONFLICT (name) DO NOTHING`

Journal entry: `{ "idx": 26, "version": "7", "when": 1794100000000, "tag": "0026_imperial_catalog_and_lead_fields", "breakpoints": true }`.

- [ ] **Step 4: Apply and run the test**

Run: `npx tsx scripts/migrate.ts && npx vitest run tests/imperial-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db tests/imperial-schema.test.ts && git commit -m "Add price tiers, reference images, lead brands and items"
```

---

### Task 2: Pure tier pricing (`src/domain/pricing.ts`)

**Files:**
- Create: `src/domain/pricing.ts`
- Test: `tests/pricing.test.ts`

**Interfaces:**
- Produces:
```ts
export type QtyUnit = 'rim' | 'pcs';
export const PCS_PER_RIM = 500;
export const FALLBACK_MIN_PCS = 2500;
export interface PriceTier { minQty: number; qtyUnit: QtyUnit; priceIdr: number; priceUnit: QtyUnit; includesDelivery: boolean; note?: string | null }
export type PriceQuote =
  | { kind: 'quote'; tier: PriceTier; qtyInPriceUnit: number; unitPriceIdr: number; totalIdr: number; includesDelivery: boolean; nextTier: PriceTier | null }
  | { kind: 'below_minimum'; minimum: PriceTier }
  | { kind: 'above_top_tier'; top: PriceTier }
  | { kind: 'no_tiers' };
export function toPcs(qty: number, unit: QtyUnit): number;
export function quotePrice(tiers: PriceTier[], qty: number, unit: QtyUnit): PriceQuote;
```

- [ ] **Step 1: Write the failing tests**

Fixtures are copied from the client workbook:
- `IVORY` = 5 rim → Rp 2.000/pcs, 10 rim → 1.800, 20 rim → 1.500, all `includesDelivery: true`
- `BURGER` = 5 rim → Rp 185.000/rim, 10 rim → 165.000, 20 rim → 160.000, `includesDelivery: false`

```ts
it('8 rim between tiers gets the 5-rim price and names the 10-rim tier', () => {
  const q = quotePrice(IVORY, 8, 'rim');
  expect(q).toMatchObject({ kind: 'quote', unitPriceIdr: 2000, totalIdr: 8_000_000, qtyInPriceUnit: 4000 });
  expect(q.kind === 'quote' && q.nextTier?.minQty).toBe(10);
});
it('exactly the top tier is quoted with no next tier', () =>
  expect(quotePrice(IVORY, 20, 'rim')).toMatchObject({ kind: 'quote', unitPriceIdr: 1500, totalIdr: 15_000_000, nextTier: null }));
it('above the top tier goes to staff', () => expect(quotePrice(IVORY, 21, 'rim').kind).toBe('above_top_tier'));
it('below the lowest tier', () => expect(quotePrice(IVORY, 4, 'rim')).toMatchObject({ kind: 'below_minimum', minimum: { minQty: 5 } }));
it('pcs against rim tiers', () => expect(quotePrice(IVORY, 3000, 'pcs')).toMatchObject({ kind: 'quote', totalIdr: 6_000_000 }));
it('per-rim price, between tiers', () => expect(quotePrice(BURGER, 12, 'rim')).toMatchObject({ unitPriceIdr: 165_000, totalIdr: 1_980_000 }));
it('fractional rim from pcs', () => expect(quotePrice(BURGER, 2700, 'pcs')).toMatchObject({ qtyInPriceUnit: 5.4, totalIdr: 999_000 }));
it('no tiers', () => expect(quotePrice([], 10, 'rim').kind).toBe('no_tiers'));
it('a misread "2.500 pcs" as 2.5 never quotes', () => expect(quotePrice(IVORY, 2.5, 'pcs').kind).toBe('below_minimum'));
it('rejects zero, negative and NaN quantities as below_minimum', () =>
  [0, -5, Number.NaN].forEach((n) => expect(quotePrice(IVORY, n, 'rim').kind).toBe('below_minimum')));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/pricing.test.ts`
Expected: FAIL. Module not found.

- [ ] **Step 3: Implement `quotePrice`**

Sort the tiers by `toPcs(minQty, qtyUnit)`. A non-finite or ≤ 0 quantity is `below_minimum`. Compare in pcs. `qtyInPriceUnit` = pcs ÷ (`priceUnit === 'rim' ? 500 : 1`). The total is `Math.round(qtyInPriceUnit * priceIdr)`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/pricing.test.ts`
Expected: PASS (10).

- [ ] **Step 5: Commit**

```bash
git add src/domain/pricing.ts tests/pricing.test.ts && git commit -m "Tier price quote: highest tier reached, staff above the top"
```

---

### Task 3: Load tiers and reference photos, render the catalog block

**Files:**
- Create: `src/repositories/priceTiers.ts`, `src/repositories/referenceImages.ts`
- Modify: `src/domain/types.ts` (`ProductVariant.priceTiers?: PriceTier[]`, `Product.referenceImageUrls?: string[]`), `src/repositories/products.ts` (`listProducts` attaches both), `src/services/ragQuery.ts` (`formatProducts`)
- Test: `tests/catalog-block.test.ts` (pure)

**Interfaces:**
- Consumes: `PriceTier` (Task 2), tables (Task 1)
- Produces:
```ts
// priceTiers.ts
export async function listTiersByVariant(variantIds: string[]): Promise<Map<string, PriceTier[]>>;
export async function replaceVariantTiers(tx: DbOrTx, variantId: string, tiers: PriceTier[]): Promise<void>;
// referenceImages.ts
export async function listReferenceImageUrls(productIds: string[]): Promise<Map<string, string[]>>; // ordered by sort, max 3 per product
export async function addReferenceImage(productId: string, imageUrl: string): Promise<{ id: string }>;
export async function deleteReferenceImage(id: string): Promise<void>;
// ragQuery.ts
export const REFERENCE_PHOTOS_MARKER = '[FOTO REFERENSI TERSEDIA]';
export function formatTierLine(t: PriceTier): string;
export function formatProducts(items: Product[]): string; // same name, new body
```
`DbOrTx` is whatever `getDb()` and a Drizzle transaction share: reuse the type `catalogImport.ts` passes to `tx`, or define it in `src/db/client.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders one tier line in the exact format the price check reads', () => {
  expect(formatTierLine({ minQty: 5, qtyUnit: 'rim', priceIdr: 2000, priceUnit: 'pcs', includesDelivery: true }))
    .toBe('  • mulai 5 rim (2.500 pcs): Rp 2.000/pcs, sudah termasuk ongkir');
  expect(formatTierLine({ minQty: 10, qtyUnit: 'rim', priceIdr: 165000, priceUnit: 'rim', includesDelivery: false }))
    .toBe('  • mulai 10 rim (5.000 pcs): Rp 165.000/rim, belum termasuk ongkir');
});
it('lists brand, product, use, size and tiers, and marks reference photos', () => {
  const block = formatProducts([FIXTURE_SUPREME_WITH_TWO_PHOTOS]);
  expect(block).toContain('Merek: Kertas Supreme');
  expect(block).toContain('Produk: Kertas Supreme 64 gsm cetak 1 warna');
  expect(block).toContain('Kegunaan: bungkus nasi, kebab, burger');
  expect(block).toContain('- Ukuran: 30 x 30 cm');
  expect(block).toContain(REFERENCE_PHOTOS_MARKER);
  expect(block).not.toMatch(/PRICELIST|MP\b|reseller/i);
});
it('a variant with no tiers says the team prices it', () =>
  expect(formatProducts([FIXTURE_NO_TIERS])).toContain('  • harga: dihitung tim'));
```
The block must still start with `--- KATALOG PRODUK ---` and end with `--- AKHIR KATALOG ---`, if `formatProducts` is what emits those markers (check `buildSystemPrompt`). `extractCatalogBlock` depends on them.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/catalog-block.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

The header line of the block reads: `Harga per tingkat jumlah. Untuk harga sesuai jumlah pelanggan WAJIB panggil hitung_harga. 1 rim = 500 pcs/lembar.` The pcs figure in a tier line is `toPcs(minQty, qtyUnit)` in `id-ID` format. `listProducts` loads tiers and photo URLs in two batched queries, not one per product.

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run tests/catalog-block.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src tests/catalog-block.test.ts && git commit -m "Catalog block lists price tiers and reference photos"
```

---

### Task 4: Catalog Excel template, import and export

**Files:**
- Create: `src/services/catalogTemplate.ts`
- Modify: `src/services/catalogImport.ts` (`importCatalogFromXlsx` uses the template; the old `parseCatalogWorkbook` is removed), `src/services/catalogExport.ts` (writes the template)
- Delete: `tests/catalog-import.test.ts`, `tests/catalog-export.test.ts` (Legacy layout)
- Test: `tests/catalog-template.test.ts` (pure), `tests/catalog-template-import.test.ts` (DB)

**Interfaces:**
- Consumes: `replaceVariantTiers` (Task 3), `PriceTier` (Task 2), `invalidateCatalogCache` (ragQuery)
- Produces:
```ts
export const TEMPLATE_SHEET = 'Katalog';
export const TEMPLATE_COLUMNS = ['Merek','Produk','Ukuran','Gramasi','Cetak','Finishing','Kegunaan','Min Qty','Satuan Qty','Harga','Satuan Harga','Termasuk Ongkir','Catatan'] as const;
export interface TemplateVariant { brand: string; product: string; size: string; description: string | null; fungsi: string | null; tiers: PriceTier[] }
export interface ParsedTemplate { variants: TemplateVariant[]; errors: { row: number; message: string }[] }
export function parseTemplateRows(rows: unknown[][]): ParsedTemplate; // rows[0] = header
export function buildTemplateRows(products: Product[]): unknown[][];
// catalogImport.ts keeps: importCatalogFromXlsx(buffer: Buffer): Promise<CatalogImportResult>
```
Mapping:
- `Gramasi`, `Cetak` and `Finishing` join into `products.description` as `Gramasi: 64 gsm · Cetak: 1 warna · Finishing: laminasi` (empty parts dropped)
- `Kegunaan` → `products.fungsi`
- `Termasuk Ongkir` accepts `ya` / `tidak` (case-insensitive)
- units accept `rim` / `pcs`
- `Harga` and `Min Qty` accept `1.500` and `1500`

One row = one tier. Rows with the same Merek + Produk + Ukuran group into one variant.

- [ ] **Step 1: Write the failing pure tests**

```ts
it('groups tier rows into one variant', () => {
  const p = parseTemplateRows([HEADER, ROW('Kertas Supreme','Kertas Supreme 64 gsm cetak 1 warna','30 x 30 cm','5','rim','185.000','rim','tidak'), ROW(...,'10','rim','165000','rim','tidak')]);
  expect(p.errors).toEqual([]);
  expect(p.variants).toHaveLength(1);
  expect(p.variants[0].tiers.map((t) => t.priceIdr)).toEqual([185000, 165000]);
});
it('reports a bad unit, a zero price and a missing brand by row number', () => {
  const p = parseTemplateRows([HEADER, ROW(...unit 'box'), ROW(...price '0'), ROW('', ...)]);
  expect(p.errors.map((e) => e.row)).toEqual([2, 3, 4]);
});
it('round-trips build → parse', () =>
  expect(parseTemplateRows(buildTemplateRows([FIXTURE])).variants).toEqual(EXPECTED_VARIANTS));
it('refuses a header that is not the template', () =>
  expect(parseTemplateRows([['Nama Produk','Harga']]).errors[0].message).toMatch(/template/i));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/catalog-template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `catalogTemplate.ts`**

- [ ] **Step 4: Write the failing DB test `tests/catalog-template-import.test.ts`**

```ts
it('creates brand, product, variant and tiers, and a second import replaces tiers without duplicating', async () => {
  await importCatalogFromXlsx(await xlsxOf(ROWS_V1));
  await importCatalogFromXlsx(await xlsxOf(ROWS_V2_ONE_TIER));
  const tiers = await listTiersByVariant([variantId]);
  expect(tiers.get(variantId)).toHaveLength(1);
  expect(variant.priceIdr).toBe(LOWEST_TIER_PRICE);
});
it('leaves products that are not in the file untouched', async () => { /* … */ });
```
Use `write-excel-file`'s buffer output, as `catalogExport.ts` does, to build `xlsxOf`.

- [ ] **Step 5: Rewrite `importCatalogFromXlsx` and the export**

Brands are found or created by name. Products are upserted by name: set brand, description, fungsi. Variants are upserted by (product, size): set `priceIdr` = the lowest tier price, `isActive` = true, then `replaceVariantTiers`. All of it runs in one transaction, followed by `invalidateCatalogCache()`. Keep the `CatalogImportResult` shape so `routes/dashboard/catalog.ts` is unchanged.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/catalog-template.test.ts tests/catalog-template-import.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A src/services tests && git commit -m "Catalog import/export in the Imperial Indopack tier template"
```

---

### Task 5: `hitung_harga` price tool in both call paths

**Files:**
- Create: `src/services/priceTool.ts`
- Modify: `src/services/aiLayer.ts`:
  - `callViaAPI`: tools array and tool-result branch
  - `callViaAgentSDK`: add `tool(...)`
  - both set `AIResponse.toolFigures`
- Modify: `src/domain/types.ts` (`AIResponse.toolFigures?: number[]`)
- Test: `tests/price-tool.test.ts` (pure, fixture catalog), `tests/price-tool-loop.test.ts` (mocked client, following `tests/claude-client.test.ts`)

**Interfaces:**
- Consumes: `quotePrice` (Task 2), `Product` with `variants[].priceTiers` (Task 3), `getFullCatalogBlock`'s product source (`listProducts({ limit: 0 })`, cached in the same way)
- Produces:
```ts
export const PRICE_TOOL_NAME = 'hitung_harga';
export const PriceToolInput = z.object({ product: z.string(), size: z.string(), qty: z.number(), unit: z.enum(['rim','pcs']) });
export function normalizeSize(s: string): string; // '30 x 30 cm' | '30*30' | '30×30' | '30 X 30' -> '30x30'
export async function runPriceTool(input: z.infer<typeof PriceToolInput>, catalog?: Product[]): Promise<{ text: string; figures: number[] }>;
```
Rules:
- Product match: exact case-insensitive name first, then the single product whose name contains every input word. Zero matches or more than one → `not_in_catalog`.
- Variant match: by `normalizeSize`.
- `figures`: for a quote, `[unitPriceIdr, totalIdr, nextTier?.priceIdr]`, without undefined; otherwise `[]`.
- `text` is Indonesian and starts with one of `HARGA:`, `DI_BAWAH_MINIMUM:`, `DI_ATAS_TINGKAT_TERATAS:` or `TIDAK_ADA_DI_KATALOG:`. The prompt (Task 10) keys on these.

- [ ] **Step 1: Write the failing pure tests**

```ts
it('quotes 12 rim of Kertas Supreme 30x30', async () => {
  const r = await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', qty: 12, unit: 'rim' }, CATALOG);
  expect(r.text).toMatch(/^HARGA:/); expect(r.text).toContain('Rp 165.000/rim'); expect(r.text).toContain('Rp 1.980.000');
  expect(r.figures).toEqual(expect.arrayContaining([165000, 1980000, 160000]));
});
it.each(['30x30', '30 x 30 cm', '30*30', '30×30', '30 X 30'])('finds size written as %s', async (s) =>
  expect((await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: s, qty: 5, unit: 'rim' }, CATALOG)).text).toMatch(/^HARGA:/));
it('an unknown size is not in the catalog, with no figures', async () => {
  const r = await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: '32x32', qty: 5, unit: 'rim' }, CATALOG);
  expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/); expect(r.figures).toEqual([]);
});
it('an empty catalog prices nothing', async () =>
  expect((await runPriceTool({ product: 'box', size: '20x20x7,5', qty: 10, unit: 'rim' }, [])).text).toMatch(/^TIDAK_ADA_DI_KATALOG:/));
it('2.5 pcs is below the minimum', async () =>
  expect((await runPriceTool({ ...IVORY_INPUT, qty: 2.5, unit: 'pcs' }, CATALOG)).text).toMatch(/^DI_BAWAH_MINIMUM:/));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/price-tool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `priceTool.ts`**

- [ ] **Step 4: Write the failing loop test `tests/price-tool-loop.test.ts`**

Mock `getClient().messages.create`:
1. First response: two `tool_use` blocks for `hitung_harga`, one Kertas Supreme and one box.
2. Second response: `respond_to_customer`.

```ts
expect(result.toolFigures).toEqual(expect.arrayContaining([165000, 1980000, BOX_UNIT, BOX_TOTAL]));
expect(secondCallMessages.at(-1).content.filter((b) => b.type === 'tool_result')).toHaveLength(2);
```

- [ ] **Step 5: Wire it in**

- `callViaAPI`: add `PRICE_TOOL` to `tools`, keeping the tool order stable for prompt caching. Add a branch that pushes a `tool_result` and appends its figures to a turn-local `figures: number[]`. Attach `toolFigures: figures` to whatever `extractFromToolInput` returns, the failsafe path included.
- `callViaAgentSDK`: register `tool(PRICE_TOOL_NAME, desc, PriceToolInput.shape, …)`, collecting figures the same way.
- In the same edit, remove `SEARCH_TOOL` and its branches from both paths, along with `runSearchTool` and the `legacySearch.ts` import. Delete `src/services/legacySearch.ts`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/price-tool.test.ts tests/price-tool-loop.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A src tests && git commit -m "hitung_harga: code-side tier quote in both Claude call paths"
```

---

### Task 6: Strict price check

**Files:**
- Modify: `src/services/replyChecks.ts` (add `verifyReplyTieredPrices`), `src/services/aiLayer.ts` (`verifyFit`)
- Test: `tests/reply-checks-tiered.test.ts`

**Interfaces:**
- Consumes: `AIResponse.toolFigures` (Task 5), the catalog block format (Task 3)
- Produces:
```ts
export function verifyReplyTieredPrices(message: string, catalogBlock: string, toolFigures: number[] | undefined):
  { ok: boolean; reason: string; invented?: number[]; onlyInvented?: boolean };
```
Rules (§7.5):
- If `toolFigures?.length`, every `extractPrices(message)` figure must be in `toolFigures`.
- Otherwise, every figure must be in `extractPrices(catalogBlock)`, and no figure may sit on a `TOTAL_LINE_RE` line.
- `invented` = the failing figures. `onlyInvented` = every failing figure is on a `TOTAL_LINE_RE` line. This keeps `withoutInventedTotals` working.
- The reason is Indonesian and tells the model to call `hitung_harga` and repeat its figures.

- [ ] **Step 1: Write the failing tests**

```ts
const BLOCK = formatProducts([IVORY_FIXTURE]); // tiers 2.000 / 1.800 / 1.500 per pcs
it('accepts the tool figures', () => expect(verifyReplyTieredPrices('8 rim: Rp 2.000/pcs, total Rp 8.000.000', BLOCK, [2000, 8000000, 1800]).ok).toBe(true));
it('rejects a wrong-tier catalog price when the tool ran', () => expect(verifyReplyTieredPrices('8 rim: Rp 1.500/pcs', BLOCK, [2000, 8000000, 1800]).ok).toBe(false));
it('accepts listing tiers with no tool call', () => expect(verifyReplyTieredPrices('mulai Rp 2.000/pcs, 10 rim Rp 1.800/pcs', BLOCK, undefined).ok).toBe(true));
it('rejects a total with no tool call', () => {
  const v = verifyReplyTieredPrices('Total Rp 8.000.000', BLOCK, undefined);
  expect(v.ok).toBe(false); expect(v.onlyInvented).toBe(true);
});
it('rejects 500 × a per-pcs price posing as a per-rim price', () => expect(verifyReplyTieredPrices('Rp 1.000.000/rim', BLOCK, undefined).ok).toBe(false));
it('accepts figures from two tool calls in one turn', () => expect(verifyReplyTieredPrices('Rp 165.000/rim … Rp 2.000/pcs', BLOCK, [165000, 1980000, 2000, 8000000]).ok).toBe(true));
it('a reply with no price passes', () => expect(verifyReplyTieredPrices('Boleh tahu ukurannya kak?', BLOCK, []).ok).toBe(true));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/reply-checks-tiered.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement it and rewire `verifyFit`**

In `verifyFit`'s `results`:
- Replace `prices` with `verifyReplyTieredPrices(r.message, catalogBlock, r.toolFigures)`.
- Remove `verifyReplyTier`, `verifyReplyPacks`, `verifyReplyDiscount`, `verifyReplyShowroomLink` and `verifyReplyOtherBrand`.
- Pass `null` where `customerType` was used: catalog claim, opener.

Then remove the whole buyer-type machinery: the `savedType` / `CUSTOMER_TYPE_LINE` parsing, the `askBuyerType` branch and `withBuyerType` (the judge gets `situation` directly). The `withoutInventedTotals` fallback stays as is.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/reply-checks-tiered.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src tests/reply-checks-tiered.test.ts && git commit -m "Strict price check: tool figures or exact catalog tiers only"
```

---

### Task 7: Turn output, PO form, reference photos, price-list rule

**Files:**
- Modify:
  - `src/services/aiLayer.ts`: `RESPOND_FIELD_DESC`, `RESPOND_TOOL`, `RESPOND_SHAPE`, `extractFromToolInput`
  - `src/domain/types.ts` (`AIResponse`)
  - `src/services/messageRouter.ts`: the two send sites near the old `imageUrl` handling, lines ~527 and ~744
  - `src/services/catalogDelivery.ts`
  - `src/repositories/appSettings.ts`, `src/domain/constants.ts`
- Test: `tests/catalog-delivery.test.ts` (rewrite), `tests/messageRouter-debounce.test.ts` (add cases), `tests/turn-output.test.ts`

**Interfaces:**
- Produces:
```ts
// AIResponse: remove imageUrl and customerType; add
sendPoForm?: boolean; imageUrls?: string[]; toolFigures?: number[]; // (toolFigures from Task 5)
// appSettings.ts
export const PO_FORM_PLACEHOLDER_URL = 'https://forms.gle/REPLACE-ME';
export async function getPoFormUrl(): Promise<string>;
export async function setPoFormUrl(url: string): Promise<void>; // https only, else throw
// constants.ts
export function poFormMessage(url: string): string; // `Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏\n${url}`
// catalogDelivery.ts
export function brandsInText(text: string): BrandSlug[]; // /supreme|kertas (nasi|bungkus)|greaseproof/i → kertas_supreme; /box|dus|karton|kardus/i → imperial_indopack
export function hasPricedItem(items: unknown): boolean; // some item has product, size and qty
export async function resolveCatalogDelivery(contactId: string | null, text: string, opts?: { explicit?: boolean; fresh?: { facts?: Record<string, unknown> } }): Promise<CatalogDelivery>;
```
`BrandSlug` = `'imperial_indopack' | 'kertas_supreme'`. Export it from `src/domain/orderProfile.ts`; Task 8 creates that file, so create it here with just the type if Task 8 has not run.

Respond tool changes:
- drop `customer_type` and `image_url`
- add `send_po_form` (boolean): description "true only on the turn the customer clearly agrees to buy at the quoted price"
- add `image_urls` (array of string, max 3): description "reference photo urls of the product you recommend, copied from the catalog block"

`extractFromToolInput` keeps at most 3 `image_urls` that start with `/` or `http`.

Price-list rule (§7.3):
- Trigger: a price request (`/harga|price ?list|pricelist|berapa/i`) and `!hasPricedItem(profile.items)`.
- Brands: `profile.brands` ∪ `brandsInText(text)`.
- Send each brand's `catalogFileUrl`, once per conversation per brand (keyed `${contactId}:${brand}`) unless `explicit`.
- No brand known → note: `Merek belum jelas: tanyakan dulu barang apa yang mau dikemas, JANGAN bilang daftar harga sudah dikirim.`

- [ ] **Step 1: Write the failing tests**

```ts
// catalog-delivery.test.ts (mock getContactProfile and listBrands as the current file does)
it('the bare ad text sends the Kertas Supreme price list from an empty profile', async () => {
  const d = await resolveCatalogDelivery(C, 'berapa harga kertas supreme?');
  expect(d.files.map((f) => f.url)).toEqual([SUPREME_PDF]);
});
it('both brands in the profile send both files', ...);
it('an unknown brand sends nothing and asks what they pack', async () =>
  expect((await resolveCatalogDelivery(C, 'berapa harganya kak?')).note).toMatch(/barang apa yang mau dikemas/));
it('a priced item sends no file', ...);
it('the same brand is not resent in the same conversation', ...);
// turn-output.test.ts
it('keeps at most three image urls and ignores non-urls', () =>
  expect(extractFromToolInput({ message: 'x', confidence: 'high', fit_basis: [], image_urls: ['/a','/b','/c','/d','javascript:x'] }).imageUrls).toEqual(['/a','/b','/c']));
// messageRouter-debounce.test.ts (follow the file's mockBuildContextAndCallAI pattern)
it('sends the PO form link from settings after the reply when sendPoForm', ...); // expect sendTextMessage 2nd call body === poFormMessage(PO_URL)
it('sends each reference image in order and records each', ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/catalog-delivery.test.ts tests/turn-output.test.ts tests/messageRouter-debounce.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Let `tsc --noEmit` list every `imageUrl` and `customerType` site, and fix each one. In `messageRouter`, images send after the text, then the PO message (`await getPoFormUrl()`), each with `recordOutboundMedia` or `insertMessage` the way the existing sends do. `priceListConfirmed` and `companyCatalogue` are deleted.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/catalog-delivery.test.ts tests/turn-output.test.ts tests/messageRouter-debounce.test.ts && npx tsc --noEmit`
Expected: the new cases PASS and tsc exits 0. Old debounce cases that assert buyer-type behaviour may fail; Task 13 handles them.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Turn output: PO form, up to 3 reference photos, price list by brand"
```

---

### Task 8: Array-aware profile merge

**Files:**
- Create: `src/domain/orderProfile.ts`
- Modify: `src/repositories/contactProfiles.ts` (`upsertContactProfile`: read-merge-write under `SELECT … FOR UPDATE` in a transaction, instead of `jsonb ||`)
- Test: `tests/order-profile.test.ts` (pure), with one DB case added to the same file

**Interfaces:**
- Produces:
```ts
export type BrandSlug = 'imperial_indopack' | 'kertas_supreme';
export interface OrderItem { product?: string; size?: string; gsm?: string; print?: string; qty?: number; qty_unit?: 'rim' | 'pcs'; has_design?: boolean }
export function itemKey(i: OrderItem): string; // lower(product) + '|' + normalizeSize(size)  (normalizeSize from Task 5)
export function mergeOrderFacts(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown>;
export function orderDetailsSummary(facts: Record<string, unknown>): string; // used by Task 9
```

- [ ] **Step 1: Write the failing tests**

```ts
it('unions brands', () => expect(mergeOrderFacts({ brands: ['kertas_supreme'] }, { brands: ['imperial_indopack'] }).brands).toEqual(['kertas_supreme', 'imperial_indopack']));
it('appends a new item and keeps the old one (paper → boxes)', () =>
  expect((mergeOrderFacts({ items: [SUPREME_30] }, { items: [BOX_20] }).items as OrderItem[])).toHaveLength(2));
it('updates only the sent fields of a known item, size spelled differently', () =>
  expect(mergeOrderFacts({ items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 5, qty_unit: 'rim' }] },
    { items: [{ product: 'kertas supreme 64 gsm', size: '30 x 30 cm', qty: 10 }] }).items)
    .toEqual([{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10, qty_unit: 'rim' }]));
it('plain keys overwrite', () => expect(mergeOrderFacts({ name: 'A' }, { name: 'B' }).name).toBe('B'));
it('ignores a brand that is not a known slug', () => expect(mergeOrderFacts({}, { brands: ['legacy'] }).brands).toEqual([]));
it('summarises the six details for staff', () =>
  expect(orderDetailsSummary({ name: 'Budi', business_name: 'RM Siang', items: [SUPREME_30] })).toBe(
    'Nama: Budi\nUsaha: RM Siang\nBarang: Kertas Supreme 64 gsm cetak 1 warna, 30x30, 5 rim, desain: belum ada'));
// DB: two upserts with different items leave both in contact_profiles.profile.items
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/order-profile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement it and switch `upsertContactProfile` to `mergeOrderFacts`**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/order-profile.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src tests/order-profile.test.ts && git commit -m "Profile items and brands accumulate across the chat"
```

---

### Task 9: Gap questions and the handoff summary

**Files:**
- Modify: `src/services/escalationHandler.ts` (`pickProfileGapQuestion`, the `notifyStaff` body in `escalateConversation`), `src/domain/constants.ts`
- Test: `tests/escalationHandler.test.ts` (replace the buyer-type and store-name cases)

**Interfaces:**
- Consumes: `orderDetailsSummary`, `OrderItem` (Task 8)
- Produces: in `constants.ts`, the exact copy below, replacing `ESCALATION_ASK_CUSTOMER_TYPE`, `ESCALATION_ASK_STORE_NAME`, `ASK_BUYER_TYPE_REPLY` and the old `ESCALATION_ASK_QUANTITY`:
```ts
export const ESCALATION_ASK_PRODUCT = 'Sambil menunggu, boleh tahu kak, kemasannya untuk produk apa? (mis. nasi, kebab, kue, katering)';
export const ESCALATION_ASK_SIZE = 'Sambil menunggu, boleh info ukurannya kak? (panjang x lebar, atau p x l x t untuk box)';
export const ESCALATION_ASK_QUANTITY = 'Sambil menunggu, kira-kira mau pesan berapa banyak kak? (minimal 2.500 pcs / 5 rim)';
export const ESCALATION_ASK_DESIGN = 'Sambil menunggu, apakah sudah ada desain atau logo yang mau dicetak kak?';
export const ESCALATION_ASK_BUSINESS_NAME = 'Sambil menunggu, boleh tahu nama usahanya kak?';
export const ESCALATION_ASK_NAME = 'Sambil menunggu, dengan kakak siapa saya bicara?';
```
`pickProfileGapQuestion(profile, recent)` keeps its signature and its two guards (non-sales handoff, `fresh`). It returns the first missing detail in this order:
1. product or `business_type`
2. size
3. qty
4. `has_design`
5. `business_name`
6. `name`

Read these from the merged facts. An item counts for each field it has.

- [ ] **Step 1: Write the failing tests**

```ts
it('asks the product first on an empty profile', () => expect(pickProfileGapQuestion(null, [])).toBe(ESCALATION_ASK_PRODUCT));
it('asks size once the product is known', () => expect(pickProfileGapQuestion(P({ items: [{ product: 'box' }] }), [])).toBe(ESCALATION_ASK_SIZE));
it('walks qty → design → business → name', ...);
it('never asks a question already sent in recent', ...);
it('stays quiet after a non-sales handoff', ...);
it('the staff notification includes the order summary', ...); // spy notifyStaff, expect body toContain('Barang: ')
it('never asks the buyer type', () => expect(JSON.stringify(ALL_RETURNED)).not.toMatch(/dijual lagi|dipakai sendiri|proyek/));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/escalationHandler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/escalationHandler.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src tests/escalationHandler.test.ts && git commit -m "Handoff asks the missing order detail and tells staff all six"
```

---

### Task 10: Prompt, canned replies, Legacy-only features off

**Files:**
- Modify:
  - `src/domain/constants.ts`: `SYSTEM_PROMPT_SECTIONS`, `SYSTEM_PROMPT_BEHAVIORAL_RULES`, the `CANNED_*` replies, `ASK_NAME_REPLY`; delete `LEGACY_BRANDS`
  - `src/services/aiLayer.ts`: `TOOL_USE_SEARCH_INSTRUCTION`, `JUDGE_SYSTEM_PROMPT`, `buildBrandContext`, `CUSTOMER_TYPE_LINE` use in `buildSystemPrompt`
  - `src/services/otherBrands.ts`: callers no longer use it; delete the file and its prompt note
  - `src/services/ragQuery.ts`: `detectBrand` returns a `BrandSlug` via `brandsInText`
  - `src/domain/promptSync.ts`, so the new defaults replace the shipped ones on deploy
- Test: `tests/prompt-sections.test.ts`, `tests/prompt-sync.test.ts`, `tests/prompt-warmup.test.ts` (update), `tests/prompt-content.test.ts` (new)

**Interfaces:**
- Produces: `SYSTEM_PROMPT_SECTIONS` with exactly these names, in order:
  `Identity`, `Mission`, `Tone`, `Brands`, `Order Details`, `Recommendations`, `Pricing`, `Design`, `PO Form`, `Rules`, `Escalation`.

Content requirements (§7.4). The wording is the builder's; the facts are fixed:
- **Brands:** what each brand sells, and the extra products (greaseproof, paper bag, paper sleeve, envelope) under Kertas Supreme until the client says otherwise.
- **Order Details:** the six details, one or two questions at a time, never re-ask.
- **Recommendations:** nasi padang, kebab or burger wrap → Kertas Supreme / greaseproof; catering, lunch or cookie box → Imperial Indopack box; takeaway → paper bag.
- **Pricing:**
  - call `hitung_harga` for any price for a quantity, and repeat its figures exactly
  - `DI_BAWAH_MINIMUM` → explain the minimum
  - `DI_ATAS_TINGKAT_TERATAS` / `TIDAK_ADA_DI_KATALOG` → `confidence: low`, the team calculates
  - say per pcs or per rim, and whether delivery is included
  - mention the next tier when the tool gives one
  - never quote a price from memory or for another customer
- **Design:** logo or artwork received → `has_design`; no design → `image_urls` from products marked `[FOTO REFERENSI TERSEDIA]`, else the team sends examples.
- **PO Form:** `send_po_form: true` only when the customer agrees to a quoted price; never type a link.
- **Identity:** the bot name is a placeholder `Admin` until the client picks one (§9 item 7).
- **Not in the prompt:** buyer type, reseller, showroom, MP or PRICELIST, discount tiers, Legacy.

`JUDGE_SYSTEM_PROMPT`'s domain line becomes `customer service penjual kemasan kertas dan box karton`.

`TOOL_USE_SEARCH_INSTRUCTION` keeps only the `web_search` paragraph about understanding unfamiliar terms, and the `resolve_link` paragraph, minus the reseller-store check. Add a `KALKULATOR HARGA (hitung_harga)` paragraph that restates the pricing rule.

- [ ] **Step 1: Write the failing test `tests/prompt-content.test.ts`**

```ts
const all = SYSTEM_PROMPT_SECTIONS.map((s) => s.content).join('\n') + SYSTEM_PROMPT_BEHAVIORAL_RULES;
it('has the Imperial Indopack sections in order', () => expect(SYSTEM_PROMPT_SECTIONS.map((s) => s.name)).toEqual(['Identity','Mission','Tone','Brands','Order Details','Recommendations','Pricing','Design','PO Form','Rules','Escalation']));
it('names both brands and the price tool', () => { expect(all).toContain('Imperial Indopack'); expect(all).toContain('Kertas Supreme'); expect(all).toContain('hitung_harga'); });
it('carries no Legacy business', () => expect(all).not.toMatch(/legacy|reseller|showroom|PRICELIST|engsel|handle pintu|dipakai sendiri/i));
it('canned replies carry no Legacy business', () => expect([CANNED_COMPLAINT_REPLY, CANNED_NON_SALES_REPLY, CANNED_STILL_CHECKING_REPLY, CANNED_UNSUPPORTED_MEDIA_REPLY].join(' ')).not.toMatch(/legacy|hardware/i));
```
In `tests/prompt-warmup.test.ts`, the expected tool list becomes `['web_search', 'resolve_link', 'hitung_harga', 'respond_to_customer']`, in the same order as the `tools` array.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/prompt-content.test.ts tests/prompt-warmup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the sections, rules and canned replies; remove the features listed under Files**

- [ ] **Step 4: Run the tests, including the prompt-sync test**

Run: `npx vitest run tests/prompt-content.test.ts tests/prompt-warmup.test.ts tests/prompt-sections.test.ts tests/prompt-sync.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A src tests && git commit -m "Imperial Indopack prompt and replies; Legacy-only features off"
```

---

### Task 11: Lead pass reads brands and items

**Files:**
- Modify: `src/services/leadInsights.ts` (`InsightsObject`, `PROMPT`, `planLeadInsights`, `applyLeadInsights`), `src/repositories/leads.ts` (add `mergeLeadOrderFields`)
- Test: `tests/lead-insights-parse.test.ts` (update), `tests/lead-insights-pass.test.ts` (add a case)

**Interfaces:**
- Consumes: `mergeOrderFacts`, `OrderItem`, `BrandSlug` (Task 8)
- Produces:
```ts
export async function mergeLeadOrderFields(leadId: string, add: { brands: BrandSlug[]; items: OrderItem[] }): Promise<void>; // additive, same rules as mergeOrderFacts, one UPDATE … RETURNING
```
Schema changes:
- drop `customer_type`, `product_sought` and `quantity`
- add `brands: z.array(z.enum(['imperial_indopack','kertas_supreme'])).catch([])` and `items: z.array(OrderItemSchema).catch([])`
- keep `lead_kind`, `stage`, `evidence`, `lost_reason`, `lead_temperature`, `business_name`, and add `name`

`PROMPT`'s first line becomes: "percakapan WhatsApp antara pelanggan dan tim penjualan Imperial Indopack / Kertas Supreme (box karton dan kertas bungkus makanan cetak)". Hot means a real wish to buy something we sell: asking a price, giving a quantity, size or design.

`applyLeadInsights` changes:
- calls `mergeLeadOrderFields` for the current lead when brands or items are non-empty and the lead `kind === 'lead'`
- `fillContactProfileGaps` gets `{ facts: { name, business_name } }` only, with no `customerType`

- [ ] **Step 1: Write the failing tests**

```ts
it('parses brands and items, dropping an unknown brand', () => {
  const r = parseInsights('{"lead_kind":"lead","brands":["kertas_supreme","legacy"],"items":[{"product":"Kertas Supreme 64 gsm","size":"30x30","qty":10,"qty_unit":"rim"}]}');
  expect(r.brands).toEqual(['kertas_supreme']); expect(r.items[0].qty).toBe(10);
});
// pass (DB): a chat about supreme then boxes leaves lead.brands = both and two items
```
Use whatever parse entry point the current parse test calls.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/lead-insights-parse.test.ts tests/lead-insights-pass.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lead-insights-parse.test.ts tests/lead-insights-pass.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src tests && git commit -m "Lead pass fills brands and items"
```

---

### Task 12: Leads API and settings

**Files:**
- Modify:
  - `src/repositories/leads.ts`: `listLeads` row and filter, `patchLead` input
  - `src/routes/dashboard/leads.ts`
  - `src/routes/dashboard/settings.ts`
  - `src/repositories/appSettings.ts`: `DEFAULT_LEAD_REOPEN_AFTER_DAYS = 90`
  - `src/services/leadsExport.ts`
  - `src/domain/schemas.ts`: the Zod bodies for patch and settings
- Test: `tests/leads-api-imperial.test.ts` (DB, uses `app.inject` like `tests/lead-detail-routes.test.ts`)

**Interfaces:**
- Produces, for Plan 2's dashboard:
  - `GET /api/v1/leads?brand=imperial_indopack|kertas_supreme`. Each row adds `brands: BrandSlug[]`, `items: OrderItem[]`, `name: string | null` (profile `name`) and `company: string | null` (profile `business_name`). `customerType` is removed from rows.
  - `PATCH /api/v1/leads/:id` accepts `brands?: BrandSlug[]` and `items?: OrderItem[]`. Staff values replace, they don't merge.
  - `GET|PATCH /api/v1/settings/po-form-url` → `{ url }`. Non-https is a 400.
  - `GET|PATCH /api/v1/settings/lead-reopen-months` → `{ months }`, 1–12, stored as `months × 30` in `lead_reopen_after_days`. GET returns `Math.round(days / 30)`.
  - The export columns add `Merek`, `Barang`, `Nama` and `Usaha`, and drop the customer type.
  - `POST /api/v1/products/:id/reference-images` (multipart, one image, stored the way `POST /api/v1/catalog/images` stores uploads) → `{ id, imageUrl }`. It refuses a 4th photo for a product with 409.
  - `DELETE /api/v1/reference-images/:id` → 204. Both call `invalidateCatalogCache()`.

- [ ] **Step 1: Write the failing tests**

```ts
it('filters leads by brand and returns brands, items, name and company', ...);
it('staff PATCH replaces items', ...);
it('po-form-url round-trips and refuses http', async () => {
  expect((await inject('PATCH', '/api/v1/settings/po-form-url', { url: 'http://x' })).statusCode).toBe(400);
});
it('reopen months store as days', async () => {
  await inject('PATCH', '/api/v1/settings/lead-reopen-months', { months: 3 });
  expect(await getLeadReopenAfterDays()).toBe(90);
  expect((await inject('GET', '/api/v1/settings/lead-reopen-months')).json().data.months).toBe(3);
});
it('defaults to 90 days with no row', ...);
it('uploads up to three reference photos and refuses a fourth', ...); // expect 4th statusCode 409
it('deleting a reference photo removes it from the catalog block', ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/leads-api-imperial.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/leads-api-imperial.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src tests && git commit -m "Leads API: brand filter, items, PO link and reopen-months settings"
```

---

### Task 13: Legacy test sweep and a green suite

**Files:**
- Modify or delete: every test still failing or still asserting Legacy behaviour.

- [ ] **Step 1: List what fails and what still mentions Legacy**

Run: `npx vitest run 2>&1 | grep -E "^ FAIL" | sed 's/ >.*//' | sort -u; grep -rliE "legacy|reseller|end_user|engsel|aomori|shind" tests`
Expected: a list. Work through it with the rules below.

- [ ] **Step 2: Apply the rules, file by file**

- **A test of engine behaviour** (debounce, takeover, sync, token pool, webhooks, lead stages): keep the assertion and swap the Legacy fixtures for Imperial ones.
- **A test of removed behaviour** (buyer type, MP/pricelist, packs, discounts, showroom, other brands, website search): delete the case. Delete the file if nothing is left.
- **A fixture labelled as production or customer text** (for example "verbatim from the production dump" or `legacy_prod_*`): replace it with synthetic Imperial text.

- [ ] **Step 3: Run the whole suite and the leftover check**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -4 && grep -rniI legacy src tests scripts | grep -viE "ported from|porting" `
Expected: tsc exits 0; `Test Files … passed`, with 0 failed; and the grep prints nothing.

- [ ] **Step 4: Commit**

```bash
git add -A tests src && git commit -m "Sweep Legacy tests; suite green"
```

---

### Task 14: Starter catalog draft from the client workbook

**Files:**
- Create: `scripts/draft-starter-catalog.ts`, `docs/client/README.md` (how to regenerate; the workbook stays outside the repo)
- Output (committed for client review): `docs/client/starter-catalog-draft.xlsx` (template from Task 4) and `docs/client/starter-catalog-skipped.md`

**Interfaces:**
- Consumes: `TEMPLATE_COLUMNS` (Task 4)
- Produces: `npx tsx scripts/draft-starter-catalog.ts "<path to workbook>" docs/client`

Rules:
- Read sheets `HARGA BOX` and `PRICE LIST CETAK`. A block starts at a cell beginning `PENAWARAN` (HARGA BOX) or a `Minimal order` / `Jumlah Order` header (PRICE LIST CETAK). Its tier rows follow: `N RIM / M PCS`, or `Min N Rim`, with the price in the next column. The `HARGA PER PCS` or `HARGA PER RIM` header gives the price unit. The `SUDAH` or `BELUM TERMASUK ONGKIR` line gives delivery.
- **A block is generic only when every word of its title is in:** `PENAWARAN HARGA BOX KERTAS SUPREME GREASEPROOF GRASEPROOF PAPERBAG PAPER BAG SLEEVE SLEVEE ENVELOPE IVORY KRAFT PE LUNCH CETAK WARNA FULL COLOR BLOCK BLOK LAMINASI NON POLOS GSM GR UKURAN UK CM X`, plus numbers and punctuation. Every other block goes to `starter-catalog-skipped.md` with its title only, never its prices.
- Brand: a title with BOX, IVORY, KRAFT or LUNCH → Imperial Indopack; everything else → Kertas Supreme (§9 item 2 is still open, so the client checks this).
- Size comes from `UKURAN` / `UK` text or the title; a block with no size is skipped and listed.

- [ ] **Step 1: Write the failing test `tests/draft-starter-catalog.test.ts` with an in-memory sheet fixture**

```ts
it('keeps a generic block and skips a customer-named one by title only', () => {
  const { rows, skipped } = extractBlocks(FIXTURE_SHEET); // PENAWARAN HARGA IVORY 270 GSM … / PENAWARAN HARGA BOX CONTOH RESTO BIRU 350 GSM …
  expect(rows.map((r) => r[1])).toEqual(['Box Ivory 270 gsm cetak full color']);
  expect(skipped).toEqual(['BOX CONTOH RESTO BIRU 350 GSM']);
  expect(JSON.stringify(skipped)).not.toMatch(/\d{3}\.?\d{3}/); // no prices in the skipped list
});
```
`extractBlocks(sheet: unknown[][]): { rows: unknown[][]; skipped: string[] }` is exported from the script.

- [ ] **Step 2: Run it to verify it fails, then implement, then run it to pass**

Run: `npx vitest run tests/draft-starter-catalog.test.ts`
Expected: first FAIL, then PASS.

- [ ] **Step 3: Generate the draft from the real workbook and import it into the local DB**

Run: `npx tsx scripts/draft-starter-catalog.ts "$HOME/Downloads/Book1penawaran harga (2).xlsx" ../docs/client`, then import the draft with `importCatalogFromXlsx`, for example through `POST /api/v1/catalog/import` on a dev server.
Expected: the draft opens in Excel, the import reports 0 errors, and `getFullCatalogBlock()` lists tier lines.

- [ ] **Step 4: Commit the script, the test and the draft. Do not commit the workbook.**

```bash
git add scripts/draft-starter-catalog.ts tests/draft-starter-catalog.test.ts ../docs/client && git status --short | grep -i "penawaran" ; git commit -m "Starter catalog draft for client review"
```
Expected: the `grep` prints nothing.

---

## After this plan

- **Plan 2: dashboard.** Copy `legacy-dashboard` and adapt the Leads, Catalog (tiers and reference photos) and Settings pages to the endpoints in Task 12 (§7.9).
- **Client inputs** (§9): two note lines, the brand mapping, a reviewed catalog, price-list files, photos, the PO link, the bot name, and the WhatsApp provider.
