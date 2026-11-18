# imperial-indopack-chatbot

WhatsApp AI sales agent for Imperial Indopack.

`api/` is the Fastify + Drizzle + Postgres backend that holds the chatbot: WhatsApp webhook ->
`messageRouter` -> `aiLayer` (Claude) -> reply. A staff dashboard (`dashboard/`) is not copied yet.

## Origin

`api/` started as a copy of `legacy-app/legacy-api` (branch `new-main`, commit `9fa8805`) taken
on 2026-11-18. It is **Legacy's chatbot, not yet adapted**: the prompts, constants, brand lists,
reply checks and tests still describe Legacy's business (hardware distributor). They are replaced
as the Imperial Indopack chatbot brief comes in. See `docs/porting-from-legacy.md` for what was
copied, what was left out on purpose, and where the Legacy-specific content lives.

## Local development

Needs Node 24 and Postgres with the pgvector extension (migration 0007 runs `CREATE EXTENSION vector`).

```sh
cd api
npm install
cp .env.example .env     # fill DATABASE_URL, API_SECRET_KEY, ANTHROPIC_API_KEY, WhatsApp transport keys
npm run db:migrate
npm run db:seed          # first admin + API key
npm run dev              # API on :50050
npm test
```
