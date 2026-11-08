# Load test results

Scripts live in `k6/` (install k6: https://k6.io). They create their own org and project through the API.
**Results are not pre-filled: run them on your machine and paste your numbers.** Record the machine, because p95/p99 depend on it.

```bash
docker compose up --build -d
k6 run k6/mixed.js        # login/create/list mix, thresholds p95<500ms p99<1000ms
k6 run k6/ratelimit.js    # FREE org gets 429s, ENTERPRISE does not
k6 run k6/spike.js        # 10 -> 150 req/s spike
k6 run k6/cache.js                           # cache ON
CACHE_DISABLED=1 docker compose up -d project-service task-service && k6 run k6/cache.js   # cache OFF
```

| Test | Machine | RPS | p95 | p99 | Error rate | Notes |
|---|---|---|---|---|---|---|
| mixed | | | | | | |
| spike | | | | | | |
| cache ON (project, tasks) | | | | | | |
| cache OFF (project, tasks) | | | | | | |

Rate limit check (`ratelimit.js`): FREE 429 count = ___ , ENTERPRISE 429 count = ___ (expected 0).

Watch Grafana (http://localhost:3001, "WorkSphere Overview") while a test runs: latency, consumer lag, outbox backlog, cache hit ratio and 429s.

## Analysis (write after running)
- Bottleneck observed:
- Effect of the cache:
- Consumer lag under load:
