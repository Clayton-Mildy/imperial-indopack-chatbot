# Porting the chatbot from Legacy

Source: `legacy-app/legacy-api`, branch `new-main`, commit `9fa8805`, copied 2026-11-18.
Only git-tracked files were copied, so no `.env`, `node_modules`, uploads or build output came along.

**Status: faithful copy, not yet adapted.** The code compiles (`npx tsc --noEmit`) and 857 tests pass.
16 test files need a real Postgres (`DATABASE_URL`) and were not run. The bot still talks and
reasons as Legacy (a hardware distributor) until the Imperial Indopack brief replaces that.

## What is in `api/`

| Path | What it is |
|---|---|
| `src/routes/webhooks.ts` | Inbound WhatsApp webhook (Chakra / Meta, signature check, media download) |
| `src/services/messageRouter.ts` | Debounce, routing, canned replies, handoff, photo flow |
| `src/services/aiLayer.ts`, `claude.ts`, `oauthTokenPool.ts` | Prompt build, Claude call, token failover |
| `src/services/replyChecks.ts` | Post-checks on a drafted reply (prices, packs, tone, claims) |
| `src/services/escalationHandler.ts`, `escalationNudge.ts`, `humanTakeover.ts`, `staffNotify.ts` | Handoff to staff |
| `src/services/ragQuery.ts`, `embeddings.ts`, `catalog*.ts`, `photoMatch.ts`, `visionKeywords.ts` | Catalog context, search, photo matching |
| `src/services/whatsappSender.ts`, `chakraClient.ts`, `metaClient.ts`, `chakraSync.ts`, `outboundMedia.ts` | WhatsApp transport and history sync |
| `src/domain/constants.ts`, `promptSync.ts`, `schemas.ts`, `types.ts` | Prompt sections, canned replies, shared types |
| `src/repositories/`, `src/db/` | Drizzle schema, 27 migration SQL files, data access |
| `src/routes/dashboard/` | REST routes the staff dashboard calls (the dashboard itself is not copied) |
| `tests/` | 59 test files |

## Left out on purpose (Legacy business data)

- `uploads/catalogs/*.pdf` (six Legacy brand price lists, ~10 MB)
- `scripts/catalog-data.json`, `scripts/data/catalog-family-map.json` (Legacy's product catalog)
- `scripts/ingest_catalog.py`, `ingest_pricelist.py`, `regroup-catalog.py` (Legacy spreadsheet ingest)
- `scripts/seed-catalog.ts` (needs `catalog-data.json`; removed from `build:scripts`)
- `scripts/qa/**` (Legacy test cases and the complaint replay over real customer chats)
- `tests/catalog-claims.test.ts`, `tests/named-products-full-catalog.test.ts` (read `catalog-data.json`)
- Not copied because they are not chatbot logic: the dashboard (`legacy-dashboard`), `deploy/`,
  `.github/` (Windows bundle CI), root `CLAUDE.md` and `docs/`.

## Small edits made during the copy

- Package renamed `imperial-indopack-api`; default DB name `imperial_indopack` (also the fallbacks in
  `embeddings.ts`, `seed-embeddings.ts`, `seed-categories.ts`, so no script defaults to a Legacy database).
- `VAPID_SUBJECT` fallbacks (`.env.example`, `config.ts`, `push-test.ts`) were Legacy's email, now `you@example.com`.
- Seed admin email, seed API-key label, and the startup log line renamed.
- `tests/webhooks-quoted-reply.test.ts`: a real-looking customer number replaced with `628111000099`.

## Where Legacy-specific content still lives (replace when the brief arrives)

- `src/domain/constants.ts`: brand list (`LEGACY_BRANDS`), default prompt sections, canned replies.
- `src/services/aiLayer.ts`: prompt text, brand and product examples, tier and pricing rules.
- `src/services/legacySearch.ts`: searches Legacy's website (rename and re-point or drop).
- `src/services/otherBrands.ts`, `replyChecks.ts`, `escalationHandler.ts`, `visionKeywords.ts`,
  `catalogDelivery.ts`: Legacy brand names and rules.
- `src/db/migrations/0010_brand_type.sql`: Legacy brand types.
- `scripts/seed-categories.ts`, `scripts/lib/categorize-product.ts`, `seed-default-prompt.ts`:
  hardware categories and the default prompt.
- `tests/`: 21 files mention Legacy and will need updating with the prompts.

## Decision for the brief: CRM / lead tracking is entangled

`messageRouter.ts`, `conversationInsights.ts` and `chakraSync.ts` call the lead code
(`recordLeadFromMessage`, `tagNonSalesLead`, `applyAiLeadUpdate`, `resetLeadsForContact`), and
`index.ts` starts the `leadInsights` scheduler. It was copied as is so the chatbot keeps working.
Legacy's own "chatbot first, CRM later" plan would remove it, which means editing those call sites.
