# LendLoop

> Borrow what you need. Lend what you don't.

A neighbourhood tool-lending board. Neighbours list tools, request to borrow them for a date range and approve or decline requests, and the lender marks the tool returned. n8n sends notifications and daily overdue reminders. Both directions of that integration are signed, idempotent and observable.

**Stack:** Next.js 16 (App Router) · Clerk · Convex · n8n (Docker) · TypeScript · Tailwind CSS 4 · Vitest + convex-test

---

## Contents

1. [Features](#features)
2. [Local setup](#local-setup)
3. [Environment variables](#environment-variables)
4. [Architecture](#architecture)
5. [Roles and access control](#roles-and-access-control)
6. [Automation with n8n](#automation-with-n8n)
7. [Security and data-minimisation decisions](#security-and-data-minimisation-decisions)
8. [Testing](#testing)
9. [What I would change for production](#what-i-would-change-for-production)
10. [Project structure](#project-structure)

---

## Features

| Area | What you get |
| --- | --- |
| **Public page** (`/`) | Tagline, a live read-only list of available tools (**name and category only**), and a "Sign in to lend or borrow" button (Clerk modal). |
| **All tools** (`/tools`) | Every listing with an availability badge (available / on loan until … / overdue), upcoming bookings, the lender's first name and Trusted Lender badge. Filter by category. Request to borrow for a date range, with an optional note. |
| **My listings** (`/listings`) | Create, edit and delete your own tools (name, category, condition, short description). Shows pending-request counts. |
| **My requests** (`/requests`) | Your borrow requests grouped as *Borrowing now*, *Waiting for an answer* and *History*. Withdraw a pending request. |
| **Incoming requests** (`/incoming`) | Requests for your tools. Approve, decline, and mark returned. |
| **Admin** (`/admin`) | All loans, members with a Trusted Lender toggle, and an **automation health** panel (failed webhooks with a *Retry* button, failed reminders). Admins can also remove any listing from *All tools*. |
| **Automation activity** (bonus) | Each loan shows recent automation events, e.g. *"Reminder sent 2 days ago · 3 day(s) overdue"* or *"Notification failed …"*. |

Business rules enforced on the server:

- You can't borrow your own tool. Dates must be valid, start no earlier than today, last at most 30 days, and start within 180 days.
- A request can't overlap an approved loan. Approving re-checks overlap inside the transaction and automatically declines other pending requests that now collide.
- Loan state machine: `requested → approved → returned`, `requested → declined`, `requested → cancelled`. Any other transition is rejected.
- Only the **lender** marks a loan returned, because they are the one who can verify the tool came back.
- An owner can't delete a listing that has approved loans. Admin removal cancels pending requests and notifies the borrowers. Loan history keeps a snapshot of the tool name.

---

## Local setup

**Prerequisites:** Node 20+, Docker, `openssl`, a free [Clerk](https://clerk.com) account and a Discord channel webhook. A [Convex](https://convex.dev) account is optional (see step 1).

You end up with three terminals: `npx convex dev`, `npm run dev`, and the n8n container in the background.

### 1. Convex

```bash
npm install
npx convex dev
```

The CLI asks how to run Convex. Pick one mode and keep using it in the steps below:

| | **Local** (*Start without an account*) | **Cloud** (log in) |
| --- | --- | --- |
| Backend | Runs on your machine (`127.0.0.1:3210`, HTTP actions on `:3211`) | Hosted dev deployment |
| Dashboard | `npx convex dashboard` → http://127.0.0.1:6790 (localhost only) | https://dashboard.convex.dev |
| n8n reaches Convex at | `http://host.docker.internal:3211` | `https://<deployment>.convex.site` |
| Convex reaches n8n at | `http://localhost:5678/webhook/lendloop-loan-events` | a public URL (tunnel, step 4) |
| Deployable (e.g. Vercel) | No | Yes |

`npx convex dev` writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. Keep it running: it pushes functions and regenerates types as you edit. The local backend and dashboard stop when it stops.

### 2. Clerk

1. Create an application in the [Clerk dashboard](https://dashboard.clerk.com) and enable the sign-in methods you want (e.g. Google).
2. **API keys** → copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` into `.env.local` (see [.env.example](.env.example)).
3. **Integrations → Convex → Activate.** This is required: Clerk then issues session tokens with the `convex` audience. (Equivalent: **Configure → JWT templates → New template → Convex** preset, keep the name `convex`.)
4. Copy the **Frontend API URL** shown by the integration and give it to Convex:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
```

> **Signed in but your user never appears in the `users` table, and signed-in pages keep loading?** Step 3 is missing. Without it Clerk issues no token for Convex, so Convex treats you as signed out and `users.ensureCurrent` never runs. Activate the integration, then sign out and back in.

### 3. Run the app

```bash
npm run dev             # http://localhost:3000
npm run seed            # optional: demo neighbours (Maya, Tom) + 6 tools
```

Sign in once, then promote yourself to admin. Roles are deliberately not changeable from any client:

```bash
# find your user id in the Convex dashboard → Data → users
npx convex run users:setRole '{"userId":"<id>","role":"admin"}'
```

### 4. n8n (Docker)

**4a. Create `n8n/.env`.** Three values are random secrets, each generated **separately** with `openssl rand -hex 32` (at least 32 characters, `setup.sh` refuses shorter ones):

| Variable in `n8n/.env` | Value |
| --- | --- |
| `N8N_ENCRYPTION_KEY` | `openssl rand -hex 32`. Encrypts n8n's credentials. Keep it once set: changing it makes stored credentials unreadable. Used only by n8n. |
| `N8N_WEBHOOK_SECRET` | `openssl rand -hex 32`. Also set in Convex (4c). |
| `CONVEX_HTTP_SECRET` | `openssl rand -hex 32`, a different value. Also set in Convex (4c). |
| `DISCORD_WEBHOOK_URL` | Discord → channel settings → Integrations → Webhooks → *Copy Webhook URL*. |
| `CONVEX_SITE_URL` | Local mode: `http://host.docker.internal:3211` (the default). Cloud mode: `https://<deployment>.convex.site`. |

This fills the three secrets in one go:

```bash
cp n8n/.env.example n8n/.env
for v in N8N_ENCRYPTION_KEY N8N_WEBHOOK_SECRET CONVEX_HTTP_SECRET; do
  sed -i.bak "s/^$v=.*/$v=$(openssl rand -hex 32)/" n8n/.env
done && rm n8n/.env.bak
# then edit DISCORD_WEBHOOK_URL (and CONVEX_SITE_URL in cloud mode)
```

**4b. Start n8n.**

```bash
./n8n/setup.sh
```

It starts the container, imports 3 credentials and 3 workflows, publishes them and checks that the webhook answers. The credentials (Discord webhook and the two HMAC secrets) are built from `n8n/.env` **in memory** and piped into `n8n import:credentials`. They are encrypted in n8n's database and never written to the repo or to the container environment. `setup.sh` is safe to re-run. Then open http://localhost:5678 and create the n8n owner account.

**4c. Point Convex at n8n.** The two HMAC secrets must be **identical** on both sides:

```bash
bash -c 'source n8n/.env
  npx convex env set N8N_WEBHOOK_SECRET "$N8N_WEBHOOK_SECRET"
  npx convex env set CONVEX_HTTP_SECRET "$CONVEX_HTTP_SECRET"'

# Local mode:
npx convex env set N8N_WEBHOOK_URL http://localhost:5678/webhook/lendloop-loan-events
```

In cloud mode, Convex can't reach `localhost`, so start the optional tunnel instead. It exposes **only** the loan-events webhook path, through a Caddy gateway:

```bash
cd n8n && docker compose --profile tunnel up -d
docker compose logs tunnel | grep trycloudflare      # → https://<random>.trycloudflare.com
npx convex env set N8N_WEBHOOK_URL https://<random>.trycloudflare.com/webhook/lendloop-loan-events
```

If you change `CONVEX_SITE_URL` later, apply it with `cd n8n && docker compose up -d n8n`.

**Try it:** request a tool as one user and the lender gets a Discord message. For reminders, run `npx convex run seed:overdueLoan` and then *Execute workflow* on **LendLoop – Daily overdue reminders**. The borrower gets a reminder, the loan shows "Reminder sent just now", and running it again sends nothing.

After editing workflows in the n8n UI, run `./n8n/export.sh`. It re-exports them into `n8n/workflows/`, strips instance metadata, and **fails if any secret appears in the JSON**.

---

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT` | `.env.local` | Written by `npx convex dev`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `.env.local` | Clerk keys. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex env | Clerk Frontend API URL. Convex validates JWTs against it. |
| `N8N_WEBHOOK_URL` | Convex env | n8n production webhook URL: `http://localhost:5678/webhook/lendloop-loan-events` (local Convex) or the tunnel URL (cloud). |
| `N8N_WEBHOOK_SECRET` | Convex env + n8n credential | HMAC secret, **Convex → n8n**. |
| `CONVEX_HTTP_SECRET` | Convex env + n8n credential | HMAC secret, **n8n → Convex**. A separate key, so one leak only compromises one direction. |
| `N8N_ENCRYPTION_KEY` | `n8n/.env` → Docker secret | Encrypts n8n credentials at rest. Mounted as a file (`N8N_ENCRYPTION_KEY_FILE`), not an env var. |
| `CONVEX_SITE_URL` | `n8n/.env` → container env | Base URL of the Convex HTTP actions: `http://host.docker.internal:3211` (local, default) or `https://<deployment>.convex.site`. **Not a secret**, and the only value workflows read with `$env`. |
| `DISCORD_WEBHOOK_URL` | `n8n/.env` (read by `setup.sh` only) | Stored as an encrypted n8n credential. |

`.env*` files are git-ignored. Only the two `.env.example` files are committed.

---

## Architecture

```
                 ┌──────────── Browser ─────────────┐
                 │ Next.js App Router (React 19)    │
                 │  • public page (no auth)         │
                 │  • (app)/* pages ─ ClerkProvider │
                 └──────┬──────────────────┬────────┘
              Clerk JWT │ (aud "convex")   │ session
                        ▼                  ▼
┌─────────────────────────────────┐   ┌─────────┐
│ Convex                          │   │  Clerk  │
│  queries / mutations            │   └─────────┘
│   └ lib/auth.ts  requireUser /  │
│     requireAdmin / assertOwner  │
│  tables: users tools loans      │
│          automationEvents       │
│          webhookDeliveries ◀── outbox, same transaction as the loan change
│  webhooks.deliver (action)      │── HMAC-signed POST, retries + backoff ──┐
│  http.ts                        │                                         ▼
│   POST /n8n/overdue-loans  ◀────┼── HMAC-signed ──┐            ┌──────────────────┐
│   POST /n8n/automation-events ◀─┼── HMAC-signed ──┤            │ n8n (Docker)     │
└─────────────────────────────────┘                 └────────────│  1 notification  │
                                                                 │  2 daily reminder│──▶ Discord
                                                                 │  0 error handler │
                                                                 └──────────────────┘
```

- **Convex is the only backend.** The browser talks to Convex directly with the Clerk token. There are no Next.js API routes holding business logic.
- **Route protection in Next.js is UX only.** [app/(app)/layout.tsx](app/(app)/layout.tsx) redirects signed-out visitors, following Clerk's resource-based check instead of the deprecated `createRouteMatcher`. Every Convex function performs its own authorization regardless.
- **Data model** ([convex/schema.ts](convex/schema.ts)):
  - `users` stores a Clerk `tokenIdentifier`, a display name (first name), the role and the trusted flag.
  - `tools` belong to an owner.
  - `loans` denormalise `ownerId`, so access checks never need the tool, and snapshot `toolName`.
  - `webhookDeliveries` is the outbox.
  - `automationEvents` holds the idempotent n8n write-backs, keyed by `idempotencyKey`.
- Enum-like fields (category, condition, status, role) are Convex validators defined once in [convex/lib/validators.ts](convex/lib/validators.ts) and imported by both the schema and the UI.

---

## Roles and access control

Two roles, `user` (default) and `admin`, stored in Convex. They are **never** read from client input or Clerk metadata the user could influence. They change only through an internal mutation (`users:setRole`) run by an operator.

All checks live in [convex/lib/auth.ts](convex/lib/auth.ts) and run at the top of every public function:

| Action | Rule (server-side) |
| --- | --- |
| Public tool list | No auth. Returns only `_id`, `name` and `category` of currently available tools. |
| Anything else | `requireUser`: a valid Clerk JWT **and** an existing profile. |
| Edit listing | `assertToolOwner`. Admins can't edit other people's listings, because the brief only grants removal. |
| Delete listing | Owner (if no approved loans), or `isAdmin` for moderation. |
| Approve / decline / mark returned | `assertLender` (`loan.ownerId === me`). Admins can't act on a lender's behalf. |
| Withdraw request | `assertBorrower`. |
| View loans | `myRequests` and `incoming` are filtered by index on the caller's id. Viewing all loans goes through `admin.overview` → `requireAdmin`. |
| Trusted Lender, retry failed webhook | `requireAdmin`. |

Errors are thrown as typed `ConvexError({ code, message })`, so the UI shows a clear message without leaking internals. The UI hides actions you can't take, but that is cosmetic. Tests call the functions directly, as other users and as admin, to prove the server enforces each rule.

---

## Automation with n8n

Workflows live in [n8n/workflows/](n8n/workflows/) and are imported with stable ids. The two main workflows use `LendLoop – Error handler` as their error workflow.

### 1. Request notification (`01-loan-event-notification.json`)

```
Convex mutation ─(same tx)→ webhookDeliveries row ─(scheduler)→ webhooks.deliver
  → POST /webhook/lendloop-loan-events   X-LendLoop-Timestamp, X-LendLoop-Signature: sha256=…

n8n: Webhook → Crypto HMAC (credential) → verify signature + 5-min window
       ├─ invalid → 401
       └─ valid → 202 → claim idempotency key in Convex ─ duplicate? stop
                      → compose message → Discord (3 tries)
                      → write back sent|failed (signed) → failed? throw → error workflow
```

- **Events:** `loan.requested` and `loan.cancelled` (by the borrower) go to the **lender**. `loan.approved`, `loan.declined`, `loan.returned` and `loan.cancelled` (listing removed) go to the **borrower**.
- **Payload, and nothing more:**

  ```json
  {
    "eventId": "...", "type": "loan.approved", "occurredAt": "...",
    "loan": { "id": "...", "status": "approved", "startDate": "2026-11-22", "endDate": "2026-11-24" },
    "tool": { "name": "Cordless drill" },
    "recipient": { "role": "borrower", "displayName": "Bob" },
    "counterparty": { "displayName": "Alice" }
  }
  ```

### 2. Overdue reminders (`02-daily-overdue-reminders.json`)

```
Schedule 09:00 daily (or Run manually)
  → signed POST /n8n/overdue-loans  → [{ loanId, idempotencyKey: "reminder:<loan>:<date>", toolName, borrowerName, lenderName, dueDate, daysOverdue }]
  → one item per loan → claim each key (signed) → drop duplicates
  → Discord reminder (3 tries) → signed write-back sent|failed per loan
  → any failed? throw → error workflow
```

Convex already excludes loans that received a reminder today, so a second run the same day returns nothing.

### 3. Error handler (`00-error-handler.json`)

Error Trigger → posts an ops alert (workflow, failing node, error message, execution link, **no payload data**) to Discord, and logs it to the n8n container log.

### Reliability design

| Concern | How it's handled |
| --- | --- |
| Lost notifications | **Transactional outbox.** The delivery row is written in the same Convex transaction as the loan change, so there are no notifications for rolled-back changes and no lost ones. |
| Transient failures, Convex → n8n | `webhooks.deliver` retries network errors, timeouts (10 s), 404 (workflow (re)activating), 408, 429 and 5xx with backoff of 30 s, 2 min, 10 min and 1 h (5 attempts). |
| Misconfiguration | 401, 400 and similar fail **immediately** with `status: failed` and `lastError`, shown in *Admin → Automation health* with a **Retry** button. |
| Transient failures, n8n → Convex | Every HTTP Request node retries 3 times. Discord nodes retry 3 times with a 5 s wait. |
| Duplicate sends on retries or replays | **Claim-before-send.** n8n claims `notification:<eventId>` or `reminder:<loanId>:<date>` in Convex first. A key already `sent`, or freshly `claimed` (< 10 min), returns `duplicate` and the run stops. A `failed` key can be re-claimed, so retries still work. |
| Idempotent write-backs | `automationEvents.recordEvent` upserts by key. A late `failed` never downgrades a `sent`, and a key can't be reused for another loan or kind. |
| Silent failures | A failed send is written to Convex **and** then fails the execution, which triggers the error workflow alert. Failed executions are kept in n8n. Successful ones are not stored (see data minimisation). |

### Request signing

```
X-LendLoop-Timestamp: <unix seconds>
X-LendLoop-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
```

- Receivers recompute the HMAC, compare in **constant time**, and reject timestamps outside **±5 minutes** to bound replays. The idempotency keys make any replay inside the window harmless.
- Convex uses Web Crypto ([convex/lib/signature.ts](convex/lib/signature.ts)). n8n uses the built-in **Crypto node with a `crypto` credential**, so the secret is never in an expression, the workflow JSON or `$env`.
- n8n verifies over `JSON.stringify(body)`. Convex sends exactly `JSON.stringify(payload)` with no integer-like keys, so re-serialising the parsed body reproduces the signed bytes.

---

## Security and data-minimisation decisions

**Authentication and authorization**
- Clerk handles identity, and Convex verifies the JWT (issuer + `convex` audience) on every call.
- Authorization lives in one module and runs in every function. The UI is never trusted.
- Roles are server-owned. No client path can set `role` or `trustedLender` on yourself.
- Input is validated twice: Convex validators for types and enums, plus explicit length limits, control-character stripping and date logic in mutations.

**Data minimisation**
- Convex copies **only the first name** from Clerk. No email, last name, phone or avatar is stored or shown to other users.
- The public page shows tool **name and category only**: no owner, description or loan data. Unit tests assert the exact keys returned.
- Webhook payloads carry only what the message needs. The borrower's free-text note, descriptions, Clerk ids and emails **never leave Convex**. A test asserts that a phone number typed in a note isn't in the outbox payload.
- The overdue endpoint returns only the fields a reminder needs, for loans that need one today.
- n8n does not save successful execution data (`saveDataSuccessExecution: none`). Failed executions are pruned after 7 days (`EXECUTIONS_DATA_MAX_AGE=168`). Telemetry is disabled.
- n8n strips user-supplied names of Discord markdown and `@` mentions before posting, so a display name like `@everyone` can't ping a channel.

**Secrets**
- No secrets in code, workflow JSON or git. `.env*` files are ignored and `export.sh` refuses to export if a secret is found.
- The n8n credentials (Discord webhook and the two HMAC keys) are created from `n8n/.env` by `setup.sh` via stdin and stored encrypted by n8n.
- The n8n container env contains **no secrets**. `N8N_ENCRYPTION_KEY` is a Docker secret file, because workflow expressions can read the environment.
- Each direction uses its own HMAC key.

**Network surface**
- The n8n editor is bound to `127.0.0.1`.
- The optional tunnel goes through a Caddy gateway that forwards **only** `POST /webhook/lendloop-loan-events`, with a 64 KB body limit. The UI, REST API and `/webhook-test/` are never exposed.
- Convex HTTP endpoints accept only signed requests, cap the body at 10 KB, validate the shape, return generic errors, and log the reason server-side.

**Web app**
- Security headers: HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict `Referrer-Policy` and a `Permissions-Policy`. `X-Powered-By` is removed.
- React escapes all rendered text. There's no `dangerouslySetInnerHTML`.

---

## Testing

```bash
npm test          # 18 Vitest tests running Convex functions in-memory (convex-test)
npm run typecheck
npm run lint
```

- [convex/rbac.test.ts](convex/rbac.test.ts) covers:
  - the public list's exact fields, and that signed-out users can't read the catalogue;
  - that non-owners can't edit or delete, and that an admin can remove any listing;
  - that users can't grant themselves trust or open the admin view;
  - that you can't borrow your own tool;
  - that only the lender can approve, and that overlapping requests are auto-declined;
  - that outbox payloads are minimal;
  - that only the lender can mark a loan returned.
- [convex/integration.test.ts](convex/integration.test.ts) covers:
  - signature validity, tampering, wrong secret and stale timestamps;
  - that HTTP endpoints reject unsigned requests;
  - that the overdue payload has exactly the expected fields;
  - idempotent claim/sent/failed sequences (a single record, never downgraded);
  - re-claiming after a failure;
  - malformed write-backs;
  - webhook retry on 503 then success, with the outgoing signature verified;
  - that a 401 fails immediately.

I also ran the whole loop end to end: local Convex, n8n 2.48 in Docker and a mock Discord endpoint. I checked notifications, a replayed event (no duplicate), a tampered signature (401), reminders run twice (one message), Discord down (failure recorded, then the error-workflow alert), and Convex retrying after n8n was briefly unavailable.

---

## What I would change for production

- **Hosting:** run n8n on a managed host or n8n Cloud behind TLS with SSO, PostgreSQL instead of SQLite, queue mode with workers, and a pinned image version (`N8N_VERSION`) with an upgrade process. Replace the quick tunnel with a named Cloudflare Tunnel or a proper ingress, keeping the "only the webhook path" rule.
- **Secrets:** use a secrets manager (AWS Secrets Manager / SSM, or n8n external secrets) with **rotation**. Support two active HMAC keys during rotation (accept `kid`-tagged signatures).
- **Real notifications:** send DMs or email to the actual user instead of a shared Discord channel. That needs a contact channel per user (Clerk email, fetched just-in-time by an action and never stored in Convex) and per-user notification preferences and opt-out.
- **Roles:** manage roles in Clerk Organizations or an admin UI with an audit trail. Today, promoting someone is a CLI operation.
- **Audit log:** an append-only table of security-relevant actions (role changes, admin removals, trust changes) with actor and timestamp.
- **Observability:** Sentry for the Next.js app and Convex functions. Datadog (or Convex log streams) for structured logs and alerts on outbox `failed` counts, retry rates and n8n error-workflow runs. A dead-letter view already exists in *Admin*.
- **Scale:** paginate lists (`paginate()` instead of `take(200)`), keep a denormalised `currentLoanId` on tools instead of per-tool loan queries, and add a Convex cron to sweep stale `pending` deliveries as a safety net behind the scheduler.
- **Abuse controls:** rate-limit requests per user (e.g. `@convex-dev/rate-limiter`), cap open requests per borrower, and add a report-listing flow.
- **Timezones:** loan dates are UTC calendar days. Store a neighbourhood or user timezone for "overdue" and reminder timing.
- **Web hardening:** a nonce-based Content-Security-Policy that allow-lists Clerk and Convex origins. Add CI running lint, typecheck, tests and a secret scanner (gitleaks) on every PR, plus Dependabot.
- **Data lifecycle:** account deletion via a Clerk `user.deleted` webhook (verified with Svix) that anonymises loans and removes listings, plus retention limits on `automationEvents` and `webhookDeliveries`.

---

## Project structure

```
app/
  page.tsx                 public landing page
  (app)/layout.tsx         sign-in gate + AppShell (profile bootstrap, nav)
  (app)/tools|listings|requests|incoming|admin/page.tsx
components/                UI (ToolForm, RequestForm, LoanCard, ActivityList, …)
convex/
  schema.ts                data model
  lib/auth.ts              authorization helpers
  lib/signature.ts         HMAC signing / verification
  lib/validators.ts        shared enums + limits
  users.ts tools.ts loans.ts admin.ts
  notifications.ts         outbox writer + payload shape
  webhooks.ts              outbound delivery with retries
  automation.ts            overdue query + idempotent write-back
  http.ts                  signed endpoints for n8n
  seed.ts                  demo data (internal)
  *.test.ts                Vitest + convex-test
n8n/
  docker-compose.yml       n8n, plus optional webhook-only gateway and tunnel
  Caddyfile                gateway allow-list
  setup.sh / export.sh     import credentials + workflows / safe re-export
  workflows/*.json         exported workflows (no secrets)
proxy.ts                   Clerk middleware (session only)
```
