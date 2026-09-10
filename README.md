# NAKSHATRA (নক্ষত্র)
### Autonomous Bilingual AI Broadsheet & Editorial Newsroom

[![Next.js](https://img.shields.io/badge/Next.js-15.1-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.38-brightgreen?style=flat)](https://orm.drizzle.team/)
[![Gemini API](https://img.shields.io/badge/Google_Gemini-2.5-orange?style=flat&logo=google)](https://ai.google.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38bdf8?style=flat&logo=tailwindcss)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**NAKSHATRA** is an autonomous, high-signal AI broadsheet and editorial newsroom. It ingests primary AI research and industry updates, clusters them into narrative events, fact-verifies claims against original papers, and synthesizes balanced, publication-grade journalism simultaneously in **English** and **Bengali (বাংলা)**.

Designed with a tactile broadsheet aesthetic — warm newsprint cream canvas, structural hairline rules, strict typographic hierarchy, and zero superficial SaaS clutter — NAKSHATRA delivers high-density, evidence-anchored intelligence.

---

## ✦ Key Features

- **Automated Research Ingestion**: Real-time RSS and web feed polling from top AI research labs (Google DeepMind, OpenAI, Anthropic, Meta AI, arXiv, etc.).
- **Semantic Story Clustering**: Intelligent grouping of related dispatches into coherent narrative storylines using temporal windowing and deduplication.
- **Fact Verification & Primary Grounding**: Verification engine leveraging Jina Reader and Tavily to cross-reference claims directly against published whitepapers and preprints.
- **Autonomous Bilingual Synthesis**: Powered by Google Gemini (`gemini-2.5-flash` / `gemini-2.5-pro`), drafting complete articles, executive decks, and key takeaways in both English and Bengali.
- **Newsprint Editorial Design System**: Custom typography with **Satoshi** (Brand & Display) paired with **Hind Siliguri** (Bengali Editorial), built on a warm `#fdfcf3` newsprint palette with Signal Magenta accents.
- **Admin Newsroom & Observability**: Dedicated dashboard (`/admin/newsroom`) to inspect active pipeline runs, review drafts, promote breaking stories, or reject unverified dispatches.
- **Dual-Engine Database Persistence**: Zero-setup local development with embedded **PGlite** (in-process PostgreSQL) and plug-and-play **PostgreSQL** (Neon, Supabase, AWS RDS) for production.
- **Scheduled Automated Publishing**: Vercel Cron integration for periodic pipeline scraping and automated daily newsletter dispatches via **Resend**.

---

## 🏛 System Architecture

```mermaid
flowchart TD
    subgraph Ingestion ["1. Discovery & Ingestion"]
        Feeds["RSS Feeds & Research Trackers<br/>(arXiv, DeepMind, OpenAI, Anthropic)"]
        Scraper["Poller & Jina Reader"]
        Feeds --> Scraper
    end

    subgraph Pipeline ["2. Autonomous Editorial Engine"]
        Clusterer["Semantic Story Clusterer<br/>(Temporal Windowing & Deduplication)"]
        Verifier["Fact Verifier & Citation Anchor<br/>(Primary Source Deep Fetch)"]
        Writer["Gemini Bilingual Writer<br/>(English + Bengali Synthesis)"]
        
        Scraper --> Clusterer
        Clusterer --> Verifier
        Verifier --> Writer
    end

    subgraph Storage ["3. Resilient Persistence (Drizzle ORM)"]
        DB[("PostgreSQL / Neon (Prod)<br/>PGlite (Local Dev)")]
        Writer --> DB
    end

    subgraph Distribution ["4. Multi-Channel Broadsheet Delivery"]
        Web["Next.js 15 Broadsheet Web Edition<br/>(/ & /article/:slug)"]
        Admin["Editorial Newsroom & Observability<br/>(/admin/newsroom)"]
        Newsletter["Resend Email Dispatch<br/>(Bilingual Daily Issue)"]
        
        DB --> Web
        DB --> Admin
        DB --> Newsletter
    end
```

---

## 📁 Repository Structure

```text
├── src/
│   ├── app/                      # Next.js 15 App Router (Pages, Layouts & APIs)
│   │   ├── admin/                # Newsroom administration & observability dashboard
│   │   ├── api/                  # REST endpoints & Vercel cron hooks
│   │   │   ├── cron/pipeline/    # Automated background ingestion trigger
│   │   │   ├── cron/newsletter/  # Daily subscriber newsletter dispatch
│   │   │   └── admin/stories/    # Editorial curation endpoints
│   │   ├── article/[slug]/       # Full bilingual article broadsheet reader
│   │   └── page.tsx              # Main broadsheet front page
│   ├── db/                       # Database schema, migration, and connection pooling
│   │   ├── index.ts              # Dual-driver DB client (PostgreSQL / PGlite)
│   │   └── schema.ts             # Articles, clusters, sources, subscriptions schema
│   ├── server/                   # Pipeline execution & agent orchestrator
│   │   ├── agents/               # Gemini Clusterer, Writer, and Verifier agents
│   │   └── worker.ts             # End-to-end background ingestion worker
│   └── services/                 # External service integrations
│       ├── ai/                   # Gemini API & Mock AI provider
│       ├── editorial/            # Article manager and publication lifecycle
│       ├── research/             # Jina Reader, Tavily & fact checking
│       └── newsletter/           # Resend email compiler & delivery
├── scripts/                      # Operational CLI scripts & live probes
│   ├── live-api-probe.ts         # Live API integration validation test
│   ├── smoke-test.ts             # End-to-end pipeline verification test
│   └── worker.ts                 # CLI entry point to run pipeline worker
├── vercel.json                   # Vercel deployment & cron schedule definitions
└── nakshatra-design-system.md    # Official tokens, palette, and typography guide
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.18+ or v20+
- **npm** or **pnpm**
- (Optional) A PostgreSQL instance (e.g. [Neon](https://neon.tech/)) for persistent cloud storage. If omitted, the app will run locally with embedded PGlite.

### 2. Installation
```bash
git clone https://github.com/xeon797/nakshatra.git
cd nakshatra
npm install
```

### 3. Environment Configuration
Copy the example environment file:
```bash
cp .env.example .env.local
```

Fill in the necessary configuration:
```ini
# Google Gemini API (Required for AI synthesis)
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_MODEL="gemini-2.5-flash"
GEMINI_PRO_MODEL="gemini-2.5-pro"

# Database Connection
# Leave empty for zero-setup local embedded PGlite, or provide your cloud PostgreSQL URL:
DATABASE_URL="postgres://username:password@ep-your-neon-host.neon.tech/nakshatra?sslmode=require"

# Admin & Security
ADMIN_API_SECRET="your-admin-passphrase"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Optional External Services
TAVILY_API_KEY=""       # Secondary search grounding
JINA_API_KEY=""         # Deep research paper reading
RESEND_API_KEY=""       # Email newsletter delivery
```

### 4. Running the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the broadsheet newsroom.

### 5. Running the Pipeline Worker
Trigger an editorial ingestion and writing run manually:
```bash
# Run one ingestion cycle and exit
npm run worker:once

# Or keep the worker running continuously in the background
npm run worker
```

---

## 🧪 Testing & Verification

NAKSHATRA includes full unit, integration, and live API test suites powered by [Vitest](https://vitest.dev/):

```bash
# Run all unit and integration test suites
npm test

# Run the end-to-end pipeline smoke test
npm run smoke:test

# Run live API connectivity and token probe
npm run integration:test:live
```

---

## ☁️ Deploying to Vercel

### Step 1: Push to GitHub & Import
1. Import this repository into your [Vercel Dashboard](https://vercel.com/new).
2. Framework Preset: **Next.js** (detected automatically).

### Step 2: Configure Environment Variables
Add the following in your Vercel Project Settings > **Environment Variables**:
- `GEMINI_API_KEY`: Your Google Gemini API key.
- `DATABASE_URL`: A serverless PostgreSQL connection string (such as [Neon](https://neon.tech/) or [Supabase](https://supabase.com/)).
- `ADMIN_API_SECRET`: Secret passphrase for admin route authentication.
- `NEXT_PUBLIC_APP_URL`: Your Vercel production URL (e.g. `https://nakshatra.vercel.app`).
- `RESEND_API_KEY`: (Optional) Your Resend API key for email dispatches.

### Step 3: Cron Jobs
Vercel automatically picks up [`vercel.json`](vercel.json) to schedule autonomous editorial workflows:
- **`*/15 * * * *`** (`/api/cron/pipeline`): Ingests latest research and clusters new stories every 15 minutes.
- **`0 2 * * *`** (`/api/cron/newsletter`): Compiles and delivers the bilingual newsletter daily at 02:00 UTC.

---

## 🎨 Design System & Typography

NAKSHATRA is built to evoke tactile broadsheet newspapers:
- **Palette**: Newsprint Cream (`#fdfcf3`), Ink Black (`#120424`), Nocturne Plum (`#1e0a3c`), Signal Magenta (`#d91b74`).
- **English Typography**: **Satoshi** — engineered for editorial authority and crisp headline hierarchy.
- **Bengali Typography**: **Hind Siliguri** — tuned with extended leading for flawless rendering of complex conjuncts (যুক্তবর্ণ).

See [`nakshatra-design-system.md`](nakshatra-design-system.md) for full token specifications.

---

## 📜 License
MIT License. Crafted with editorial care by the Nakshatra team.
