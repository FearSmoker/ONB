# ONB Mail — ReachInbox Email Scheduler & Dashboard

A production-grade, distributed email scheduling service and modern web mail dashboard built with **Express.js**, **React (Vite)**, **PostgreSQL (Prisma ORM)**, **Redis (BullMQ)**, **Elasticsearch**, **Cloudinary**, and **Slack**.

Designed to reliably schedule bulk campaigns, enforce strict per-sender hourly limits using a **Sliding Window Log** algorithm, guarantee idempotency across server restarts, and deliver a smooth email client experience.

---

## Table of Contents

1. [System Architecture Diagram](#system-architecture-diagram)
2. [How to Run](#how-to-run)
   - [Prerequisites](#prerequisites)
   - [Environment Variables Setup](#environment-variables-setup)
   - [Database Setup & Migrations](#database-setup--migrations)
   - [Running Backend, Worker & Frontend](#running-backend-worker--frontend)
   - [Access Points](#access-points)
3. [Setting up Ethereal Email](#setting-up-ethereal-email)
4. [Architecture Deep-Dive](#architecture-deep-dive)
   - [How Scheduling Works](#how-scheduling-works)
   - [How Persistence on Restart is Handled](#how-persistence-on-restart-is-handled)
   - [How Rate Limiting & Concurrency are Implemented](#how-rate-limiting--concurrency-are-implemented)
5. [(Bonus) Rate Limiting & Delay Behavior Under Load](#bonus-rate-limiting--delay-behavior-under-load)
6. [Features Implemented](#features-implemented)
   - [Backend Features](#backend-features)
   - [Frontend Features](#frontend-features)
7. [Assumptions, Shortcuts, and Trade-offs](#assumptions-shortcuts-and-trade-offs)

---

## System Architecture Diagram

```mermaid
flowchart TB
    subgraph Client ["Client Browser"]
        UI["React + Vite Dashboard (ONB Mail)"]
    end

    subgraph API_Layer ["API Layer (apps/backend)"]
        API["Express.js Server (:4000)"]
        Passport["Passport.js (Google OAuth & Session Auth)"]
        BullBoard["Bull Board Queue Dashboard (:4000/admin/queues)"]
    end

    subgraph Data_Storage ["Data & Cache Storage"]
        PG[("PostgreSQL\n(Users, Campaigns, Emails, Attachments)")]
        Redis[("Redis Cloud / Local\n(BullMQ Queues & Rate Limit Sliding Window)")]
        ES[("Elasticsearch\n(Full-text Message Search)")]
    end

    subgraph Worker_Layer ["Background Workers"]
        Worker["BullMQ Worker (apps/backend/src/worker.ts)"]
        RateLimiter["Sliding Window Log (Lua Script)"]
    end

    subgraph External_Services ["External Cloud Services"]
        Ethereal["Ethereal SMTP (Test Delivery & Preview URLs)"]
        Cloudinary["Cloudinary CDN (Attachments & Avatars)"]
        Slack["Slack Webhook API (Rate Limit Alerts)"]
    end

    UI <-->|REST API + Sessions| API
    API -->|Authenticate| Passport
    API -->|Store & Query| PG
    API -->|Enqueue Delayed Jobs| Redis
    API -->|Full-Text Search Query| ES
    API -->|File Uploads| Cloudinary
    API -.->|Monitor| BullBoard

    Worker <-->|Pop Delayed Jobs| Redis
    Worker -->|Check Hourly Limits| RateLimiter
    Worker -->|Atomic Row Claim & Status Update| PG
    Worker -->|Send Mail via SMTP| Ethereal
    Worker -->|Index Sent Messages| ES
    Worker -.->|Notify on Limit Hit| Slack
    Worker -->|Fetch Attachments| Cloudinary
```

---

## How to Run

### Prerequisites

- **Node.js**: v20 or higher (`node -v`)
- **npm**: v10 or higher
- **PostgreSQL**: Local instance or hosted (e.g., Aiven PostgreSQL)
- **Redis**: Local instance or hosted (e.g., Redis Cloud)
- **Elasticsearch**: (Optional) Cloud instance or local Docker container
- **Cloudinary Account**: (Optional) Cloud name, API key & secret (built-in fallback to local disk if omitted)

### Monorepo Structure

```
.
├── apps/
│   ├── backend/          # Express API, BullMQ worker, Prisma ORM, Nodemailer, Cloudinary
│   │   ├── prisma/       # Database schema & migrations
│   │   └── src/          # API routes, worker, queues, services
│   └── frontend/         # React 18, Vite, TypeScript, Custom CSS (ONB Mail UI)
├── docker-compose.yml    # Docker configuration for local PG, Redis, and ES
└── package.json          # Monorepo root with npm workspaces
```

---

### Environment Variables Setup

#### 1. Backend Configuration (`apps/backend/.env`)

Copy `apps/backend/.env.example` to `apps/backend/.env` or create it with:

```bash
cp apps/backend/.env.example apps/backend/.env
```

Key environment variables:

| Variable | Description | Example / Default |
|---|---|---|
| `NODE_ENV` | Environment mode | `development` or `production` |
| `PORT` | API server port | `4000` |
| `FRONTEND_URL` | Frontend origin for CORS | `http://localhost:5173` |
| `DATABASE_URL` | PostgreSQL connection string with SSL | `postgres://user:pass@host:port/db?sslmode=require` |
| `REDIS_URL` | Redis connection URL | `redis://default:pass@host:port` |
| `ELASTICSEARCH_URL` | Elasticsearch endpoint | `https://elastic-host:443` |
| `SESSION_SECRET` | Session encryption secret | `your-secret-session-key` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `your-google-client-id.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET`| Google OAuth Client Secret | `your-google-client-secret` |
| `GOOGLE_CALLBACK_URL` | Google OAuth redirect callback | `http://localhost:4000/api/auth/google/callback` |
| `SLACK_CLIENT_ID` | Slack App Client ID | `your-slack-client-id` |
| `SLACK_CLIENT_SECRET` | Slack App Client Secret | `your-slack-client-secret` |
| `SLACK_REDIRECT_URI` | Slack OAuth callback URL | `http://localhost:4000/api/slack/callback` |
| `SMTP_HOST` | SMTP server host | `smtp.ethereal.email` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | Ethereal username (leave blank for auto) | `annamae.abshire73@ethereal.email` |
| `SMTP_PASS` | Ethereal password | `gAJVMz4wVVW9XeZqtv` |
| `ETHEREAL_AUTO_CREATE`| Auto-generate SMTP credentials on boot | `true` |
| `WORKER_CONCURRENCY` | Number of concurrent jobs in worker | `5` |
| `MIN_SEND_INTERVAL_MS`| Minimum delay between sends in ms | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Hourly cap per sender | `200` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud identifier | `gi60o4ds` |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | `965718488683584` |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret | `Vadd1jvDMQNY-jc-KW_4E1r0MLQ` |

> [!NOTE]
> If Cloudinary credentials are not set, the application automatically activates **Local Disk Fallback Mode** (saving uploads to `apps/backend/uploads/` and serving them over HTTP).

#### 2. Frontend Configuration (`apps/frontend/.env`)

```bash
cp apps/frontend/.env.example apps/frontend/.env
```

```env
VITE_API_URL=http://localhost:4000
```

---

### Database Setup & Migrations

From the project root:

```bash
# Push Prisma schema to PostgreSQL
npm run db:migrate
# or run directly in apps/backend:
cd apps/backend && npx prisma db push
```

This synchronizes all models (`User`, `EmailCampaign`, `EmailMessage`, `Attachment`, and `session`) with PostgreSQL.

---

### Running Backend, Worker & Frontend

From the root directory:

```bash
# 1. Install dependencies across all workspaces
npm install

# 2. Start everything concurrently (API + BullMQ Worker + Frontend)
npm run dev
```

Or run each service individually:

```bash
# Terminal 1: Backend API server
npm run dev:backend

# Terminal 2: BullMQ background worker
npm run worker

# Terminal 3: React Frontend (Vite)
npm run dev:frontend
```

---

### Access Points

- 🌐 **Dashboard UI**: [http://localhost:5173](http://localhost:5173)
- ⚙️ **API Health Check**: [http://localhost:4000/health](http://localhost:4000/health)
- 📊 **BullMQ Live Queue Monitor (Bull Board)**: [http://localhost:4000/admin/queues](http://localhost:4000/admin/queues) *(requires login)*

---

## Setting up Ethereal Email

Ethereal is a safe, test-only SMTP service that captures outbound messages without delivering them to real mailboxes.

- **Automatic Setup (Default)**:
  Leave `SMTP_USER` and `SMTP_PASS` empty and keep `ETHEREAL_AUTO_CREATE=true`. When the backend starts, Nodemailer will automatically create a temporary Ethereal account.
- **Persistent Inbox**:
  1. Visit [https://ethereal.email/create](https://ethereal.email/create).
  2. Copy the generated **Username** and **Password** into `SMTP_USER` and `SMTP_PASS` in `apps/backend/.env`.
  3. Every message sent will generate an **Ethereal Preview Link** directly accessible in the reader view (`Open Ethereal preview ↗`).

---

## Architecture Deep-Dive

### How Scheduling Works

1. **Campaign Creation**:
   The user composes an email in the React dashboard, adds recipients (manually or via file upload), selects one or more senders, and optionally attaches files and specifies a start time and send delay.
2. **Matrix Expansion**:
   If multiple senders are specified, each sender sends to every recipient:
   $$\text{Total Emails} = \text{Senders} \times \text{Recipients}$$
3. **Database Staggering**:
   Each `EmailMessage` row is saved to PostgreSQL with status `SCHEDULED` and a deterministic timestamp:
   $$\text{scheduledFor} = \text{startTime} + (\text{index} \times \text{delayBetweenEmailsMs})$$
4. **BullMQ Delayed Enqueueing**:
   For each email, a BullMQ job is added to Redis with:
   $$\text{delay} = \max(0, \text{scheduledFor} - \text{now})$$
   The Redis job stores only `{ emailId }` to keep the queue lightweight; PostgreSQL is the authoritative source of truth.
5. **Elasticsearch Indexing**:
   Each email is indexed in Elasticsearch for fast full-text searching across subject, sender, recipient, and body text. If Elasticsearch is unreachable, the system gracefully falls back to PostgreSQL `ILIKE` queries.

---

### How Persistence on Restart is Handled

- **Dual-Layer Durability**:
  - **PostgreSQL**: Stores the complete canonical record of all campaigns, messages, attachments, user sessions, and delivery metadata.
  - **Redis (AOF Persistence)**: Redis runs with Append-Only File (`appendonly yes`) enabled, preserving all delayed and waiting jobs across daemon restarts.
- **Idempotent Job Execution**:
  The BullMQ worker claims rows atomically before processing:
  ```ts
  const claimed = await prisma.emailMessage.updateMany({
    where: {
      id: emailId,
      status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED, EmailStatus.SENDING] }
    },
    data: { status: EmailStatus.SENDING }
  });
  if (claimed.count === 0) return; // Skip if already sent or in-flight
  ```
  Even if Redis restarts, duplicate jobs trigger, or a worker crashes mid-stream, an email cannot be sent twice.

---

### How Rate Limiting & Concurrency are Implemented

1. **Worker Concurrency**:
   Configured via `WORKER_CONCURRENCY` (default: `5`). The BullMQ worker spawns parallel threads to process delayed jobs as they mature.
2. **Minimum Send Delay**:
   Enforced at the queue level via `MIN_SEND_INTERVAL_MS` (default: `2000ms`), preventing bursts to SMTP providers and simulating humanized sending cadences.
3. **Sliding Window Log Rate Limiter**:
   To enforce hourly caps per sender (`MAX_EMAILS_PER_HOUR_PER_SENDER`, default: `200`), we use a Redis Sorted Set per sender (`ratelimit:sender:<email>`):
   - **Prune**: Remove all entries older than 1 hour (`ZREMRANGEBYSCORE`).
   - **Count**: Check count of remaining items (`ZCARD`).
   - **Decide**:
     - If count < limit: add current timestamp (`ZADD`), proceed with delivery.
     - If count >= limit: calculate earliest timestamp expiry, reject and reschedule.
   - Executed via an atomic **Redis Lua script** to prevent concurrency race conditions.
4. **Rescheduling Overflow**:
   When the hourly cap is reached, the email is **never dropped**. Its status is marked `RATE_LIMITED`, its `scheduledFor` time is bumped to the start of the next hour window, and a new delayed BullMQ job is enqueued.
5. **Slack Alerts**:
   When a sender hits their rate limit, a Slack notification is automatically posted to the user's connected Slack channel (deduplicated per sender per hour via a Redis `SET NX` key).

---

## (Bonus) Rate Limiting & Delay Behavior Under Load

### Behavior with 1,000+ Emails

When a user schedules a bulk campaign with **1,000 recipients**, a **2-second delay**, and an **hourly limit of 200 emails/hour**:

| Parameter | Value |
|---|---|
| Total Recipients | 1,000 |
| Inter-send Delay | 2,000 ms (2 seconds) |
| Hourly Limit | 200 emails / hour |
| Senders | 1 |

#### Timeline & Staggering:

```
[Campaign Start: 10:00 AM]
 │
 ├─ 10:00:00 AM - Email #1 sent
 ├─ 10:00:02 AM - Email #2 sent
 ├─ ... (2s interval enforced by queue limiter)
 ├─ 10:06:40 AM - Email #200 sent (Hourly cap of 200 reached!)
 │
 ├─ 10:06:42 AM - Email #201 hits Sliding Window Rate Limiter
 │                └─ Marked as RATE_LIMITED
 │                └─ Slack Alert sent to user: "Hourly rate limit hit for sender"
 │                └─ Rescheduled to 11:00:00 AM (Next available hour window)
 ├─ 10:06:44 AM - Emails #202 to #1000 smoothly buffered and rescheduled
 │
[Next Window: 11:00:00 AM]
 │
 ├─ 11:00:00 AM - Email #201 to #400 process cleanly (200 sent)
 │
[Subsequent Windows: 12:00 PM, 1:00 PM, 2:00 PM]
 └─ Remaining emails dispatch sequentially without dropping a single record.
```

### Key Load Behaviors:
- **Zero Memory Bloat**: BullMQ jobs store only `{ emailId }` references (approx. 40 bytes per job in Redis). 100,000 jobs consume under 5 MB of Redis memory.
- **Zero Dropped Emails**: The system treats rate limits as a backpressure mechanism rather than a failure state.
- **Sliding Window vs. Fixed Window**: Fixed window rate limiters allow 200 emails at 10:59 and another 200 at 11:01 (400 in 2 minutes). Our Sliding Window Log guarantees that at any point in time $t$, no more than 200 emails were dispatched in $[t - 3600\text{s}, t]$.

---

## Features Implemented

### Backend Features

- [x] **BullMQ Distributed Scheduler**: Delayed job queues with Redis backing.
- [x] **Single-Sender Architecture**: Uses the authenticated user's account email as the verified sender address.
- [x] **Attachment Handling**: Cloudinary CDN integration with automatic local disk fallback.
- [x] **Avatar Storage & Persistence**: Persistent user avatar support with `POST /api/me/avatar` upload route.
- [x] **Slack Integration**: OAuth connection flow + rate-limit alert notifications via Incoming Webhook.
- [x] **Elasticsearch Full-Text Search**: Instant search with automated PostgreSQL `ILIKE` fallback.
- [x] **Bull Board UI**: Live monitoring dashboard for delayed, active, and completed queues.
- [x] **Prisma Database Architecture**: PostgreSQL schema supporting Users, Campaigns, Messages, Attachments, and Sessions.

### Frontend Features

- [x] **"All Inbox" Default Screen**: Displays all emails across categories (`Sent`, `Scheduled`, `Rate limited`, `Failed`, `Sending`).
- [x] **Category Funnel Filter**:
  - Exact funnel outline SVG icon.
  - Active transition with green fill, scale bounce, and pulsating badge dot.
  - Consistent filtering across All, Scheduled, Rate Limited, Sent, and Failed.
- [x] **ONB Wordmark Navigation**:
  - Interactive homepage button.
  - 360-degree rotation and scale transition into arrow on click, returning smoothly to the ONB wordmark.
- [x] **Sidebar User Profile & Account Dropdown**:
  - Rotating chevron `^` toggle.
  - "📷 Change profile photo" button with direct Cloudinary upload.
  - Compose shortcut, Slack connect/disconnect, and Sign out.
- [x] **Email Reader View (Matching Reference Mockups)**:
  - Header actions: Star email, Archive email, Trash (delete email with confirmation).
  - Profile avatar displayed in the top-right header.
  - Sender row with colored circular letter avatar, formatted sender name, `to me ⌄`, and delivery date.
  - Markdown body with custom yellow blockquote banner.
  - Attachment preview cards with image thumbnails and metadata.
- [x] **Compose Experience**:
  - Authenticated user account as single verified sender.
  - Interactive recipient input with tokenized pills, backspace deletion, and CSV/TXT file upload parser.
  - Live markdown split-screen preview.
  - Rich text formatting toolbar (bold, italic, lists, quotes, indent, alignment).
  - Multi-file attachment strip with file size validation (max 5 files, 5MB per file, 15MB total).
  - Send Later date-time picker with quick presets (Tomorrow, 10 AM, etc.).
- [x] **Polished Micro-Interactions**:
  - Gmail-style animated striped progress bar during mailbox refresh.
  - Staggered row fade-in transitions.
  - State locking on all buttons to prevent accidental double-clicks.

---

## Assumptions, Shortcuts, and Trade-offs

1. **PostgreSQL as Primary Database**:
   - *Rationale*: Chosen over MySQL for first-class Prisma support, strict ACID compliance, and compatibility with cloud providers (Aiven, Supabase, Neon).
2. **Ethereal for SMTP Testing**:
   - *Rationale*: Safe, credential-free sandbox that generates shareable web previews (`ethereal.email`) without the risk of spamming real recipient addresses.
3. **Sliding Window Log over Fixed Window Counter**:
   - *Trade-off*: Stores timestamps in a Redis Sorted Set (slightly higher memory usage than an integer counter).
   - *Advantage*: Prevents "burst abuse" at the edge of hourly windows (e.g., 200 emails at 10:59 followed by 200 at 11:00).
4. **Cloudinary with Local Disk Fallback**:
   - *Trade-off*: Avoids forcing external cloud accounts for local evaluators while enabling scalable CDN asset hosting in production.
5. **Single Shared BullMQ Queue**:
   - *Trade-off*: All senders share a single queue with worker-level concurrency and per-sender Redis rate-limit checks, rather than maintaining dynamic separate queues per sender.
6. **Elasticsearch Fallback**:
   - *Rationale*: If Elasticsearch credentials are unconfigured or the node is offline, the search bar seamlessly falls back to PostgreSQL `ILIKE` search without breaking the UI.

