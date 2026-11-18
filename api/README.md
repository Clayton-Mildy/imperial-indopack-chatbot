# imperial-indopack-api

Backend API for the Imperial Indopack WhatsApp AI Agent: one WhatsApp number selling two brands,
Imperial Indopack (printed cardboard boxes) and Kertas Supreme (printed food-wrapping paper). The bot
answers from the catalog, quotes prices through the `hitung_harga` price tool (quantity tiers per
size), sends the brand price list, reference photos and the PO form, and hands custom jobs, totals
and anything it cannot answer to the team.

**Stack:** Node.js 24 · Fastify 5 · TypeScript 5.8 · Drizzle ORM · PostgreSQL 16 · Zod · Vitest

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start local Postgres — pgvector, not plain postgres:16 (migration 0007
#    runs CREATE EXTENSION vector).
docker run -d --name imperial-indopack-pg -p 5432:5432 \
  -e POSTGRES_DB=imperial_indopack -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  pgvector/pgvector:pg16

# 3. Configure env
cp .env.example .env
# Edit .env with your secrets

# 4. Run migrations
npm run db:migrate

# 5. Seed initial admin + API key, then the default prompt
npm run db:seed
npx tsx scripts/seed-default-prompt.ts

# 6. Start dev server (port 50050)
npm run dev
```

## Environment Variables

`.env.example` lists every variable the code reads, with its default and what it is for.

## Architecture

Clean 4-layer architecture: routes → services → repositories → domain.

- `src/services/messageRouter.ts` — inbound WhatsApp turns: debounce, photos, hand-offs, what follows a reply
- `src/services/aiLayer.ts` — the model call, the `respond_to_customer` / `hitung_harga` tools, the fit judge and repairs
- `src/services/priceTool.ts` — `hitung_harga`: the only source of a quoted price
- `src/services/leadInsights.ts` — the background lead pass (kind, stage, brands, items, orders)
- `src/domain/constants.ts` — the shipped prompt sections and the fixed customer-facing lines

## Catalog

The catalog is maintained in the dashboard: Excel import/export (`POST /api/v1/catalog/import`,
`GET /api/v1/catalog/export`), product and reference photos, and one price-list file per brand
(`brands.catalog_file_url`). The PO form link is a setting (`/api/v1/settings/po-form-url`); while
it is still the placeholder, the bot never sends it and the team sends the form by hand.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run build:scripts` | Bundle the scripts below into `dist-scripts/` for the deploy |
| `npm start` | Run compiled output |
| `npm run db:generate` | Generate Drizzle migration from schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run catalog:demo` | Loads a DEMO catalog (every product named `... (CONTOH)`, fake prices) through the normal catalog import; `-- --purge` deletes only the `(CONTOH)` products. Go-live reports `catalog_demo` until it is purged |
| `npm run db:seed` | Seed initial admin account + API key |
| `npm test` | Run Vitest tests (needs `DATABASE_URL` for the DB-backed suites) |

Run with `npx tsx scripts/<name>.ts` (or `node dist-scripts/<name>.js` on the deploy):

| Script | Does |
|---|---|
| `migrate.ts` | Applies pending migrations with the runtime migrator (no drizzle-kit needed) |
| `load-demo-catalog.ts` | The demo catalog above (`--purge` removes it); refuses a `legacy` database |
| `seed.ts` | First dashboard admin and API key |
| `seed-default-prompt.ts` | `app_settings.default_prompt_sections` — the AI's default prompt |
| `reseed-prompt-defaults.ts` | Syncs the shipped prompt to the defaults and every number's snapshot, keeping staff edits (`--force` replaces them); warns about an Identity that does not name Imperial Indopack |
| `seed-embeddings.ts` | `products.embedding` — needs `OPENAI_API_KEY`, costs money; optional |
| `backfill-leads.ts` | Builds `leads` from existing message history |
| `backfill-lead-stages.ts` | Replays the lead pass over past chats (spends model quota; hand-run) |
| `backfill-outbound-senders.ts` | Repairs who-sent-it labels on chats imported from ChakraHQ |
| `repair-lead-sync-order.ts` | Repairs leads created out of order by the ChakraHQ history sync |
| `push-test.ts` | Sends a test push to every staff device and says which link is broken |

## Deploy

Not set up yet for this client. `update.ps1` (when added) is expected to run `migrate` and
`reseed-prompt-defaults` on every deploy.
