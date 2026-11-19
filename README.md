# imperial-indopack-chatbot

WhatsApp AI sales agent for Imperial Indopack.

`api/` is the Fastify + Drizzle + Postgres backend that holds the chatbot: WhatsApp webhook ->
`messageRouter` -> `aiLayer` (Claude) -> reply. `dashboard/` is the Next.js staff dashboard (conversations,
catalog, leads, settings). To connect the real WhatsApp number and test, follow [`docs/go-live.md`](docs/go-live.md).

## Origin

`api/` was adapted from Legacy's chatbot engine (`legacy-app/legacy-api`, branch `new-main`,
commit `9fa8805`, copied 2026-11-18). The engine - webhooks, debounce, hand-offs, staff takeover,
ChakraHQ sync, the lead pipeline - was kept; the business layer was rebuilt, and it is now the
Imperial Indopack bot: the prompt, price tool (quantity tiers), catalog, replies, checks and tests
all describe Imperial Indopack (printed boxes) and Kertas Supreme (printed food-wrapping paper). No
Legacy business is left. `docs/porting-from-legacy.md` records what was copied at the start.

## Local development

Needs Node 24 and Postgres with the pgvector extension (migration 0007 runs `CREATE EXTENSION vector`).

```sh
cd api
npm install
cp .env.example .env     # fill DATABASE_URL, API_SECRET_KEY, ANTHROPIC_API_KEY, WhatsApp transport keys
npm run db:migrate
npm run db:seed          # first admin + API key
npx tsx scripts/seed-default-prompt.ts   # the default prompt
npm run dev              # API on :50070 (PORT in .env)
npm test
```

Dashboard (second terminal; open http://localhost:40070/app/login):

```sh
cd api && npm run dev         # API, port 50070
cd dashboard && npm run dev   # dashboard, port 40070
```
