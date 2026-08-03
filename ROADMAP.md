# Roadmap

Versioning follows [SemVer](https://semver.org/). New scoped versions are planned roughly every
3-6 months; scope may shift based on business priority.

## v1.0.0 — Foundation (current)
The first real, tagged release. Everything built to date:
- Multi-agent chat platform (per-role specialist agents, handoffs, tool-calling, streaming)
- ChatGPT-like memory system (working/profile/episodic/task memory, embeddings, subject-key resolution)
- CRM + ticketing + internal task system, with recurring/scheduled tasks (e.g. daily emailed reports)
- AI Social Media Manager: proactive daily wake, campaign auto-triggers, content calendar with manual
  publish approval, branded AI image generation (Puppeteer flyer compositing), comment/DM auto-replies
- Document generation (PDF via Puppeteer, HTML fallback) for quotes/estimates/supplements/reports
- Superadmin controls: feature flags (marketplace, custom agents, workforce reset), editable help guide
- Attachment handling for chat (PDF/Word/Excel/CSV extraction, sticky per-conversation document memory)

## v1.1.0 — ~3 months out: Reliability & Trust
- OCR fallback for scanned/image-only PDF attachments (no usable text today)
- Refresh-token / sliding-session auth so idle sessions actually expire daily, not just after a fixed TTL
- Baseline automated test coverage for the highest-risk flows (billing/CRM writes, document generation, tool dispatch)
- Structured error monitoring/alerting (e.g. Sentry) so failures like a silently-lost chat reply surface immediately instead of needing manual DB digging
- Social analytics: pull real engagement metrics (likes/comments/shares) back into the app, not just publish-and-forget

## v1.2.0 — ~6 months out: Platform Breadth
- Remaining social platforms from the original spec: TikTok, Pinterest, YouTube, Google Business Profile, Threads
- Video script → actual video generation/editing pipeline (currently script-only)
- Cross-agent collaboration polish: richer handoff context, shared campaign state between Social Manager and Sales/CRM agents
- Public API / webhooks for third-party integrations

## v1.3.0 — ~9-12 months out: Scale & Customization
- Per-tenant custom workflows / agent builder improvements beyond current marketplace templates
- Multi-language support for agents and generated documents
- Usage-based billing/metering if not already present

---

_Have feedback or want to reprioritize a version's scope? Update this file directly or raise it in chat._
