# imperial-indopack-dashboard

Staff dashboard for the Imperial Indopack WhatsApp sales bot: one WhatsApp number selling
Kertas Supreme (printed food-wrapping paper, per rim) and Imperial Indopack (printed karton
boxes, per pcs).

## Stack

- Next.js 16 (App Router), React 19, TypeScript 5.8
- Tailwind CSS 3.4 (brand tokens in `tailwind.config.ts`; Montserrat headings, Open Sans body)
- NextAuth v5 (beta.28), Zod 3
- Vitest 3 for the pure helpers in `lib/`

## Setup

```bash
nvm use            # .nvmrc (Node 24)
npm install
cp .env.example .env.local
# Fill in AUTH_SECRET (openssl rand -base64 32) and API_SECRET_KEY (SEED_API_KEY from api/.env)
npm run dev        # http://localhost:40070/app
```

The API (`api/`, port 50070) proxies `/app` to `127.0.0.1:40070`, so the dashboard always runs
under the base path `/app` (`NEXT_PUBLIC_BASE_PATH`).

## Scripts

- `npm run dev` / `npm start`: port 40070
- `npm run build`: production build (`output: "standalone"`)
- `npm test`: Vitest (`tests/`)
- `npm run type-check`: `tsc --noEmit`

## Environment variables

See `.env.example`.

- `AUTH_URL`, `AUTH_TRUST_HOST`: the dashboard's own URL for NextAuth
- `AUTH_SECRET`: min 32 random bytes
- `NEXT_PUBLIC_API_URL`: base URL of the API (`http://localhost:50070` locally)
- `NEXT_PUBLIC_BASE_PATH`: `/app`
- `API_SECRET_KEY`: API bearer key (server-side only, never exposed to the browser)

## Structure

```
app/
├── (auth)/login/         Login page
├── (dashboard)/          Protected pages
│   ├── conversations/    Percakapan (list + detail)
│   ├── team-queue/       Perlu Tim
│   ├── summary/          Ringkasan
│   ├── leads/            Leads, Bukan Lead, lead detail
│   ├── catalog/          Katalog
│   ├── numbers/          Nomor WhatsApp (admin)
│   ├── test-prompt/      Test Prompt
│   ├── activity/         Aktivitas
│   ├── admin/            Staff accounts (admin)
│   └── settings/         Pengaturan (admin)
├── api/                  Server-side proxies (exports, uploads)
components/               Shared UI, layout (Sidebar, Header), BrandTag
lib/api/                  Typed API client (server-only)
lib/i18n/                 Indonesian (source of truth) and English strings
lib/brands.ts, format.ts  Brand tags, quantity / waiting-time / relative-time formatting
actions/                  Server Actions
types/api.ts              API response types
```

## API connection and auth

Server code calls the API with `API_SECRET_KEY`; the browser never sees the key. Login is the
NextAuth credentials provider, which calls `POST /api/v1/auth/verify-credentials` and issues a
JWT session cookie. Roles: admin, agent, marketing (`proxy.ts` enforces what each may open).
