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

## Render Deployment

This repo includes a Render Blueprint in `render.yaml` for a full Render-hosted deployment:

- `ai-workforce-web` — Next.js frontend web service
- `ai-workforce-api` — NestJS backend web service
- `ai-workforce-db` — Render Postgres database
- `ai-workforce-redis` — Render Key Value service for Bull queues
- `ai-workforce-api-data` — persistent disk mounted at `/var/data` for uploads and generated documents

### First Deploy

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Render will provision the frontend, backend, database, Redis-compatible Key Value service, and API disk.
4. Fill in the secret environment variables Render marks as unsynced, such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, SMTP, and Twilio values.
5. After the first successful API deploy, run the seed command once from the API service shell:

```bash
pnpm db:seed
```

The API build command runs Prisma generate and `prisma migrate deploy` automatically. The frontend points to `https://ai-workforce-api.onrender.com/api/v1`, and the backend allows `https://ai-workforce-web.onrender.com` as its frontend origin.

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:seed` | Seed agent templates |
