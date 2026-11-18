# Imperial Indopack chatbot: design

Date: 2026-11-18. Status: awaiting approval (builder check done; calls marked "my call" are open
to correction).
Starting point: `api/` is a faithful copy of Legacy's chatbot (see `docs/porting-from-legacy.md`).

## 1. What this is and why

A WhatsApp sales bot for one company that sells under two brands from **one shared WhatsApp number**:

- **Imperial Indopack:** thick printed karton (ivory, kraft) boxes, such as catering boxes, lunch
  boxes and cookie boxes. Mostly food packaging, but not only food.
- **Kertas Supreme:** thin wrapping paper (62/64/67 gsm) printed with the customer's logo, repeated
  across the sheet, for wrapping nasi padang, kebab or burgers. Designs are simple, usually one logo.

The client's quote history also shows greaseproof paper (40 gsm), paper bags, paper sleeves and
paper envelopes.

About 90% of chats start from an ad, with a default text such as "berapa harga kertas supreme?".
Customers often edit that text or want something else, so the template cannot be trusted.

The bot exists to turn those chats into orders. It collects the order details, quotes standard
items from a catalog, hands custom jobs to staff with the details already collected, and sends the
PO form when the customer agrees to a price. A CRM like Legacy's tracks each customer as a lead.

## 2. Goals

1. **Work out the brand and product from what the customer writes,** never from the ad template
   alone. A customer can want both brands in one chat.
2. **Collect the six order details:** customer name, business name, model, whether they have a
   design, quantity, and size (p × l, or p × l × t for a box). Ask one or two at a time and never
   re-ask something already answered.
3. **Help unsure customers** by asking what they sell or pack, then recommending the item type:
   wrap → Kertas Supreme or greaseproof; catering or lunch → karton box; takeaway → paper bag.
4. **Quote prices from the catalog only.**
   - A catalog item with known quantity → quote the tier price and the order total, both
     worked out by code (section 7.3, `hitung_harga`). Say whether the price is per pcs or per rim,
     and whether delivery is included.
   - A customer who only wants "the price" without details → send that brand's price list file,
     then ask for the details.
   - Anything not in the catalog (custom size, model or print) → say the team will calculate it,
     and hand off to staff with the details collected so far.
5. **Design references:** a customer without a design gets reference photos for that product type.
6. **PO form:** when the customer agrees to a price, the bot sends the PO Google Form link.
7. **CRM:** Hot/Cold, name, company, status, items with quantities, and brand tags, on one lead per
   customer.
8. **Legacy's lead rules carry over:** non-customers (couriers, suppliers, job seekers) go to
   Bukan Lead; a lead silent for the configured days becomes Lost; a Lost customer who returns
   after the configured window gets a new lead.

## 3. Non-goals (v1)

- **The bot does not calculate custom prices.** The client's costing (paper cost from
  g × p × l ÷ 20,000 = kg/rim × Rp/kg, plus printing, plates, die knife, die-cut, packing and
  delivery, see the `RINCIAN HARGA BOX` sheet) stays with staff.
- **No delivery-cost calculation.** The catalog says whether delivery is included; otherwise staff
  quote it.
- **No payment, invoicing or order confirmation.** The PO form is where the order is placed.
- **No separate leads per brand.** One lead per customer, tagged with one or both brands.
- **No campaign attribution.** Legacy's landing-page `Request ID` matching and UTM import stay in
  the code, dormant. These ads open WhatsApp directly, so there is no request ID.
- **No deploy design.** Hosting and the WhatsApp provider for Imperial Indopack are not decided yet
  (section 9).

## 4. Anti-goals: failure even if it technically works

- The bot states a price that is not in the catalog, or a tier that does not fit the quantity.
- The bot quotes another customer's negotiated price. The Excel holds per-customer quotes, such as
  Contoh Resto's or Contoh Kue'. These never enter the catalog.
- Internal data reaches a customer: costing, customer lists, delivery logs.
- The bot says an order is confirmed, paid or in production.
- The bot re-asks a detail the customer already gave, or loses the brand when a chat moves between
  boxes and paper.
- Legacy wording or rules leak through: hardware products, buyer-type questions ("dipakai sendiri
  atau dijual lagi?"), showroom links, Legacy brand names.

## 5. Constraints and facts

- **Units:** 1 rim = 500 sheets or 500 pcs. Prices are per pcs or per rim, in quantity tiers
  (typically 2, 5, 10, 20, 50 or 100 rim). Each tier is marked as including delivery or not.
- **Minimum order:** the client's note says 2,500 pcs (5 rim), but some past quotes start at 2 rim
  (1,000 pcs). Rule (my call): an item's minimum is its lowest catalog tier, with a 2,500 pcs
  fallback when an item has no tiers.
- **Standard plano sizes for Kertas Supreme:** 79 × 109, 90 × 120 and 65 × 100 cm. Customers order
  cut sizes such as 30 × 30 or 35 × 35.
- **How Kertas Supreme is priced:** per rim of 500 sheets *of the cut size*, by cut size, gsm and
  number of print colours. The workbook shows this (`Sheet1`: "1 rim isi 500 lembar", and the
  `PRICE LIST CETAK` blocks such as "Min 5 Rim, Rp 185.000 per rim, 30 × 30"). The plano sizes are
  what the factory cuts from; customers are never quoted per plano. A cut size that is not in the
  catalog (say 32 × 32) is a custom job and goes to staff.
- **Source material:** the client's workbook, `Book1penawaran harga (2).xlsx`, is not committed. It
  holds customer names and internal data. Only the generic quotes are extracted from it (section 7.2).
- **Language:** Indonesian, as in Legacy.
- **Stack:** stays as in Legacy: Fastify + Drizzle + Postgres (with pgvector, because migration
  0007 needs it) + Claude via the Anthropic SDK, with the OAuth token pool. Node 24.

## 6. Approaches considered

1. **Adapt the Legacy copy in place (chosen).** Keep the engine (webhook, debounce, AI turn, reply
   checks, handoff, staff takeover, lead stages) and replace the business layer (prompt, catalog,
   price checks, lead fields, settings). Switch Legacy-only features off rather than delete them.
   Chosen because it is the fastest way to a bot that behaves like Legacy's, as asked, and it
   keeps months of fixes: double replies, re-asking, leaked reasoning, token failover.
2. **Slim rewrite, like Vistaland's Moni.** Cleaner code, but it loses tested behaviour and every
   Legacy fix has to be found again. Slowest.
3. **Adapt, but delete Legacy-only features first.** Cleaner from day one, but buyer-type pricing
   is wired into the insights pass, the lead pass and the reply checks. Cutting it before the bot
   works risks breaking the parts being kept. Better as cleanup afterwards.

## 7. Design

### 7.1 Catalog model

Reuse Legacy's tables with a new meaning, and add a table for price tiers.

| Table | Meaning here | Examples |
|---|---|---|
| `brands` | the two brands; `catalog_file_url` holds each brand's price list file | Imperial Indopack, Kertas Supreme |
| `products` | a model or product type, with print and finish | "Box ivory cetak full color", "Kertas Supreme 64 gsm cetak 1 warna", "Greaseproof 40 gsm polos", "Paper bag 64 gsm cetak 1 warna" |
| `product_variants` | one size: a box's p × l × t, or Kertas Supreme's cut size (gsm and print colours belong to the product) | "20 × 20 × 7,5 cm", "30 × 30 cm" |
| **new** `variant_price_tiers` | one row per quantity tier | 5 rim / 2,500 pcs → Rp 1,500 per pcs, delivery included |

`variant_price_tiers` columns: `variant_id`, `min_qty` (integer), `qty_unit` (`rim` | `pcs`),
`price_idr`, `price_unit` (`pcs` | `rim`), `includes_delivery` (boolean), `note` (text, optional).

The Legacy-only variant columns (`mp_price_idr`, `isi_ctn`, `isi_box` and the `uom_*` ids) stay
in the schema, unused. `product_variants.price_idr` holds the lowest-tier price, so the existing
"has a price" filters keep working.

The full catalog goes into the system prompt as Legacy's does (`getFullCatalogBlock`, with
`FULL_CATALOG` on), with each variant's tiers on their own lines. The catalog is small (tens of
items), so embeddings and RAG stay unused.

### 7.2 Catalog source and import

- **New Excel template** with one row per tier, columns: brand, product, size, gsm, print, finish
  (laminasi or not), min qty, qty unit, price, price unit, delivery included, note. Import it from
  the dashboard Catalog page. This replaces Legacy's parser in `services/catalogImport.ts`, which
  reads Legacy's price-list layout. Catalog export writes the same template, so the round trip
  keeps working.
- **Starter catalog:** draft it from the workbook's generic quotes only (the `HARGA BOX` and
  `PRICE LIST CETAK` blocks that do not name a customer), in the new template. The client reviews
  and corrects it before it is imported. Until then, the bot runs with an empty catalog, so every
  price question goes to staff.
- **Design reference photos:** new table `product_reference_images` (`product_id`, `image_url`,
  `sort`), with uploads on the Catalog page. The bot sends up to 3 for the recommended product,
  **in one turn** (my call). Legacy's send path takes one `image_url` per turn (`messageRouter.ts`),
  so it becomes `image_urls`, an array of at most 3, sent in order after the text. The catalog
  block marks products that have reference photos the way Legacy marks `[FOTO TERSEDIA: url]`.
  With no photos uploaded, the bot says the team will send examples and hands off.

### 7.3 One AI turn: what the bot writes back

The per-turn `respond_to_customer` output in `services/aiLayer.ts` changes as follows:

- **Removed:** `customer_type` (Legacy's reseller / end_user / project). Imperial Indopack's price
  does not depend on buyer type. The column `contact_profiles.customer_type` stays, unused.
- **`profile_update` keys:** `name`, `business_name`, `business_type` (what they sell),
  `brands` (array), `items` (array of `{ product, size, gsm, print, qty, qty_unit, has_design }`).
  Every key is optional and filled only from what the customer wrote. They merge into
  `contact_profiles.profile` as in Legacy. Legacy's merge is a plain key patch, which would let a
  new `items` list wipe the old one, so the merge becomes array-aware (my call):
  - `brands` is a union.
  - `items` is keyed by product + size. A new key is appended. A known key updates only the
    fields sent.
  - The model sends only what changed this turn, never the whole list.
- **New `send_po_form: boolean`:** true when the customer has just agreed to a quoted price. Code
  appends the link from settings, so the model never writes the URL. This is the same pattern as
  `catalog_url`.
- **`catalog_url`** now means "send the price list file" (`brands.catalog_file_url`). The system
  decides which file, as Legacy's `catalogDelivery.ts` does. Its buyer-type helpers
  (`priceListConfirmed`, `companyCatalogue`) are replaced by this rule (my call):
  - **Trigger:** the customer asks for a price or a price list, and the profile does not yet hold
    an item with product, size and quantity.
  - **Which file:** the file of each brand in `profile.brands`, so both files if both brands.
  - **Brand unknown:** the bot asks what they want to pack first, then sends the file.
  - **Repeats:** a file already sent in this conversation is not sent again unless the customer asks.
- **`image_url`** is reused to send design reference photos.
- **Removed from the tool list:** the website search tool (`search_legacy_website`). `resolve_link`
  and the respond tool stay.
- **New client tool `hitung_harga` (price calculator)**, run in code like `resolve_link`.
  - **Input:** product, size, quantity and unit (`rim` | `pcs`).
  - **Returns one of:** a quote (tier used, unit price and its unit, total, delivery included, and
    the next tier's minimum and unit price as an upsell hint), or `below_minimum` (with the
    minimum), `above_top_tier`, or `not_in_catalog`.
  - **The model must call it before stating any price for a quantity, and repeats its figures
    exactly.** It never does its own arithmetic.
  - `above_top_tier` and `not_in_catalog` mean the bot hands off to staff.
  - Legacy's `total_for_team` field stays only for orders the tool cannot price, such as a mix
    of catalog and custom items.

  Tier rules (decided 2026-11-18):
  - Convert units first: 1 rim = 500 pcs.
  - **The tier is the highest one whose minimum the quantity reaches.** 8 rim with tiers at 5 and
    10 gets the 5-rim price, and the reply mentions the 10-rim price.
  - **Below the lowest tier:** the bot explains the minimum and quotes nothing.
  - **Above the top tier → staff,** since big orders are negotiated. My reading of "above": the top
    tier's price covers quantities up to that tier's own quantity. Tiers stopping at 100 rim means
    100 rim is quoted and 101 rim goes to staff.
  - **Total** = quantity in the price's unit × unit price.

### 7.4 Prompt

Replace Legacy's default prompt sections (`domain/constants.ts`, synced by `promptSync.ts`) with
Imperial Indopack ones:

- who we are (two brands, what each sells)
- the six details to collect
- recommendations by what the customer packs
- pricing rules (catalog only, tiers, minimums, delivery flag, custom → team)
- design (logo or file → note it; no design → reference photos)
- PO form
- tone

Rewrite the canned replies in `constants.ts` too: complaint, non-sales handoff, unsupported media,
still-checking. Prompt text is editable from the dashboard (Settings and Test Prompt), as in Legacy.

### 7.5 Reply checks (`services/replyChecks.ts`)

- **Tighten `verifyReplyPrices` for this catalog.** Legacy's version (`matchesCatalog`) accepts
  any multiple (up to 5,000×) or divisor of a catalog price, plus pack sums. That would let a
  wrong-tier price or a per-rim figure (500 × the per-pcs price) through. There is no multiple,
  divisor or pack tolerance here. Which figures are allowed depends on whether the price tool ran:
  - **`hitung_harga` ran this turn:** every Rp figure must be one the tool returned. A wrong
    tier's price fails, even though it appears in the catalog.
  - **No tool call this turn** (for example, listing an item's tiers): only exact tier prices from
    the catalog block are allowed, and no totals.
- **What happens on a failed figure:** the existing retry and `withoutInventedTotals` flow, so the
  reply is redone or the total is handed to the team. The quantity is never re-derived from the
  text: the tool call carries it.
- **Keep:** the tone, opener, first-greeting, meta, name-repeat, no-reasoning-leak and
  catalog-claim checks.
- **Switched off:** the end-user pricelist-leak rule, MP price, packs and discount tiers, buyer
  tier, showroom link and the other-brand checks, plus their prompt notes (`otherBrands.ts`).
- **Rewrite** the "not carried" checks for paper and box wording.

### 7.6 Handoff and asking for missing details

Legacy's handoff paths stay: `escalationHandler.ts`, human takeover, staff notifications, nudges.

`pickProfileGapQuestion` currently asks buyer type, store name and quantity before a handoff. It
changes to ask the first missing order detail, in this order: product or what they pack, size,
quantity, design, business name, name. The handoff note to staff lists the six details as
collected. Custom price requests, design files and "I want to talk to a person" all hand off.

Staff are alerted as in Legacy (my call): dashboard accounts in `staff_profiles`, browser push
(`staffNotify.ts`, `push` subscriptions), and the Escalations page. A seeded admin stands in
until the client's staff are added. WhatsApp alerts to staff phones are not in v1.

### 7.7 Customer images

The vision step (`visionKeywords.ts`) stays. The prompt changes how its result is read:

- a logo or artwork → `has_design = true`, thank them, and say it will go to the team with the order
- a photo of a box or wrapper they want → recommend the closest catalog product, or hand off if
  nothing fits

Legacy's photo-to-catalog matching (`photoMatch.ts`) stays switched on, but it only finds anything
once product photos are uploaded.

### 7.8 CRM

The lead logic is Legacy's, unchanged: kind, stages (new → contacted → quoted → won / lost),
evidence-checked Won/Lost from the background pass, silence → Lost, return → reopen or new lead,
staff locks, Bukan Lead.

Changes:

- **`leads.brands text[]`** (`imperial_indopack`, `kertas_supreme`) and **`leads.items jsonb`**
  (the same item shape as the profile). Both are filled by the background pass
  (`services/leadInsights.ts`), and staff can edit them.
- **The lead-pass prompt** is rewritten for this business. Drop `customer_type` and
  `product_sought`; add `brands` and `items`. Keep `lead_kind`, `stage`, `evidence`, `lost_reason`,
  `lead_temperature` and `business_name`.
- **Won** = the customer clearly agrees to buy at the quoted price, for example "oke kak saya ambil
  10 rim". That is the same moment the bot sends the PO form.
- **Return window:** the dashboard asks for months. The value is stored in the existing
  `lead_reopen_after_days` setting as months × 30. The default is 3 months (my call: the workbook's
  "pembelian 3 bulan 1 kali" list).
- **Silence → Lost** stays at 30 days (`lead_silence_lost_days`).
- **New setting `po_form_url`**, defaulting to a placeholder (`https://forms.gle/REPLACE-ME`),
  editable in Settings.

### 7.9 Dashboard

**In scope for v1.** Without it there is no way to load the catalog, upload photos, or edit the PO
link and return window. Copy it from `FDE Projects/legacy-app/legacy-dashboard` (branch
`new-main`, tracked files only, as was done for the API) into `dashboard/`. The plan does the API
first and the dashboard second (my call). Rebrand it, and adapt:

- **Leads list:** name, company, brand tags, items and quantities, Hot/Cold, status, last chat.
  Drop the customer-type badge.
- **Lead detail:** the same fields, editable by staff.
- **Unchanged pages:** Bukan Lead, Ringkasan (with a brand filter added), Conversations,
  Escalations, Activity, Numbers, Admin.
- **Catalog:** products, variants, tiers and reference photos, plus Excel import and export in the
  new template.
- **Settings:** prompt sections, PO form link, return window in months, silence days.
- Master Data (Legacy's categories) is hidden.

### 7.10 Legacy-only features: what happens to each

| Feature | v1 |
|---|---|
| Buyer type (reseller / end_user / project) and its pricing | off: removed from the turn output, the gap questions and the checks |
| Website search tool | removed from the tool list |
| Competitor-brand notes and checks | off |
| Embeddings / RAG | unused: full-catalog prompt, no `OPENAI_API_KEY` |
| Landing-page Request ID and UTM import | dormant |
| Photo-to-catalog matching | on, finds matches only once product photos exist |
| Order count (`lead_orders`), deal value | kept as in Legacy |

## 8. Testing

- Update the Legacy-specific tests (21 files mention Legacy) as the prompts, constants and checks
  change. Tests of the engine itself stay as they are.
- **New tests:**
  - catalog template import and export round trip
  - `hitung_harga`: a quantity between tiers, exactly the top tier, above the top tier, below the
    minimum, and pcs entered against a rim price
  - the price check rejects a wrong-tier figure when the tool ran, a total when it did not, and a
    figure that is 500 × a per-pcs price
  - PO link appended only on `send_po_form`
  - gap-question order
  - lead-pass parsing of `brands` and `items`
  - a chat that switches from Kertas Supreme to boxes keeps both brands
- DB tests need a Postgres with pgvector and `DATABASE_URL`. Never point them at a Legacy database.

## 9. Open questions for the client

1. Two lines of the meeting notes are unreadable: the word after "No printing?", and
   "C___ item not allowed!".
2. Which brand do paper bags, greaseproof paper, paper sleeves and envelopes belong to? Proposal:
   karton boxes → Imperial Indopack, everything paper → Kertas Supreme.
3. The starter catalog: which items, sizes and tiers are standard, and at what price. The draft
   comes from the workbook; the client corrects it.
4. A price list file per brand to send customers. It can be generated from the catalog if the
   client has none.
5. Reference design photos per product type.
6. The real PO Google Form link.
7. The bot's name and greeting.
8. Which WhatsApp provider (ChakraHQ or Meta Cloud API) and where it runs.

## 10. Left to the builder

- Migration numbering, table and column details beyond what is named here, and indexes.
- How tiers are formatted in the catalog block, as long as `verifyReplyPrices` can read every figure.
- The exact prompt wording, within section 7.4.
- Whether to delete or flag-gate each switched-off feature's code, as long as it never runs.
- The order of the work.
