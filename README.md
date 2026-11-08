# WorkSphere

Multi-tenant, event-driven project management platform (simplified Jira / Trello / ClickUp).
Six Node.js services, MongoDB, Kafka-compatible Redpanda, Redis, MinIO, Socket.IO, a React frontend and a full observability stack,
all started with one command. No AWS.

One action fans out into independent reactions: **assigning a task** writes the task + an outbox row in one transaction; Kafka then
drives the notification, activity log and analytics read model separately, so any of them can be down without affecting the others.

## Status: all 8 weeks implemented

| Week | Delivered |
|---|---|
| 1 | Compose infra (Mongo replica set, Redis, Redpanda, MinIO, Mailpit), shared packages, Auth service, API gateway |
| 2 | `TenantRepository` + shared RBAC, Project service, internal membership API |
| 3 | Task service: CRUD, optimistic concurrency, workflow, assignment, comments with @mentions, history, MinIO attachments |
| 4 | Transactional outbox + relay, Kafka framework (idempotent consumers, retry topics, DLQ, replay tool), Notification and Analytics consumers |
| 5 | Redis cache-aside with invalidation, atomic Lua rate limiter, presence, unread counters, sessions |
| 6 | Socket.IO (Redis adapter), CQRS query endpoints, deadline reminders with distributed lock, email via Mailpit |
| 7 | React dashboard: Kanban, task drawer, live notifications, presence, analytics charts, Swagger per service |
| 8 | Prometheus / Grafana / Loki / Jaeger, k6 load tests, failure drills, scaling demo, docs |

### What has and has not been verified  (read this first)
**Verified:** 115 automated tests pass (107 backend + 8 frontend), the frontend production build succeeds, every JS file parses, Compose/Prometheus/Loki YAML is valid.
Backend tests use in-memory fakes for MongoDB/Kafka and an in-memory Redis (`ioredis-mock`, which does run the Lua rate limiter).

**Not yet run** (the build environment had no Docker, MongoDB or Kafka): `docker compose up`, real MongoDB transactions, real Kafka produce/consume,
Socket.IO, OpenTelemetry tracing, the Grafana dashboard, the end-to-end tests, the failure drills and the k6 runs. Expect to fix small integration
issues the first time (image tags, healthchecks, a version mismatch in the OpenTelemetry packages). See "First run checklist".

## Quick start

```bash
cp .env.example .env                # then change JWT_SECRET and INTERNAL_SERVICE_TOKEN
docker compose up --build           # first build takes a few minutes
```

| URL | What |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:3000/docs | Swagger UIs for all services (via the gateway) |
| http://localhost:3001 | Grafana, dashboard "WorkSphere Overview" |
| http://localhost:16686 | Jaeger traces |
| http://localhost:8080 | Redpanda Console (topics, consumer groups) |
| http://localhost:8025 | Mailpit (invite / reminder / assignment emails) |
| http://localhost:9001 | MinIO console (worksphere / worksphere-secret) |

Use it: register, create an organization, create a project, invite a teammate (Members page; the link is also emailed to Mailpit),
add them to the project, create tasks, drag cards, watch the bell and the dashboard update.

### First run checklist
1. `docker compose up --build` and wait until `docker compose ps` shows everything healthy. If a container is unhealthy, `docker compose logs <service>`.
2. `npm install && npm run test:e2e` runs 6 end-to-end tests against the stack (tenant isolation, roles, the assign fan-out, concurrency, token reuse, rate limits).
3. `node scripts/drills.js catchup|duplicate|poison|dlq-replay|scale` (see `docs/failure-drills.md`), then `k6 run k6/mixed.js` (see `docs/load-test-results.md`).
4. Fill in the result tables in `docs/`. They are empty on purpose.

## Services

| Service | Port | Owns | Notes |
|---|---|---|---|
| api-gateway | 3000 (public) | nothing | JWT verification, identity headers, plan-aware rate limit, proxies REST + WebSocket |
| auth-service | 4001 | users, organizations, memberships, invites | org-scoped tokens, refresh rotation, plan changes |
| project-service | 4002 | projects | cached reads, internal membership endpoint |
| task-service | 4003 | tasks, comments, history, attachments, outbox | optimistic concurrency, workflow, MinIO |
| notification-service | 4004 | notifications, preferences | consumer, Socket.IO, unread counters, presence, reminders |
| analytics-service | 4005 | read models, activity log | two consumer groups, CQRS query side |

Each service has its own MongoDB database. See `docs/architecture.md` for diagrams and the event flow.

## Commands

```bash
npm test                    # 107 backend tests (no Docker needed)
npm run test:all            # backend + frontend
npm run test:e2e            # against a running stack
node scripts/drills.js lag  # consumer group lag
node scripts/measure-lag.js # eventual-consistency window of the dashboard
node shared/kafka/src/replay-dlq.js task.events.dlq localhost:9092
```

## Key design decisions and trade-offs
- **Outbox over dual writes**: the event exists iff the write committed. Cost: a relay and at-least-once delivery, hence idempotent consumers.
- **Dedupe in the same transaction as the side effect** (Mongo): effectively exactly-once effects. Non-Mongo effects (socket push, email) run after commit and are best-effort.
- **Full snapshots in events** + version-guarded upserts: replays and reordering are harmless; events are larger than deltas.
- **CQRS read models** instead of cross-service queries: fast dashboards and independent failure; the data is eventually consistent and the UI says so.
- **Shared database server, one database per service, `organizationId` on every document**: simple multi-tenancy; one choke point (`TenantRepository`).
- **Redpanda** instead of Kafka for memory; same protocol, same client code.
- **Rate limiter fails open**: availability over strictness (documented, one line to flip).
- **Retry waits block a partition**: simple and ordered, but a long backoff delays later messages on that partition. Fine at this scale; use delayed retry topics at higher volume.

## Repository layout
```
frontend/react-app/   React + Tailwind + TanStack Query + Socket.IO client
services/             api-gateway, auth, project, task, notification, analytics
shared/               tenant-repo, rbac, outbox, kafka, read-models, redis, resilience,
                      event-contracts, logger, errors, validation, metrics, tracing, docs
infrastructure/       Dockerfile, Prometheus (+alert rules), Grafana (provisioned), Loki, Promtail
k6/  e2e/  scripts/  docs/
```

## Known limitations
See `docs/security-notes.md`. Highlights: no auth on MongoDB/Redis/Kafka inside the Docker network, refresh token in `localStorage`,
no TLS, no email verification or password reset, single-node everything (so no real HA).
