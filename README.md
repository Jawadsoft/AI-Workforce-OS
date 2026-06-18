# AI Workforce OS

> Multi-Tenant AI Employee Platform — Deploy an entire AI workforce for your business in minutes.

---

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ (with pgvector extension)
- Redis 7+

## Quick Start
### 1. Clone & Install

```bash
git clone <repo-url>
cd ai-workforce-os
pnpm install
```

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env with your database URL, API keys, etc.
```

### 3. Database Setup

```bash
# Run migrations
pnpm db:migrate

# Seed agent templates
pnpm db:seed
```

### 4. Start Development

```bash
# Start both apps simultaneously (Turborepo)
pnpm dev
```

| App | URL |
|-----|-----|
| Frontend (Next.js) | http://localhost:3000 |
| Backend (NestJS) | http://localhost:3001 |
| API Docs (Swagger) | http://localhost:3001/api/docs |

---

## Project Structure

```
ai-workforce-os/
├── apps/
│   ├── web/          # Next.js 15 frontend
│   └── api/          # NestJS backend
├── packages/
│   ├── types/        # Shared TypeScript types
│   └── utils/        # Shared utilities
├── prisma/           # Database schema & migrations
├── .env.example      # Environment variable template
├── turbo.json        # Turborepo config
├── pnpm-workspace.yaml
└── PRD.md            # Product Requirements Document
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, TailwindCSS, ShadCN, TanStack Query |
| Backend | NestJS, TypeScript, Prisma ORM |
| Database | PostgreSQL + pgvector |
| AI | OpenAI, Claude, Gemini (provider abstraction) |
| Queue | Redis + BullMQ |
| Realtime | Socket.IO |
| Storage | AWS S3 |
| PDF | Puppeteer |
| Monorepo | Turborepo + pnpm workspaces |

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:seed` | Seed agent templates |
