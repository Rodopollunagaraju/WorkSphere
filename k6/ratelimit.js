// FREE org must see 429s; an ENTERPRISE org with a high limit must not. Run: k6 run k6/ratelimit.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, bootstrap, withAuth } from './lib.js';

const free429 = new Counter('free_429'); const ent429 = new Counter('enterprise_429');
export const options = {
  scenarios: {
    free: { executor: 'constant-arrival-rate', rate: 300, timeUnit: '1m', duration: '1m', preAllocatedVUs: 5, exec: 'free' },
    enterprise: { executor: 'constant-arrival-rate', rate: 300, timeUnit: '1m', duration: '1m', preAllocatedVUs: 5, exec: 'enterprise' },
  },
  thresholds: { free_429: ['count>50'], enterprise_429: ['count==0'] },
};
export function setup() { return { free: bootstrap(), ent: bootstrap({ plan: 'ENTERPRISE', rateLimit: 100000 }) }; }
export function free(d) { const r = http.get(`${BASE}/projects`, withAuth(d.free.token)); if (r.status === 429) free429.add(1); check(r, { 'free: 200 or 429': (x) => x.status === 200 || x.status === 429, 'free 429 has Retry-After': (x) => x.status !== 429 || !!x.headers['Retry-After'] }); }
export function enterprise(d) { const r = http.get(`${BASE}/projects`, withAuth(d.ent.token)); if (r.status === 429) ent429.add(1); check(r, { 'enterprise: 200': (x) => x.status === 200 }); }
