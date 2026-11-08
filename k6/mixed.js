// Realistic mix: login -> create task -> list tasks. Run: k6 run k6/mixed.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, bootstrap, withAuth } from './lib.js';

export const options = {
  stages: [{ duration: '20s', target: 20 }, { duration: '60s', target: 20 }, { duration: '10s', target: 0 }],
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500', 'p(99)<1000'], 'http_req_duration{kind:write}': ['p(95)<800'] },
};
// ENTERPRISE with a high limit so we measure the services, not the rate limiter.
export function setup() { return bootstrap({ plan: 'ENTERPRISE', rateLimit: 1000000 }); }

export default function (d) {
  const create = http.post(`${BASE}/tasks`, JSON.stringify({ projectId: d.projectId, title: `task ${__VU}-${__ITER}`, priority: 'MEDIUM', assignedTo: d.userId }), { ...withAuth(d.token), tags: { kind: 'write' } });
  check(create, { 'task created': (r) => r.status === 201 });
  const list = http.get(`${BASE}/tasks?projectId=${d.projectId}&limit=25`, { ...withAuth(d.token), tags: { kind: 'read' } });
  check(list, { 'list ok': (r) => r.status === 200 });
  sleep(0.3);
}
