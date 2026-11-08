# Security notes

Reviewed by reading the code; **not** penetration tested. Treat as a portfolio project, not a hardened product.

## In place
- argon2 passwords; identical error for unknown email / wrong password; 15-minute HS256 access tokens (algorithm pinned); rotating refresh tokens with reuse detection and instant revocation.
- Gateway strips client-supplied identity headers (`x-user-id`, `x-org-id`, `x-role`, `x-plan`, `x-internal-token`) before injecting verified ones. Only the gateway (and frontend) are published to the host.
- Tenant isolation in one place (`TenantRepository`), org id never taken from the request; 404 (not 403) for other tenants' resources.
- Input validated with zod everywhere; query-string objects (`?status[$ne]=x`) are rejected by the schemas (NoSQL injection); `$where`/`$function` are blocked in the repository.
- Rate limiting: per org+user by plan, per IP for login/register/refresh. Fails open if Redis is down (availability over strictness; change in `rateLimit.js` if you prefer fail-closed).
- Uploads: type allowlist, 10 MB cap (enforced again via HEAD on confirm), tenant/task-scoped keys, short-lived presigned URLs, `attachment` disposition on download.
- Production guard: auth, gateway and notification services refuse to start without `JWT_SECRET` when `NODE_ENV=production`.

## Known limitations (fix before real use)
- `.env.example` secrets are placeholders. Change `JWT_SECRET` and `INTERNAL_SERVICE_TOKEN`; MongoDB, Redis and Kafka run **without auth** inside the Docker network.
- Refresh token is in `localStorage` (survives reload, readable by any XSS). An httpOnly cookie is safer.
- Socket.IO verifies the token only at connect; an already-open socket survives token expiry or logout until it disconnects.
- Invite tokens travel inside the `MEMBER_INVITED` Kafka event so Notification can email the link; Kafka is trusted and unencrypted here.
- `trust proxy` is set to 1 so per-IP limits see the real client behind nginx; if the gateway port is exposed directly, clients can spoof `X-Forwarded-For` and dodge the per-IP limit. Keep exactly one trusted proxy in front.
- CORS defaults to `*`; set `CORS_ORIGIN` in production.
- @mentions accept any 24-hex id in the same org; unknown ids just create a notification nobody can read.
- No account lockout, email verification, password reset, audit of admin actions beyond the activity log, or TLS (terminate it at a reverse proxy).
