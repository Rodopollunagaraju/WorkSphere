// Read-heavy cache comparison. Run it twice and compare p95:
//   docker compose up -d                       && k6 run k6/cache.js   # cache ON
//   CACHE_DISABLED=1 docker compose up -d      && k6 run k6/cache.js   # cache OFF (recreates project/task services)
import http from 'k6/http';
import { check } from 'k6';
import { BASE, bootstrap, withAuth } from './lib.js';

export const options = {
  scenarios: { reads: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '60s', preAllocatedVUs: 40, maxVUs: 200 } },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{endpoint:project}': ['p(95)<300'], 'http_req_duration{endpoint:tasks}': ['p(95)<400'] },
};
export function setup() {
  const d = bootstrap({ plan: 'ENTERPRISE', rateLimit: 1000000 });
  for (let i = 0; i < 25; i++) http.post(`${BASE}/tasks`, JSON.stringify({ projectId: d.projectId, title: `seed ${i}` }), withAuth(d.token));
  return d;
}
export default function (d) {
  check(http.get(`${BASE}/projects/${d.projectId}`, { ...withAuth(d.token), tags: { endpoint: 'project' } }), { 'project 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/tasks?projectId=${d.projectId}&limit=25`, { ...withAuth(d.token), tags: { endpoint: 'tasks' } }), { 'tasks 200': (r) => r.status === 200 });
}
