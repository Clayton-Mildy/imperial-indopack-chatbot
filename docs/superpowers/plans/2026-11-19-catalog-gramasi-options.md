# Catalog Gramasi Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One catalog product holds several gramasi, each with its own sizes, price tiers and stock. The editor, Excel, bot, price calculator and lookups all work in that shape, and the bot quotes every gramasi when the customer names none.

**Architecture:** A nullable `gsm` column on `product_variants` (size rows). One small domain module, `api/src/domain/gramasi.ts`, owns normalising, comparing and listing gramasi; every reader uses it. The product spec line keeps only Cetak and Finishing. Price tiers, the price check and reply checks keep reading size rows and "Rp" figures, so they need no change in shape.

**Tech Stack:** Fastify 5, Drizzle + Postgres, Vitest 3 (API); Next.js 16, Vitest 3 pure-lib tests (dashboard).

**Spec:** `docs/superpowers/specs/2026-11-19-catalog-gramasi-options-design.md` (§ numbers below refer to it). Interface map with file:line detail: `/private/tmp/claude-501/-Users-claytonmildy-WidaProject-FDE-Projects-imperial-indopack-chatbot/e80d50a5-9a8e-4c0f-9428-1a73522b754b/scratchpad/gramasi-interface-map.md`. Line numbers there are as of commit 5dddfa8.

## Global Constraints

- Work only in the worktree `.worktrees/catalog-gramasi-options` on branch `catalog/gramasi-options`. Never edit the main checkout: the live bot runs `tsx watch` from it.
- API tests run only against `imperial_indopack_test` with `WHATSAPP_TRANSPORT=capture`. The worktree's `api/.env` is already set up for that. Never print or commit any `.env`. Never migrate or write the live database `imperial_indopack`.
- After adding a migration, apply it to the test DB before running tests: `MIGRATIONS_DIR=src/db/migrations npx tsx scripts/migrate.ts` (in `api/`).
- Migrations are hand-written SQL with `--> statement-breakpoint` between statements, plus an entry in `api/src/db/migrations/meta/_journal.json` (`idx: 30`, `when` > 1794400000000, `tag: "0030_variant_gramasi"`, `breakpoints: true`).
- Canonical gramasi text is `"<n> gsm"`, e.g. `"300 gsm"`. "300", "300gsm" and "300 GSM" are the same gramasi.
- A product is either all-gramasi or no-gramasi: every size row has a gsm, or none does (§6.1).
- Cetak and finishing stay on the product. Kegunaan, photos and the active switch stay on the product.
- Customer-facing copy is Indonesian. The fixed gramasi question is exactly: `Sebelum form PO-nya saya kirim, mau yang gramasi berapa kak: <list>?`, where `<list>` is e.g. `270, 300 atau 350 gsm` (comma-separated, last two joined with " atau ", "gsm" once at the end).
- Every dashboard i18n key goes in both `dashboard/lib/i18n/id.ts` and `en.ts`.
- Test data is synthetic only: names containing "Contoh" or "(CONTOH)", phones 0812-0000-00NN. Never name the source project this code was adapted from.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Same size under two gramasi where the quantity is below one gramasi's minimum and not the other's. Each line gets its own outcome, and the quote line's figures are allowed (Task 6 test).
2. A customer who says "yang tebal" or "yang paling murah" instead of a number, so the model records a non-gramasi word as gsm. The PO guard treats it as not chosen and asks (Task 8 test).
3. Excel rows writing "300" in one row and "300 gsm" in another for the same size. They form one size row, not two (Task 2 test).
4. The editor renaming a gramasi to one the product already has (270 → 300 while 300 exists) with an overlapping size. Refused as `duplicate_size`, not silently merged (Task 3 test).
5. One gramasi of a size out of stock. That line says stock is empty, and the others are still quoted (Task 6 test).

---

### Task 1: Data layer: column, migration, gramasi module, spec line

**Files:**
- Create: `api/src/domain/gramasi.ts`, `api/src/db/migrations/0030_variant_gramasi.sql`, `api/src/db/migrations/0030_variant_gramasi.down.sql`, `api/tests/gramasi.test.ts`, `api/tests/migration-0030.test.ts`
- Modify: `api/src/db/migrations/meta/_journal.json`, `api/src/db/schema.ts` (productVariants + unique index), `api/src/domain/types.ts` (ProductVariant), `api/src/repositories/products.ts` (`mapVariant`, `createVariant`, `updateVariant` data types), `api/src/domain/productSpec.ts`, `api/tests/product-spec.test.ts`, `api/tests/price-fixtures.ts` (`variant()` default `gsm: null`)

**Interfaces:**
- Produces, in `api/src/domain/gramasi.ts`:
  - `normalizeGsm(raw: string | number | null | undefined): string | null`: numeric forms become `"<n> gsm"`; other text is trimmed with spaces collapsed; empty becomes null.
  - `sameGsm(a: string | null | undefined, b: string | null | undefined): boolean`: compares normalised values; null equals null.
  - `compareGsm(a: string | null, b: string | null): number`: null first, then numeric ascending, then non-numeric alphabetical.
  - `formatGsmList(gsms: string[]): string`: e.g. `"270, 300 atau 350 gsm"`; a single value gives `"300 gsm"`.
  - `gramasiOfSize(product: Product, size: string): string[]`: distinct non-null gsm of the product's ACTIVE size rows whose `normalizeSize(name)` equals `normalizeSize(size)`, sorted by `compareGsm`.
- Produces: `ProductVariant.gsm: string | null`. `ProductSpec` becomes `{ print: string | null; finishing: string | null }`. `parseProductSpec` still recognises and DROPS a `Gramasi:` segment, so old descriptions read cleanly.

- [ ] **Step 1: Write failing tests.**
  - `gramasi.test.ts`:
    - `normalizeGsm` maps `'300'`, `300`, `'300gsm'` and `' 300 GSM '` to `'300 gsm'`; `''` and `null` to `null`; `'Tebal'` to `'Tebal'`.
    - `sameGsm('300', '300 gsm')` is true; `sameGsm(null, null)` is true; `sameGsm('270 gsm', '300 gsm')` is false.
    - `['350 gsm', null, 'art', '270 gsm'].sort(compareGsm)` gives `[null, '270 gsm', '350 gsm', 'art']`.
    - `formatGsmList(['270 gsm', '300 gsm', '350 gsm'])` gives `'270, 300 atau 350 gsm'`; `formatGsmList(['300 gsm'])` gives `'300 gsm'`.
    - `gramasiOfSize` returns `['270 gsm', '300 gsm']` for a product with 20x20x7 under both, skips an inactive row, and returns `[]` for an absent size.
  - `product-spec.test.ts`:
    - `formatProductSpec({print:'1 warna', finishing:null})` gives `'Cetak: 1 warna'`.
    - `parseProductSpec('Gramasi: 270 gsm · Cetak: 1 warna')` gives `{print:'1 warna', finishing:null}`.
  - `migration-0030.test.ts`:
    - Insert a product (name prefix `__mig0030__`) with description `'Gramasi: 270 gsm · Cetak: 1 warna · Teks bebas'` and two size rows with gsm null.
    - Run the data statements of `0030_variant_gramasi.sql`: read the file, split on `--> statement-breakpoint`, run each with `sql.raw`. Every statement is idempotent.
    - Assert both rows have gsm `'270 gsm'` and the description is `'Cetak: 1 warna · Teks bebas'`.
    - A product with description `'Gramasi: 64 gsm'` ends with description `null`.
    - Inserting a second `20x20x7` row under `'300 gsm'` succeeds, and a duplicate under `'270 gsm'` fails on the unique index.
- [ ] **Step 2:** Run `npx vitest run tests/gramasi.test.ts tests/product-spec.test.ts tests/migration-0030.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Write `gramasi.ts`.
  - Schema: add `gsm: text('gsm')`, and replace `uq_variant_name_per_product` with `uq_variant_gsm_name_per_product` on `(product_id, coalesce(gsm, ''), name)`. In Drizzle, use `uniqueIndex(...).on(table.productId, sql\`coalesce(${table.gsm}, '')\`, table.name)`.
  - Migration SQL, every statement idempotent:
    - `ADD COLUMN IF NOT EXISTS gsm text`;
    - drop the old index if it exists;
    - create the new one if missing;
    - an `UPDATE product_variants v SET gsm = …` taking the `Gramasi:` value from the product's description, run only where `v.gsm IS NULL` and the description has a `Gramasi:` segment; values are normalised to `"<n> gsm"` when numeric;
    - an `UPDATE products` rewriting the description without the `Gramasi:` segment (segments joined by `' · '`; NULL when nothing is left).
  - `.down.sql`:
    - a `DO $$ … RAISE EXCEPTION` when any product has the same size name under two gsm values;
    - otherwise prepend `Gramasi: <gsm> · ` to each product's description from its single gsm, then drop the column and restore the old index.
  - Journal entry. Then `mapVariant`, the types and `productSpec.ts`.
- [ ] **Step 4:** Apply the migration to the test DB (Global Constraints). Run the three test files, then the full API suite with `npx vitest run`. Expected: the new tests pass. Fix only failures caused by `ProductVariant.gsm`, i.e. fixtures missing the field.
- [ ] **Step 5:** `npx tsc --noEmit` clean. Commit: "Gramasi on size rows: column, migration 0030, gramasi helpers; spec line keeps cetak and finishing".

### Task 2: Excel import and export

**Files:**
- Modify: `api/src/services/catalogTemplate.ts`, `api/src/services/catalogImport.ts`, `api/src/services/catalogExport.ts` (if `buildTemplateRows` moves), `api/tests/catalog-template.test.ts`, `api/tests/catalog-template-import.test.ts`, `api/tests/catalog-import-preview.test.ts`

**Interfaces:**
- Consumes: `normalizeGsm` and `sameGsm` (Task 1).
- Produces: `TemplateVariant` gains `gsm: string | null`. Its `description` now holds Cetak/Finishing only.

Rules:
- The grouping key is product (lower case) + `normalizeGsm(Gramasi) ?? ''` + `normalizeSize(size)`.
- Product-level values (Cetak, Finishing, Kegunaan) must agree across a product's rows. A disagreeing row gets the error `Baris N: <Kolom> berbeda dari baris lain untuk produk "<Produk>".` and poisons that product, the way `failedProducts` already does.
- Mixing blank and filled Gramasi within one product in the file gives `Baris N: Gramasi kosong, padahal baris lain produk "<Produk>" punya gramasi.` (or the reverse wording) and poisons the product.
- Import (`importCatalogFromXlsx` and `previewCatalogImport`):
  - An existing size row matches on `sameGsm` + `normalizeSize`.
  - New rows insert with `gsm`.
  - If a product's file rows have gramasi while its stored rows have none (or the reverse), that product fails with one error naming its first file row. Nothing of it is written.
  - History "after" state carries `gsm` per size and no product gsm.
- Export: `buildTemplateRows` writes each size row's own `gsm` in the Gramasi column. Cetak/Finishing come from the description.

- [ ] **Step 1: Write failing tests.**
  - `catalog-template.test.ts`:
    - 'groups rows by product, gramasi and size': two rows "Box Contoh" 20x20 at gramasi `300` and `300 gsm` give one variant with 2 tiers; a third row at `270 gsm` gives a second variant (Review Focus 3).
    - 'a product whose rows disagree on Cetak is refused, naming the row'.
    - 'blank and filled Gramasi in one product are refused'.
    - 'round-trips build -> parse with two gramasi'.
    - Update 'joins … into the description' to Cetak/Finishing only.
  - `catalog-template-import.test.ts`:
    - 'imports one product with two gramasi of the same size as two size rows'.
    - 'a second import with the same file changes nothing'.
    - 'a file with gramasi for a stored product without gramasi is refused, and nothing of it is written'.
    - Update the `'Gramasi: 64 gsm'` description assertion: description is null, and the size row has gsm `'64 gsm'`.
  - `catalog-import-preview.test.ts`: 'a new gramasi of an existing size counts as a new size'.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement the rules above.
- [ ] **Step 4:** Run the three files and the full API suite. Expected: PASS.
- [ ] **Step 5:** Commit: "Excel: gramasi per row; product fields must agree; import matches gramasi + size".

### Task 3: Catalog editor API

**Files:**
- Modify: `api/src/services/catalogEditor.ts`, `api/src/routes/dashboard/catalogProducts.ts` (only if types force it), `api/tests/catalog-editor.test.ts`, `api/tests/catalog-products-routes.test.ts`, `api/tests/catalog-preview-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - `ProductDraftSchema`: product `gsm` removed; each size `{ id?, size, gsm: shortText.nullable(), tiers }`.
  - `ProductInput.sizes[]` and `CatalogProduct.sizes[]` gain `gsm: string | null`, stored normalised. `ProductInput` loses `gsm`.
  - New `ProductInputErrorCode`: `gsm_mixed` (with `sizeIndex` of the first row that breaks all-or-none).
  - `duplicate_size` now means the same `normalizeGsm` + `normalizeSize` twice.
  - `CatalogChange` adds `{ kind: 'gsm_added'; gsm: string }`, `{ kind: 'gsm_removed'; gsm: string }` and `{ kind: 'gsm_renamed'; from: string; to: string }`. `size_added | size_removed | size_renamed | tier_added | tier_removed | tier_price | delivery` gain `gsm?: string | null`.
  - The old `{ kind: 'field', field: 'gsm' }` stays in the union for history rows, but `diffProduct` no longer emits it.
  - `diffProduct` gramasi rules:
    - `gsm_renamed` when every stored row of gramasi X (by id) now carries Y and no row carries X;
    - `gsm_added` / `gsm_removed` for the remaining set differences;
    - size and tier changes inside a renamed gramasi report under the new name;
    - matching (`matchSizes`) is by id, then by `sameGsm` + `normalizeSize`.
  - `writeSizes` writes `gsm`.
  - `loadCatalogProducts` sorts sizes by `compareGsm(gsm)`, then the existing order.
  - `listCatalogProducts({search})` also matches a size's gsm.
  - `previewProduct` gives fake variants their `gsm`.

- [ ] **Step 1: Write failing tests.**
  - `catalog-editor.test.ts` (pure):
    - 'the same size under two gramasi is allowed'.
    - 'the same size twice under one gramasi is duplicate_size': `'300'` vs `'300 gsm'` counts as the same.
    - 'some sizes with gramasi and some without is gsm_mixed at the first breaking index'.
    - diffProduct 'renaming 270 to 280 on all its rows is one gsm_renamed';
    - diffProduct 'a new gramasi with copied sizes is gsm_added plus size_added under it';
    - diffProduct 'removing a gramasi is gsm_removed';
    - 'renaming a gramasi onto one that already has the same size is duplicate_size' (Review Focus 4).
    - Update fixtures: `DRAFT()` / `BOX` move gsm to their sizes.
  - `catalog-products-routes.test.ts`:
    - 'creates a product with 270 and 300 gsm and lists both under it', asserting sizes come back ordered 270 then 300;
    - 'a PUT renaming a gramasi keeps the size row ids'.
  - `catalog-preview-routes.test.ts`: 'preview groups sizes under their gramasi exactly as the bot reads them'. This depends on Task 5's block format. Write it in Task 5 if Task 5 is not done yet, and note that here.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three files and the full API suite. Expected: PASS.
- [ ] **Step 5:** Commit: "Catalog editor API: gramasi on each size, gsm_mixed, gramasi history entries".

### Task 4: Dashboard catalog logic, types and copy

**Files:**
- Modify: `dashboard/types/api.ts` (CatalogProduct, ProductDraft, ProductInputErrorCode, CatalogChange, PriceToolCall, NearestMatch), `dashboard/lib/catalog/productForm.ts`, `dashboard/lib/i18n/id.ts`, `dashboard/lib/i18n/en.ts`, `dashboard/tests/product-form.test.ts`

**Interfaces:**
- Consumes: Task 3 API shapes.
- Produces, as pure functions in `productForm.ts`. The UI stays a view over the flat `sizes[]`, so server `sizeIndex` errors keep working:
  - `SizeRow` gains `gsm: string`, and `ProductFormState` loses `gsm`.
  - `gramasiGroups(f: ProductFormState): { gsm: string; indexes: number[] }[]`: ordered as `compareGsm` would order them, with a copy of the API rule that parses numbers. A no-gramasi product returns one group with `gsm: ''`.
  - `addGramasi(f, gsm: string, copyFrom?: string): ProductFormState`: with `copyFrom`, it copies that gramasi's sizes and tier quantities with `priceIdr` empty and marks `copiedFrom`. Without it, it adds one empty size.
  - `setFirstGramasi(f, gsm: string): ProductFormState`: sets `gsm` on every row of a no-gramasi product (§6.1).
  - `renameGramasi(f, from: string, to: string): ProductFormState`.
  - `removeGramasi(f, gsm: string): ProductFormState`.
  - `toDraft` sends `gsm: optional(row.gsm)` per size.
  - `fromCatalogProduct` reads it.
  - `formErrors` adds a local `gsm_mixed` check and `text_too_long` for a size's gsm.
  - `describeChange` renders `gsm_added`, `gsm_removed` and `gsm_renamed`, and still renders old `field: gsm` rows.
- i18n keys (both languages):
  - `catalog.form.addGramasi` ("Tambah gramasi"), `catalog.form.renameGramasi` ("Ubah gramasi"), `catalog.form.removeGramasi` ("Hapus gramasi");
  - `catalog.form.copySizesFrom` ("Salin ukuran dari {gsm}"), `catalog.form.gramasiPrompt` ("Gramasi (mis. 300 gsm)"), `catalog.form.firstGramasiPrompt` ("Ukuran yang sudah ada ini gramasi berapa?");
  - `catalog.form.removeGramasiConfirm`;
  - `catalog.change.gsmAdded`, `catalog.change.gsmRemoved`, `catalog.change.gsmRenamed`;
  - error key for `gsm_mixed`.
  - Remove `catalog.form.gsm` only if nothing still uses it after Task 4b.

- [ ] **Step 1: Write failing tests in `product-form.test.ts`.**
  - `gramasiGroups` orders `300 gsm` before `350 gsm`, and gives one `''` group for a no-gramasi form.
  - `addGramasi(f, '350 gsm', '300 gsm')` copies the 300 sizes with every `priceIdr` empty and `minQty` kept.
  - `setFirstGramasi` sets gsm on all rows.
  - `renameGramasi` changes only that gramasi's rows.
  - `removeGramasi` removes only its rows.
  - `toDraft` carries gsm per size and no product gsm.
  - `formErrors` reports `gsm_mixed`.
  - `describeChange` renders each new kind and an old `field: gsm` row.
  - Update the `base()` fixture.
- [ ] **Step 2:** `npx vitest run tests/product-form.test.ts` (in `dashboard/`). Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS. Type errors in components are fixed in Task 4b, not here.
- [ ] **Step 5:** Commit: "Dashboard catalog logic: gramasi groups, add/copy/rename/remove, history copy".

### Task 4b: Dashboard editor screens

**Files:**
- Modify: `dashboard/components/catalog/ProductForm.tsx`, `dashboard/components/catalog/ProductCard.tsx`, `dashboard/components/catalog/ProductHistory.tsx` (only if needed). PriceCheckPanel changes in Task 6, which changes the price-check response.

**Interfaces:** Consumes the Task 4 functions only. The screen matches spec §5.2:
- the Gramasi input leaves the product section;
- the size list renders `gramasiGroups(form)` as sections with a heading, [Ubah gramasi] and [Hapus gramasi] (the delete uses the same confirm pattern as Hapus ukuran), its size cards, and "+ Tambah ukuran" inside the section;
- "+ Tambah gramasi" at the bottom asks for the gramasi and offers "Salin ukuran dari <gsm>" for each existing gramasi;
- on a no-gramasi product, the first Tambah gramasi asks `firstGramasiPrompt` for the existing sizes;
- ProductCard shows e.g. "270 · 300 · 350 gsm · Cetak 1 warna".

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run `npx tsc --noEmit` and `npx vitest run` in `dashboard/`. Expected: clean, PASS.
- [ ] **Step 3:** Commit: "Product editor: sizes grouped by gramasi, add/copy/rename/remove gramasi".

The visual check is in Task 9.

### Task 5: What the bot sees

**Files:**
- Modify: `api/src/services/ragQuery.ts` (`formatProducts`), `api/src/services/embeddings.ts` (`buildEmbeddingText` + its variant select adds gsm), `api/scripts/seed-embeddings.ts`, `api/src/services/aiLayer.ts` (judge prompt lines about gsm/variant names at ~417, ~424, ~426; `profile_update` item description at ~52), `api/src/services/catalogImages.ts` (`buildImageIndex`), `api/tests/catalog-block.test.ts`, `api/tests/catalog-images.test.ts`, `api/tests/catalog-preview-routes.test.ts`

**Interfaces:**
- Consumes: `compareGsm` (Task 1).
- Block format (§5.4). When the product has gramasi, its active size rows are grouped under a header line `  Gramasi <gsm>:` (2-space indent, no "Rp"), ascending. Each size and tier line keeps today's exact text. A product without gramasi prints exactly as today.
- Embedding text appends `Gramasi: 270 gsm, 300 gsm` when there are any.
- Image index: a size name under several gramasi of one product maps to all those rows. The label carries the gramasi: `<product> / <gsm> / <size>`.
- Judge prompt wording: a variant is "gramasi + ukuran"; a short name like "box ivory 300" for a product named "Box Makan Ivory" with a 300 gsm line is a summary, not a wrong name.

- [ ] **Step 1: Write failing tests.**
  - `catalog-block.test.ts`:
    - 'groups sizes under their gramasi in ascending order'. Assert the exact lines for a 270/300 product, with each tier line unchanged.
    - 'a product without gramasi renders exactly as before': the old snapshot string.
  - `catalog-images.test.ts`: 'a size under two gramasi indexes to both rows'.
  - `catalog-preview-routes.test.ts`: the grouping case carried over from Task 3.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the files above, then `tests/reply-checks-tiered.test.ts tests/fit-basis.test.ts`, then the full suite. Expected: PASS.
- [ ] **Step 5:** Commit: "Bot catalog block groups sizes by gramasi; search text and image index know gramasi".

### Task 6: Price calculator

**Files:**
- Modify: `api/src/services/priceTool.ts`, `api/src/services/aiLayer.ts` (both tool paths push `calls`), `api/src/routes/dashboard/catalogProducts.ts` (price-check returns `{text, calls}`), `api/src/services/leadDetailExtras.ts` (price-call match includes gsm), `dashboard/lib/conversations/labels.ts` (`toolLine` shows gsm), `dashboard/components/catalog/PriceCheckPanel.tsx` + `dashboard/actions/catalogActions.ts` + `dashboard/types/api.ts` (an optional gramasi select; the response is `{text, calls}`; one line per call), `api/tests/price-tool.test.ts`, `api/tests/price-tool-loop.test.ts`, `api/tests/price-fixtures.ts`, `dashboard/tests/conversation-labels.test.ts`

**Interfaces:**
- Consumes: `normalizeGsm`, `sameGsm`, `gramasiOfSize` and `formatGsmList` (Task 1).
- Produces:
  - `PriceToolInput.gramasi?: string`, which is optional in both the zod schema and the hand-written `PRICE_TOOL` JSON schema. Field description: "Gramasi the customer chose, e.g. '300 gsm'. Leave out when they have not chosen: the result then lists every gramasi of that size."
  - `PriceToolCall.gsm: string | null`.
  - `PriceToolResult` becomes `{ text: string; figures: number[]; calls: PriceToolCall[] }`, with `call` removed. Update every caller (aiLayer tally pushes `...calls`; the catalog price-check route; tests).
- Rules (§5.5 + §6.3, 6.6):
  - Several gramasi without `gramasi`: one line per gramasi. A quote line reads `<gsm>: Rp <unit>/<unit>, total Rp <total>, <delivery>.` with no next-tier line. Other lines read `<gsm>: stok habis`, `<gsm>: minimal <qty>` or `<gsm>: harga dihitung tim`.
  - The text starts with `HARGA: <product> ukuran <size>, <qty>, per gramasi:` when at least one line quotes. When none quotes, it takes the shared outcome's prefix, or `TIDAK_ADA_DI_KATALOG:` when the outcomes differ.
  - `figures` are exactly the quote lines' unit prices and totals.
  - A `gramasi` the size doesn't have gives `TIDAK_ADA_DI_KATALOG: <product> ukuran <size> tidak ada gramasi <g>. Gramasi yang ada: <formatGsmList>.`
  - The same gsm + size twice is still the duplicate error; the same size under different gsm is not.
  - A single-gramasi or no-gramasi product returns today's text exactly. Its `calls` has one entry with that row's `gsm`.

- [ ] **Step 1: Write failing tests in `price-tool.test.ts`.** Add a fixture product with 270/300 gsm at 20x20x7 to `price-fixtures.ts`, then:
  - 'no gramasi given lists every gramasi, ascending, with figures from the quote lines only';
  - 'a chosen gramasi quotes only that one, matching "300" to "300 gsm"';
  - 'a gramasi the size does not have is TIDAK_ADA with the list';
  - 'one gramasi out of stock: that line says stok habis, the other is quoted' (Review Focus 5);
  - 'below the minimum for one gramasi only: per-line outcomes, prefix HARGA' (Review Focus 1);
  - 'none quotes and all are below minimum: DI_BAWAH_MINIMUM';
  - 'single-gramasi product text is unchanged';
  - re-scope 'two variants with one size' to the same gsm.
  - `price-tool-loop.test.ts`: 'a several-gramasi call returns all quote figures to the tally'.
  - `conversation-labels.test.ts`: `toolLine` shows "300 gsm".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the price-tool tests, `tests/lead-detail-extras.test.ts`, the full API suite, and the dashboard suite. Expected: PASS.
- [ ] **Step 5:** Commit: "hitung_harga: optional gramasi; lists every gramasi when none is chosen".

### Task 7: Order items, nearest catalog, lead display

**Files:**
- Modify: `api/src/services/nearestCatalog.ts`, `api/src/services/orderPanel.ts`, `api/src/services/leadDetailExtras.ts`, `api/src/services/leadsExport.ts` (line ~78), `api/src/domain/orderProfile.ts` (`itemLine` uses `normalizeGsm`), `api/src/domain/orderDetails.ts` (same), `dashboard/lib/leads/items.ts` (`itemLine` shows gsm), `dashboard/components/conversations/OrderPanel.tsx`, `api/tests/nearest-catalog.test.ts`, `api/tests/order-panel.test.ts`, `api/tests/lead-detail-extras.test.ts`, `api/tests/order-profile.test.ts`, `dashboard/tests/leads.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers. `PriceToolCall.gsm` (Task 6).
- Produces:
  - `nearestCatalogItems(item: OrderItem, catalog: Product[]): NearestMatch[]` replaces `nearestCatalogItem`. `NearestMatch` gains `gsm: string | null`.
  - The product choice is unchanged.
  - With `item.gsm` (normalised) present in the product, only that gramasi's rows are considered, giving one match.
  - Without it, the closest size is found within each gramasi, giving one match per gramasi, ordered by `compareGsm`.
  - A no-gramasi product gives at most one match.
  - `exact` and `quote` are as today, per match.
- Callers:
  - `orderPanel` flattens the matches; out-of-catalog is any non-exact.
  - `leadDetailExtras` uses an exact match only when exactly one exists or the item's gsm picks it, and matches price calls on productName + variantName + `sameGsm`.
- Ruling: `itemKey` stays product + size, with no gsm. A customer who first asks without a gramasi and then picks one updates the same item (one gramasi per product + size). Cost if wrong: ordering two gramasi of one size at once records only the last.
- `leadsExport` prints `normalizeGsm(i.gsm)`, so "300 gsm" never becomes "300 gsm gsm".

- [ ] **Step 1: Write failing tests.**
  - `nearest-catalog.test.ts`: 'an item with gsm matches only that gramasi'; 'an item without gsm gets one match per gramasi, ascending'.
  - `order-panel.test.ts`: 'lists both gramasi of the nearest size'.
  - `lead-detail-extras.test.ts`: 'a quoted price is matched to the item's gramasi'.
  - `order-profile.test.ts`: 'orderDetailsSummary writes 300 gsm once whatever the stored spelling'.
  - A leadsExport case: 'an item gsm of "300 gsm" exports once'.
  - `dashboard/tests/leads.test.ts`: `itemLine` shows 'Box Contoh 20×20×7 · 300 gsm · 2.500 pcs'.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suites in both packages. Expected: PASS.
- [ ] **Step 5:** Commit: "Order panel and leads: nearest size per gramasi, gramasi shown once".

### Task 8: Selling rules: prompt and PO guard

**Files:**
- Create: `api/src/services/gramasiChoice.ts`, `api/tests/gramasi-choice.test.ts`
- Modify: `api/src/domain/constants.ts` (Pricing and PO Form sections, `gramasiBeforePoLine`, MESSAGE_SOURCE entry), `api/src/services/messageRouter.ts` (`onceOnlyFollowUp` and both send paths), `api/src/domain/promptSync.ts` (only if Pricing / PO Form are missing from `SECTIONS_TO_SYNC`), `api/tests/messageRouter-debounce.test.ts`, `api/tests/prompt-content.test.ts`

**Interfaces:**
- Consumes: `nearestCatalogItems` (Task 7), `gramasiOfSize` and `formatGsmList` (Task 1), `getCatalogProducts` (ragQuery).
- Produces:
  - `type GramasiChoice = { kind: 'chosen'; gsm: string } | { kind: 'only'; gsm: string } | { kind: 'ask'; options: string[] } | { kind: 'none' }`.
  - `gramasiChoice(item: OrderItem, catalog: Product[]): GramasiChoice`. The product is the one `nearestCatalogItems` picks, and the size must be an exact catalog size, otherwise `none`. Then, with options = `gramasiOfSize(product, item.size)`:
    - 0 options: `none`;
    - 1 option: `only`;
    - `item.gsm` sameGsm to an option: `chosen`;
    - otherwise: `ask` (including a recorded word such as "tebal", Review Focus 2).
  - `gramasiBeforePoLine(options: string[]): string`: the exact copy in Global Constraints.
  - `MESSAGE_SOURCE.gramasiQuestion = 'gramasi_question'`.
- Router (`onceOnlyFollowUp`, used by the text and photo paths). When `r.sendPoForm`:
  - read the merged order facts the way `poFormKindsFor` does, and `getCatalogProducts()`;
  - if any item is `ask`, set `poForm = null` and `followUp.gramasiQuestion = gramasiBeforePoLine(options of the first such item)`. The line goes out after the reply via `sendFixedLine` with the new source, like the PO line;
  - for every `only` item without that gsm, write the gsm into the saved profile (`upsertContactProfile` with an items patch, under its existing lock) before the PO message is built.
  - An unreadable catalog lets the form through (log a warning): the guard is a net, not a gate.
- Prompt:
  - Pricing: no gramasi named → call hitung_harga without `gramasi` and quote every line it returns, one short line each. Once the customer names or picks one → record `items[].gsm` and quote only that one.
  - PO Form: for a product with several gramasi and none chosen, don't set `send_po_form`; ask which first. Set it on the turn they pick, since they have already agreed. The recap names the gramasi.
  - Remove prompt lines that tell the model gsm is part of the product name (constants ~174-197, ~225, ~335). Keep the custom-gsm rule.

- [ ] **Step 1: Write failing tests.**
  - `gramasi-choice.test.ts`: chosen / only / ask / none, including `'300'` counting as chosen for `'300 gsm'`, `'tebal'` being `ask`, and an inexact size being `none`.
  - `messageRouter-debounce.test.ts`: add `vi.mock('../src/services/ragQuery.js', …)` returning a two-gramasi product; `it.each` over the text and photo paths:
    - 'holds the PO form and asks which gramasi when two gramasi offer the size': `sentTexts()` equals `['AI reply', gramasiBeforePoLine(['270 gsm','300 gsm'])]`;
    - 'sends the form when the item has a chosen gramasi';
    - 'fills the only gramasi into the profile and sends the form';
    - 'an unreadable catalog still sends the form'.
  - `prompt-content.test.ts`: Pricing mentions quoting every gramasi; PO Form says to ask the gramasi before the form.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full API suite. Expected: PASS.
- [ ] **Step 5:** Commit: "Bot quotes every gramasi; PO form waits for a chosen gramasi".

### Task 9: Demo and QA data, then end-to-end checks

**Files:**
- Modify: `api/src/services/demoCatalog.ts`, `api/tests/demo-catalog.test.ts`, `api/tests/go-live.test.ts` (only if counts are asserted), `api/scripts/qa/fixtures.ts`, `api/scripts/qa/setup.ts` (reference-photo product lookup), `api/scripts/qa/scenarios.ts` (product names in text and SQL), `api/scripts/draft-starter-catalog.ts` (gsm goes to the Gramasi column and leaves the name), `api/tests/draft-starter-catalog.test.ts`

**Data:**
- Demo (names without gsm, suffix `(CONTOH)`):
  - `Box Makan Ivory Cetak 1 Warna (CONTOH)` at 270 gsm and 300 gsm, sizes 20x20x7 and 16x16x6. The 300 gsm tiers are today's; the 270 gsm tiers are 2500/1150, 5000/1050, 10000/950.
  - `Kertas Nasi Cetak 1 Warna (CONTOH)` at 62 gsm (25x25, 30x30; 5/118000, 10/106000, 20/95000) and 64 gsm (today's tiers).
  - `Kertas Burger Cetak 1 Warna (CONTOH)` at 40 gsm and `Box Kue Ivory Cetak 1 Warna (CONTOH)` at 270 gsm, as single-gramasi products.
- QA fixtures:
  - `Kertas Supreme cetak 1 warna` at 64 gsm (today's sizes and tiers);
  - `Greaseproof polos` at 40 gsm;
  - `Box Ivory cetak full color` at 270 gsm (21 x 14 x 5 cm) and 310 gsm (20 x 20 x 7,5 cm), plus 270 gsm 20 x 20 x 7,5 cm at 5/1700, 10/1400, 20/1200, so one size has two gramasi.
  - Update scenarios and setup to the new names.

- [ ] **Step 1:** Update `demo-catalog.test.ts`: 'loads 4 products, two of them with two gramasi; loading twice does not duplicate'.
- [ ] **Step 2:** Run it. Expected: FAIL. Then implement the data changes, and run `npx vitest run` and `npm run typecheck:scripts`. Expected: PASS.
- [ ] **Step 3:** Commit: "Demo and QA catalogs in the gramasi shape".
- [ ] **Step 4: End-to-end, nothing committed except fixes.**
  - Stop any QA API on port 50071, then run `npm run qa:setup` (migrates and reseeds the QA DB, including prompts) and `npm run qa:api` in the background, from the worktree's `api/`. The worktree `.env` has `QA_DATABASE_URL`; check its database name is `imperial_indopack_qa` without printing it.
  - Replay with `npm run qa:say -- --base http://localhost:50071 --log logs/qa-capture.jsonl <phone> <text>`, phones 6281200000911-914. Expected:
    - "halo kak saya Contoh Rina dari Katering Contoh Rina", then "box 20x20 2500 pcs buat nasi kotak, logo ada": one reply with a line for 270 and a line for 310 gsm;
    - "yang 310 aja" then "oke ambil": the recap names 310 gsm, then the cetak form;
    - a new customer agreeing without picking: the fixed gramasi question and no form;
    - a 21 x 14 x 5 order: quoted as today, with no gramasi question.
  - Dashboard visual check: run the worktree dashboard on port 40071 against the QA API. Open a product with two gramasi, add a gramasi with "Salin ukuran dari", rename one, remove one, and confirm the bot-view preview groups by gramasi. Take screenshots for the report.
  - If anything fails, fix it with a test first, then commit.
- [ ] **Step 5:** Run the full suites and typechecks in both packages. Expected: all PASS. Report the test counts.
