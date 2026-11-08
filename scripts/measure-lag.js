#!/usr/bin/env node
// Measures the eventual-consistency window of the analytics read model:
// time from "POST /tasks returned 201" until the dashboard numbers include that task.
const { call, eventually, newUser, newOrg, newProject } = require('./lib');
(async () => {
  const org = await newOrg(await newUser('lag'), 'Lag Org', { plan: 'ENTERPRISE', rateLimit: 1000000 });
  const project = await newProject(org); const N = Number(process.argv[2] || 20); const lags = [];
  for (let i = 1; i <= N; i++) {
    await call('POST', '/tasks', { token: org.token, body: { projectId: project._id, title: `lag ${i}` } });
    const t0 = Date.now(); // 201 received: the write is durable and the event is in the outbox
    await eventually(async () => (await call('GET', `/analytics/projects/${project._id}`, { token: org.token })).data.total === i, { every: 25, timeout: 30000 });
    lags.push(Date.now() - t0);
  }
  lags.sort((a, b) => a - b); const q = (p) => lags[Math.min(lags.length - 1, Math.floor(p * lags.length))];
  console.log(`samples=${N}  p50=${q(0.5)}ms  p95=${q(0.95)}ms  max=${lags[lags.length - 1]}ms  (includes ~1 analytics API round trip per poll)`);
})().catch((e) => { console.error(e); process.exit(1); });
