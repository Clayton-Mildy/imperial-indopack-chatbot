# Client starter catalog

`starter-catalog-draft.xlsx` is the draft catalog in the dashboard's import template (sheet
`Katalog`, one row per price tier), built from the client's quote workbook: a history of ~430
quotes, mostly addressed to named customers. The bot may only quote generic catalog prices, never
another customer's negotiated price, so the script is strict and fails closed.

Rules (see `api/scripts/draft-starter-catalog.ts`):
- Only the `HARGA BOX` sheet is read. `PRICE LIST CETAK` is NOT used: every table in it sits under a
  customer or shop header. Kertas Supreme prices need a real generic price list from the client.
- A block is kept only when every word of its title is a generic product word. A customer-named
  title taints every block below it in the same column until the next customer title, so a later
  "CETAK 1 WARNA" table under a customer header is skipped too. Empty titles are skipped.
- A product + size + tier that appears with different prices in different blocks is treated as
  negotiated, and all of it is dropped. Single-tier blocks of 100 rim or more, suspicious price
  units (per pcs above 20.000, per rim below 20.000) and prices that rise with quantity are dropped.

**Check the draft before importing it for real.** At the time of writing, every generic-titled
block in the workbook sits under a customer title, so the draft may hold no rows at all; a usable
starter catalog needs a generic price list from the client.

## Regenerate

The workbook stays outside the repo (never commit it). From `api/`:

```bash
npx tsx scripts/draft-starter-catalog.ts "<path to workbook>.xlsx" ../docs/client
```

The script validates every row with the catalog template parser and fails on any error. It also
writes `starter-catalog-skipped.md`: titles of dropped blocks with the reason, never prices. That
file names customers, so it is **local only** and git-ignored.
