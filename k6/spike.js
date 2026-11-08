// Sudden 10x spike on reads and writes. Run: k6 run k6/spike.js
import http from 'k6/http';
import { check } from 'k6';
import { BASE, bootstrap, withAuth } from './lib.js';

export const options = {
  scenarios: { spike: { executor: 'ramping-arrival-rate', startRate: 10, timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 300,
    stages: [{ target: 10, duration: '20s' }, { target: 150, duration: '10s' }, { target: 150, duration: '30s' }, { target: 10, duration: '20s' }] } },
  thresholds: { http_req_failed: ['rate<0.02'], http_req_duration: ['p(95)<1500', 'p(99)<3000'] },
};
export function setup() { return bootstrap({ plan: 'ENTERPRISE', rateLimit: 1000000 }); }
export default function (d) {
  if (Math.random() < 0.3) check(http.post(`${BASE}/tasks`, JSON.stringify({ projectId: d.projectId, title: 'spike' }), withAuth(d.token)), { 'created': (r) => r.status === 201 });
  else check(http.get(`${BASE}/tasks?projectId=${d.projectId}`, withAuth(d.token)), { 'listed': (r) => r.status === 200 });
}
