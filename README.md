# ZELab — Distribution ERP

**Live:** [www.zelab.site](https://www.zelab.site)

The operating system for a Tanzanian distribution business: stock leaves the warehouse with
field sales representatives, and every box must come back as **money or returned stock**
within 72 hours. ZELab tracks that contract end to end — inventory, settlements,
commissions, finance and automated WhatsApp reporting.

Two decisions define the architecture:

**Inventory is ledger-based.** Stock is never a mutable `quantity` that gets decremented.
Every physical movement writes an immutable row to `InventoryTransaction`, and the on-hand
balance for any `(product, location)` pair is the **sum of its ledger entries**. Complete
audit trail, accurate valuation, and missing stock can be pinpointed to a person.

**Money is a ledger too.** Every shilling in or out is a `FinanceTransaction` against a
named account (Cash / M-Pesa / Airtel Money), tagged with the brand it belongs to. Account
balances are derived, never stored — so the books always reconcile.

---

## Table of contents

- [The settlement model](#the-settlement-model)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Quick start (Docker)](#quick-start-docker)
- [Local development](#local-development)
- [Deploying with Neon Postgres](#deploying-with-neon-postgres)
- [Scheduled jobs](#scheduled-jobs)
- [Seed accounts](#seed-accounts)
- [Environment variables](#environment-variables)
- [API](#api)
- [Scripts](#scripts)

---

## The settlement model

This is the business rule the whole system is built around. Reps never record sales —
they settle boxes.

```
Rep requests stock  →  Admin approves  →  stock issued, 72-hour order opens
                                                    │
                        ┌───────────────────────────┼───────────────────────────┐
                        ▼                           ▼                           ▼
                 Settle boxes                 Return boxes              Do nothing
            (submit money + account)      (submit, 24h window)        (deadline passes)
                        │                           │                           │
                 Admin approves              Admin approves            TSh 10,000/day
             → sale recorded, revenue    → stock back in warehouse       penalty accrues
             → commission credited       → order reduced
```

- An order closes only when **every issued box** is settled or returned.
- Nothing counts until the admin approves it — a submitted settlement has **zero** business
  impact (no sale, no revenue, no commission) until then.
- Boxes inside a pending return are **locked**: they can't be returned twice or settled.
- A return not decided within **24 hours** expires automatically, the boxes go back onto the
  order, and a TSh 15,000 delay fine applies.
- Penalties are real persisted deductions, not display values. Balances can go negative;
  future earnings offset the debt. Any fine can be forgiven by the admin, and stays on
  record as forgiven.

## Features

**Inventory**
- Ledger movements — `STOCK_IN`, `PURCHASE_RECEIPT`, `TRANSFER_IN/OUT`, `CASH_SALE`,
  `CUSTOMER_RETURN`, `SALES_RETURN`, `DAMAGE`, `ADJUSTMENT`, `CORRECTION`, `STOCK_COUNT`.
- Multi-level packaging — Pack / Box / Carton with per-product conversion factors.
- Warehouses **and** sales reps are stock locations, so rep-held stock is always known.
- Stock counts that reconcile physical vs. ledger and surface missing stock.
- Reorder engine — average daily sales, days of cover, recommended quantities by urgency.

**Orders, settlements & commissions**
- Stock requests with an approval centre; approval issues stock and opens the 72h order.
- Box-by-box settlement (issued / settled / returned / remaining) with an approval gate.
- Returns with a full lifecycle: lock → 24h window → approve, reject, cancel or expire.
- Commission per settled box at per-brand rates — from 1 Aug 2026, OHIS TSh 5,000
  and Civlily TSh 3,000. The rate is frozen on the order when it is created, so
  changing the rules never re-prices orders that already exist.
- Withdrawals once a rep's balance reaches TSh 250,000 — a money target, not a
  box count, since boxes of different brands are no longer worth the same.
- Automatic late-settlement penalties, forgivable, plus manual commission adjustments.
- Deadline extensions that re-arm reminders and notify the rep.

**Finance**
- Business accounts (Cash, M-Pesa, Airtel Money) with brand-reserved payment routing —
  an OHIS settlement can never land in the Civlily account.
- Suppliers as real accounts payable: purchases create debt, payments settle it in
  instalments.
- Profit & loss, cash flow, per-brand performance, transaction ledger with corrections and
  account-to-account transfers.
- A **finance epoch** so pre-go-live history stays for audit but never pollutes the books.
- Permanent archive of every generated daily, weekly and monthly report PDF.

**Reporting & notifications**
- Real-time WhatsApp alerts on every important event (stock requests, settlements, returns,
  low stock, out of stock), with per-type toggles, quiet hours, delivery log and auto-retry.
- Per-rep WhatsApp alerts — approvals, commission earned, deadline reminders, penalties.
- Automated daily (21:00), weekly (Mon 08:00) and monthly (1st, 08:00) reports on
  **Africa/Dar_es_Salaam** time. Each is a designed PDF (letterhead, figures against the period before,
  profit and loss, money in and out, charts, brands, products, best rep, stock, accounts, what needs
  attention) at a signed public link; the WhatsApp message stays a short summary with that link.
- Dashboards — an admin command centre and a personal rep dashboard.
- Exports to PDF & Excel; invoice generator.

**Platform**
- RBAC — Admin, Warehouse Staff, Sales Representative — JWT auth with refresh tokens.
- Audit log and in-app notifications for every significant action.

## Tech stack

**Frontend:** React + Vite, React Router, Tailwind CSS, TanStack Query, Axios,
React Hook Form + Zod, Recharts, motion — fully responsive.

**Backend:** Node.js, Express, Prisma ORM, JWT, bcrypt, Helmet, CORS, rate limiting,
Zod validation, PDFKit + ExcelJS for exports.

**Database:** PostgreSQL (Neon) via Prisma — 43 models, migrations and seed.

**Hosting:** Vercel — the SPA is served statically and the whole Express API runs as a
single serverless function (`api/index.js`), with Vercel Cron driving the scheduled jobs.

## Architecture

```
                 ┌─────────────────────┐         ┌───────────────────────────┐
   Browser  ───► │ client (Vite/React) │  /api  ►│ server (Express + Prisma) │
                 └─────────────────────┘         └────────────┬──────────────┘
                                                              │ Prisma
                                                     ┌────────▼─────────┐
                                                     │  PostgreSQL/Neon │
                                                     └──────────────────┘
```

**Why ledger-based?** A single `product.quantity -= n` loses history and invites theft and
errors. `inventory.service.js` appends signed `InventoryTransaction` rows inside a DB
transaction and keeps `WarehouseStock` / `RepStock` as a *materialized cache* — rebuildable
from the ledger at any time via `POST /api/inventory/recompute-caches`. Reads derive truth
from the ledger.

The same principle governs money: `finance.service.js` derives every account balance from
`FinanceTransaction` rows rather than storing a running total.

## Project structure

```
.
├─ api/index.js              # Vercel entry — exports the Express app
├─ vercel.json               # rewrites + cron schedules
├─ docker-compose.yml        # local Postgres + API + web
├─ server/                   # Express + Prisma API
│  ├─ prisma/
│  │  ├─ schema.prisma       # 43 models, ledger-centric
│  │  └─ seed.js             # roles, catalog, demo data
│  └─ src/
│     ├─ config/             # env, prisma client
│     ├─ middleware/         # auth, authorize, validate, errors
│     ├─ services/           # inventory + settlement + finance + notifications
│     ├─ controllers/        # thin HTTP handlers
│     ├─ routes/             # one router per module
│     ├─ validators/         # Zod schemas
│     └─ utils/              # money, dates (EAT), numbering, tokens…
└─ client/                   # Vite + React SPA
   └─ src/
      ├─ components/         # ui primitives, layout, charts, order detail
      ├─ context/            # AuthContext
      ├─ lib/                # api client, hooks, formatting, constants
      └─ pages/              # dashboard + every module
```

## Quick start (Docker)

```bash
docker compose up --build
```

- Web app: **http://localhost:8080**
- API: **http://localhost:4000/api** (health: `/api/health`)

Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before the first start — the seed refuses
to run without them.

## Local development

Prerequisites: Node 18.18+ and PostgreSQL (local or a Neon connection string).

**1) Backend**

```bash
cd server
cp .env.example .env            # set DATABASE_URL / DIRECT_URL, JWT_SECRET, seed vars
npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev                     # http://localhost:4000
```

**2) Frontend**

```bash
cd client
cp .env.example .env            # VITE_API_URL defaults to /api (proxied to :4000)
npm install
npm run dev                     # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:4000`, so no CORS setup is needed in development.

> **Never run `db:reset` against a deployed database** — it drops everything. Use
> `prisma migrate deploy` on anything live.

## Deploying with Neon Postgres

1. Create a project at **https://console.neon.tech** and copy two connection strings:
   - **Pooled** → `DATABASE_URL` (runtime).
   - **Direct** → `DIRECT_URL` (Prisma Migrate).
2. Set the environment variables on the host (see the table below).
3. Deploy. On Vercel the root `npm run build` applies migrations, regenerates the Prisma
   client and builds the SPA; `api/index.js` serves the API as a serverless function.

Self-hosting instead: run the API with `npm start` (or `server/Dockerfile`), build the
client with `npm run build`, serve `client/dist` from any static host, and set
`VITE_API_URL` to the API origin and `CLIENT_ORIGIN` on the API for CORS.

## Scheduled jobs

Driven by Vercel Cron (`vercel.json`). Times below are UTC; the business runs on
**Africa/Dar_es_Salaam (UTC+3)**.

| Job                        | Schedule (UTC) | Local time     | What it does                                              |
| -------------------------- | -------------- | -------------- | --------------------------------------------------------- |
| `/api/cron/settlement-sweep` | `0 6 * * *`  | 09:00 daily    | Overdue flags, deadline reminders, penalties, return expiry |
| `/api/cron/daily-summary`    | `0 18 * * *` | 21:00 daily    | Daily report + archived PDF to WhatsApp                    |
| `/api/cron/weekly-report`    | `0 5 * * 1`  | 08:00 Monday   | Weekly report + archived PDF                               |
| `/api/cron/monthly-report`   | `0 5 1 * *`  | 08:00 on the 1st | Previous month's full report + archived PDF              |

All are idempotent and safe to re-run. Set `CRON_SECRET` to require an auth header.

## Seed accounts

The seed creates one administrator plus demo warehouse/sales-rep accounts.

**Credentials are never published here.** Set them yourself before seeding:

```bash
SEED_ADMIN_EMAIL="you@example.com"
SEED_ADMIN_PASSWORD="<a strong password you choose>"
```

If `SEED_ADMIN_PASSWORD` is not set, seeding fails rather than falling back to a known
default. Change every seeded password immediately after the first login, and never run the
seed against a production database.

The seed also creates the product catalog (with Pack/Box/Carton packaging), opening
warehouse stock, a van load for a rep, and sample sales.

## Environment variables

See `server/.env.example` and `client/.env.example`. Key ones:

| Variable           | Where  | Purpose                                                |
| ------------------ | ------ | ------------------------------------------------------ |
| `DATABASE_URL`     | server | Pooled Postgres/Neon connection (runtime)              |
| `DIRECT_URL`       | server | Direct connection (Prisma Migrate)                     |
| `JWT_SECRET`       | server | Access-token signing + signed report links             |
| `CLIENT_ORIGIN`    | server | Allowed CORS origin(s), comma-separated                |
| `PUBLIC_APP_URL`   | server | Public origin — used in report links and PDF footers   |
| `CRON_SECRET`      | server | Optional bearer token required by the cron endpoints   |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | server | Required to seed; no defaults           |
| `VITE_API_URL`     | client | API base URL (default `/api`)                          |

WhatsApp delivery credentials live in the `settings` table (group `whatsapp`), managed from
**Settings → WhatsApp notifications** in the app, not in environment variables.

## API

Base URL: `/api`. Auth via `Authorization: Bearer <accessToken>`. Responses use a
`{ success, data, meta? }` envelope. Full reference in [`docs/API.md`](docs/API.md).

## Scripts

**server/**
- `npm run dev` — start with nodemon
- `npm start` — production start
- `npm run prisma:migrate` / `prisma:deploy` — migrations
- `npm run db:seed` — seed
- `npm run db:reset` — **destructive**: reset + migrate + seed (local only)

**client/**
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the build

---

© ZELab. Built for real-world distribution in Tanzania.
