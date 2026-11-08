# WorkSphere: context for AI-assisted sessions (read first)

Multi-tenant project management SaaS. Node 20 + Express services, MongoDB (single-node replica set), Redpanda (Kafka API), Redis, MinIO, Mailpit, React frontend. No AWS.

## Non-negotiable rules
1. Each service owns its database. 2. Tenant access ONLY via `TenantRepository.forOrg(orgId)`; org comes from gateway headers, never the body.
3. Never publish to Kafka from a request handler: write business data + `outbox.enqueue` in one `withTransaction`. 4. Consumers go through `createMongoIdempotency().runOnce`;
handlers write with `ctx.session` and return a post-commit function for external effects. 5. Redis keys embed organizationId (`shared/redis` `keys`).
6. Events are defined in `shared/event-contracts` (task events carry a full snapshot + version). 7. Tests use fakes; keep new logic testable without Docker.

## Status
All 8 weeks of the plan are implemented (see README). 107 backend + 8 frontend tests pass.
**NOT yet run:** docker compose stack, real Mongo transactions, real Kafka, Socket.IO, OTel, Grafana, e2e tests, drills, k6.

## Next session: first steps
1. `docker compose up --build`; fix whatever is unhealthy (suspects: image tags, `mc ready local` healthcheck for MinIO, OTel package versions in `shared/tracing`, argon2 on node:20-slim).
2. `npm run test:e2e`; fix integration bugs the fakes could not reveal (transaction behaviour, Kafka headers, topic names).
3. Run drills + k6 and fill in the tables under `docs/`.
4. Optional hardening: httpOnly refresh cookie, Mongo/Redis/Kafka auth, TLS proxy, delayed retry topics, metrics for socket connections.

## Decisions worth remembering
- Access token 15 min HS256 {sub, orgId, role, plan}; gateway prefers the plan in Redis (`org:plan:{orgId}`) over the token's for rate limits.
- Rate limit key `rl:{org}:{user}` (per user within the org's plan limit); public auth endpoints per IP (30/min).
- Analytics project visibility: ADMIN/OWNER all, others only projects they belong to (members tracked from project events).
- Task list cache invalidation uses a per-project version token (`tasklist:ver:*`), membership cache is cleared by `project.events` consumer (`task-cache-group`).
- `CACHE_DISABLED=1` bypasses cache-aside (for k6 comparisons).
- Retry topics are shared; the `target-group` header makes only the failing group reprocess.
