# imperial-indopack-api

Backend API for the Imperial Indopack WhatsApp AI Agent. Ported from `legacy-api`; the prompts and
business rules are still Legacy's until adapted. See `../docs/porting-from-legacy.md`.

**Stack:** Node.js 24 · Fastify 5 · TypeScript 5.8 · Drizzle ORM · PostgreSQL 16 · Zod

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

# 5. Seed initial admin + API key
npm run db:seed

# 6. Start dev server (port 50050)
npm run dev
```

## Environment Variables

See `.env.example` for all required variables.

## Architecture

Clean 4-layer architecture: routes → services → repositories → domain.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run db:generate` | Generate Drizzle migration from schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:seed` | Seed initial admin account + API key |
| `npm test` | Run Vitest tests |

### Catalog + settings seed pipeline

Destructive, opt-in, and order-dependent. Run with `npx tsx scripts/<name>.ts`:

| # | Script | Writes |
|---|---|---|
| 1 | _(`seed-catalog.ts` not copied: it imported Legacy's `catalog-data.json`; catalog import is TBD)_ | |
| 2 | `seed-categories.ts` | the 37 canonical Legacy categories (idempotent) — to be replaced |
| 3 | `backfill-product-categories.ts` | `products.category_id` (`--dry-run` supported) |
| 4 | `seed-embeddings.ts` | `products.embedding` — needs `OPENAI_API_KEY`, costs money |
| 5 | `seed-upsell-relationships.ts` | `tier`, `related_product_ids`, `upsell_product_id` |
| 6 | `seed-default-prompt.ts` | `app_settings.default_prompt_sections` — the AI's default prompt |

Legacy's spreadsheet ingest scripts (`ingest_*.py`) were not copied.

## Deploy

Not set up yet. Legacy's Windows bundle CI and runbook were not copied.
