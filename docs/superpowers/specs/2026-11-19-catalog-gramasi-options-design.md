# Catalog: gramasi as options inside one product

Date: 2026-11-19. Status: draft, for the user's approval.
Builds on: `docs/superpowers/specs/2026-11-18-imperial-indopack-chatbot-design.md` §7.1 (catalog model).

## 1. Intent

Today each gramasi is its own product: "Box Makan Ivory 300 gsm", "Box Makan Ivory 270 gsm" and so on,
each with the same sizes typed again. The user asked for one product per material and print, with
its gramasi inside it: one **Box Makan Ivory cetak 1 warna** holding 270, 300 and 350 gsm, each
gramasi with its own sizes and price tiers. That is how the client thinks about the catalog, and staff
stop maintaining the same box three times. The bot should sell the same way: when a customer does not
name a gramasi, it quotes all of them so the customer can pick.

## 2. Decisions made with the user (2026-11-19)

1. **Only gramasi moves inside the product.** Cetak (print colours) and finishing stay on the
   product. "Box Makan Ivory cetak 1 warna" and "Box Makan Ivory full color" stay two products, each
   with its gramasi inside. This matches the client's quote sheets, which keep a separate table per
   print type.
2. **A customer who names no gramasi gets a quote for every gramasi** of the product, for the size
   and quantity they asked about, one line per gramasi. The bot does not ask first and does not pick
   a default.
3. **Approach 1, gramasi on each size row** (section 4).

## 3. Goals, non-goals, anti-goals

Goals:
- One product can hold several gramasi. Each gramasi has its own sizes, price tiers and stock status.
- The product editor, the Excel import/export, the bot's catalog view, the price calculator and the
  dashboard's catalog lookups all work in that shape.
- A product with one gramasi, or none (e.g. a plain paper bag), works exactly as today.

Non-goals:
- Cetak or finishing as options inside a product.
- Fields of their own per gramasi (photo, Kegunaan, an on/off switch for a whole gramasi).
  Kegunaan, photos and the active switch stay on the product.
- Merging existing products automatically. The live catalog holds only the 4 demo products, and the
  client's real list will come in through Excel.
- Kertas Supreme's real prices (still waiting on the client's price list).

Anti-goals, which count as failures even if everything else works:
- The bot quotes a gramasi that does not exist for that size, or attaches one gramasi's price to another.
- A PO form goes out for a product with several gramasi before the customer has chosen one.
- An existing single-gramasi product changes behaviour, in the editor or in the bot.

## 4. Approaches considered

1. **Gramasi on each size row. Chosen.** `product_variants` (size rows) get a `gsm` column, so a row
   means "300 gsm, 20 × 20 × 7". Price tiers, stock status, the price check, lead items and the order
   panel keep working off size rows. It is the smallest change that does everything above, and the
   per-size stock switch already gives per-gramasi stock for free.
2. **A separate gramasi level** (product → gramasi → size → tiers). It is cleaner if a gramasi ever
   needs fields of its own, but nothing needs that now. It means a bigger migration, and every reader
   of the catalog changes.
3. **Keep one product per gsm and group them on screen.** This is the least database work, but
   Kegunaan, photos and the name still exist three times and drift apart, and the bot still sees three
   products. It works against the intent.

## 5. Design

### 5.1 Data

- New nullable column `product_variants.gsm` (text, e.g. "300 gsm"). Null means the product has no
  gramasi.
- A size row is unique per product + gramasi + size. The old unique index on (product, name) is
  replaced by one on (product, gsm treating null as empty, name).
- Gramasi leaves the product's spec line. `products.description` keeps only
  "Cetak: … · Finishing: …" (`domain/productSpec.ts` drops the gsm part).
- Gramasi text is normalised the way the price tool already compares it: "300gsm", "300 GSM" and
  "300 gsm" are one gramasi, stored as "300 gsm".
- Migration `0030`:
  - adds the column and swaps the unique index;
  - for every product, copies the "Gramasi: X" from its description onto all its size rows, then
    rewrites the description without it;
  - merges nothing.
  - It needs a down migration, following the repo's existing `.down.sql` pattern.

### 5.2 Product editor (dashboard)

The product section loses its Gramasi field. Merek, Nama produk, Cetak, Finishing and Kegunaan stay.

"Ukuran & harga" groups the size rows by gramasi:

```
Ukuran & harga                                   Harga per pcs · 1 rim = 500 pcs
┌ 270 gsm ─────────────────────── [Ubah gramasi] [Hapus gramasi] ┐
│  20 × 20 × 7    [Ubah ukuran] [Hapus ukuran]                    │
│    2.500 pcs (5 rim)   [ 1.234 ] /pcs   ☐ Sudah termasuk ongkir │
│    …                                                            │
│  + Tambah ukuran                                                │
└─────────────────────────────────────────────────────────────────┘
┌ 300 gsm ─ … ┐
+ Tambah gramasi
```

- **Tambah gramasi** asks for the gramasi. It offers "Salin ukuran dari <gramasi>", which copies that
  gramasi's sizes and tier quantities with the **prices left empty**. Empty prices must be filled
  before saving, using the same validation as today's empty tier price.
- **Ubah gramasi** renames it on all its size rows. **Hapus gramasi** removes its size rows, after
  the same confirmation as removing a size.
- A product whose rows have no gramasi shows one section with no heading, which is today's screen.
- The catalog list (`ProductCard.tsx`) shows the gramasi, e.g. "270 · 300 · 350 gsm".
- The product history records gramasi changes on the size rows, in place of the old product-level
  Gramasi field change.

### 5.3 Excel import and export

- The columns stay exactly as they are (`catalogTemplate.ts`). The Gramasi column becomes a
  **per-row** value. Rows with the same Merek + Produk + Gramasi + Ukuran form one size row, and each
  row adds a price tier, as today.
- Cetak, Finishing and Kegunaan stay product-level. They must agree across a product's rows, and a
  row that disagrees is an error naming the row.
- Export writes each size row's gramasi on its rows.
- An old file whose product names contain the gsm still imports, as separate products. Nothing is
  merged.

### 5.4 What the bot sees (catalog block, `ragQuery.formatProducts`)

Size rows are grouped under a gramasi line, in ascending gramasi order:

```
Produk: Box Makan Ivory cetak 1 warna — Cetak: 1 warna
Kegunaan: …
  Gramasi 270 gsm:
  - Ukuran: 20 x 20 x 7 cm
    • mulai 2.500 pcs (5 rim): Rp …/pcs, belum termasuk ongkir
  Gramasi 300 gsm:
  - Ukuran: 20 x 20 x 7 cm
    • …
```

- Rows with no gramasi print as today, with no gramasi line.
- Tier lines keep their exact format, so the reply price check parses them unchanged.
- The product text used for search (`embeddings.ts`) includes the gramasi list, so "300 gsm" still
  finds the product.

### 5.5 Price calculator (`hitung_harga`)

New optional input `gramasi`. The rules:

| Input | Result |
|---|---|
| `gramasi` given and the product has it for that size | Today's single quote |
| `gramasi` given but not available for that size | `TIDAK_ADA_DI_KATALOG:`, listing the gramasi that size has |
| No `gramasi`, and the product has one gramasi or none | Today's single quote |
| No `gramasi`, and several gramasi have that size | `HARGA:` with one line per gramasi, ascending. Each line is its own outcome: a quote, below the minimum, out of stock, or no tiers. All quoted figures go into the turn's allowed figures. If no gramasi quotes, the result takes the outcome the lines share, or `TIDAK_ADA_DI_KATALOG:` when they differ. |

- The dashboard's record of the call (`PriceToolCall`) holds one entry per gramasi line.
- A size that exists only under some gramasi is answered for those gramasi only.

### 5.6 Selling rules (prompt and code)

Prompt changes in Pricing and PO Form, in `domain/constants.ts`:
- A customer who names no gramasi: call `hitung_harga` without it and quote every gramasi it returns,
  one short line each, for the size and quantity asked.
- Once the customer names or picks a gramasi, record it on that order item (`items[].gsm`, which the
  order profile already has). From then on, quote only that gramasi.
- PO form: when the item's product has several gramasi and none is chosen, do not set
  `send_po_form`. Ask which gramasi first. Set it on the turn the customer picks one, since they have
  already agreed. The recap names the gramasi.

Code guard in the router, as a safety net for the prompt rule:
- On a `send_po_form` turn, the form is held back when an order item's product has several gramasi
  and the item has no gsm.
- In its place, a fixed line goes out naming that size's gramasi, e.g. "Sebelum form PO-nya saya
  kirim, mau yang gramasi berapa kak: 270, 300 atau 350 gsm?".
- The next turn's normal rules send the form once a gramasi is recorded.

### 5.7 Other readers of size rows

- **Order panel "Terdekat di katalog"** (`nearestCatalog.ts`): match the item's gsm when it has one.
  When it has none, the closest size is shown once per gramasi it exists in.
- **Leads:** item lines show the gramasi when set (`dashboard/lib/leads/items.ts`). The export
  carries it.
- **Go-live checks, catalog images, photo match:** checked to read nothing gramasi-specific from
  product names. Adjust only where they do.
- **Demo catalog and QA fixtures:** rewritten in the new shape, so the bot is tested on it:
  - one demo box product with 270 and 300 gsm;
  - one Kertas Supreme product with 62 and 64 gsm;
  - single-gramasi products kept as well.

### 5.8 Testing

- API unit tests:
  - the migration's gsm move (description → size rows);
  - template grouping and the conflicting Cetak/Kegunaan error;
  - every row of the price-tool table in 5.5;
  - the catalog block format;
  - the PO-form gramasi guard.
- Dashboard tests: editor grouping, add/rename/remove gramasi, and copying sizes with empty prices.
- QA replay on the QA API (port 50071), with synthetic customers:
  - "box 20x20 2500 pcs" gets one line per gramasi;
  - "yang 300 aja" then "oke ambil" gives a recap naming 300 gsm, then the form;
  - "oke ambil" without picking gets the gramasi question and no form;
  - a single-gramasi product behaves as today.

## 6. Calls made after the builder check (my calls, for the user to check)

1. **No mixing within a product.** Either every size row of a product has a gramasi, or none does.
   - Adding the first gramasi to a product with no gramasi asks which gramasi its existing sizes are,
     and sets it on all of them.
   - In an import, a blank Gramasi cell on a product whose rows have one (or the reverse) is an error
     naming the row.
   - Removing the last gramasi section removes its sizes, as removing sizes does today.
   - The import's match key for an existing size row becomes gramasi + size, not size alone
     (`catalogImport.ts`).
2. **The PO guard looks at the item's size, not the whole product.** It holds the form only when two
   or more gramasi offer that size and the item has no valid gramasi.
   - If one gramasi offers the size, the form goes, and code fills `items[].gsm` with it, so the recap,
     lead and order panel name it.
   - If the item has no size or no matching product yet, the form goes as today. The guard is a net
     for the gramasi case only.
3. **Code matches the customer's gramasi; the model doesn't.** "300", "300gsm" and "300 GSM" match
   the product's "300 gsm".
   - A recorded gsm counts as chosen only when that size actually has it. "350" on a 270/300 product
     is not a choice: the guard asks, listing 270 and 300.
   - The price tool returns `TIDAK_ADA_DI_KATALOG:` listing the gramasi that exist.
   - A gsm belongs to its order item. Switching to another product starts a new item, with no
     carried gsm.
4. **Migration leaves product names alone.** It moves gramasi onto the size rows and renames nothing,
   because real names could be anything. The demo catalog loader (`load-demo-catalog.ts`) and the QA
   fixtures are rewritten with names without gsm and reloaded.
   - Old lead items that say "… 300 gsm" are historical text; nearest-catalog matching still finds
     the product by its words.
   - The down migration fails with a clear message when any product has the same size under two
     gramasi. Otherwise it moves each product's single gramasi back into its description.
5. **The API and dashboard change together.** The editor's save payload moves gsm from the product to
   its sizes in one release, with no compatibility path, since both ship from this repo together.
   - Product history gets new entries for adding, renaming and removing a gramasi.
   - Old history rows with a product-level Gramasi change still render.
6. **A several-gramasi quote is one line per gramasi** at the asked quantity: unit price and total.
   - The next-tier hint is left out when there is more than one line, to keep the reply short.
   - The figures the reply may use are exactly the ones those lines print.

## 7. Left to the builder

- Exact wording of the price-tool lines and the fixed gramasi question, within the rules above.
- How the unique index treats null gsm (an expression index or an empty-string default).
- Component structure of the editor, as long as the screen matches 5.2.
- Gramasi sort order when the values are not numbers (alphabetical after the numeric ones).
