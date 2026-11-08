#!/usr/bin/env node
/* Failure drills for the running stack.  Usage:  node scripts/drills.js <drill>
 *   catchup      stop analytics, create 100 tasks, restart, measure catch-up
 *   duplicate    re-publish an already-processed event: no duplicate notification
 *   poison       publish malformed messages: they land in the DLQ
 *   dlq-replay   fail a handler (Mongo down) -> retries -> DLQ -> recover -> replay
 *   scale        run notification-service x3, show partition assignment, kill one, show rebalance
 *   lag          print consumer-group lag
 * Needs: docker compose stack running (docker compose up --build -d), Node 20, `npm install` done.
 * These drive real containers; read the output and compare with docs/failure-drills.md. */
const { execSync } = require('node:child_process');
const { call, eventually, sleep, newUser, newOrg, addMember, newProject } = require('./lib');

const sh = (cmd, opts = {}) => { console.log(`$ ${cmd}`); return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }); };
const rpk = (args, opts) => sh(`docker compose exec -T redpanda rpk ${args}`, opts);
const mongosh = (db, js) => sh(`docker compose exec -T mongo mongosh ${db} --quiet --eval '${js}'`).trim();
const step = (m) => console.log(`\n== ${m}`);

async function world() {
  const org = await newOrg(await newUser('drill-owner'), 'Drill Org', { plan: 'ENTERPRISE', rateLimit: 1000000 });
  const member = await addMember(org, 'MEMBER', 'drill-dev');
  const project = await newProject(org, 'Drill project', [member.userId]);
  return { org, member, project };
}
const countNotes = async (member) => (await call('GET', '/notifications?limit=100', { token: member.token })).data.items.length;

const drills = {
  async catchup() {
    const { org, project, member } = await world(); const N = 100;
    step('stop the analytics consumers'); sh('docker compose stop analytics-service');
    step(`create ${N} tasks while analytics is down (the API keeps working)`);
    for (let i = 0; i < N; i += 10) await Promise.all(Array.from({ length: 10 }, (_, k) => call('POST', '/tasks', { token: org.token, body: { projectId: project._id, title: `offline ${i + k}`, assignedTo: member.userId } })));
    step('restart analytics and time the catch-up'); const t0 = Date.now(); sh('docker compose start analytics-service');
    const stats = await eventually(async () => { const r = await call('GET', `/analytics/projects/${project._id}`, { token: org.token }); return r.status === 200 && r.data.total === N ? r.data : null; }, { timeout: 180000, every: 1000 });
    console.log(`caught up: total=${stats.total} pending=${stats.pending} in ${((Date.now() - t0) / 1000).toFixed(1)}s (includes container restart)`);
  },

  async duplicate() {
    const { org, project, member } = await world();
    await call('POST', '/tasks', { token: org.token, body: { projectId: project._id, title: 'dup drill', assignedTo: member.userId } });
    await eventually(async () => (await countNotes(member)) === 1);
    step('read the TASK_ASSIGNED event from the outbox and publish the SAME event again');
    const ev = mongosh('worksphere_tasks', 'print(JSON.stringify(db.outboxes.find({"event.eventType":"TASK_ASSIGNED"}).sort({createdAt:-1}).limit(1).toArray()[0].event))');
    const key = JSON.parse(ev).payload.taskId;
    for (let i = 0; i < 3; i++) rpk(`topic produce task.events -k ${key}`, { input: `${ev}\n` });
    await sleep(6000);
    const n = await countNotes(member);
    console.log(`notifications for the assignee after 3 duplicate deliveries: ${n} (expected 1)`);
    console.log(sh(`docker compose exec -T notification-service node -e "fetch('http://localhost:4004/metrics').then(r=>r.text()).then(t=>console.log(t.split('\\n').filter(l=>l.startsWith('kafka_messages_total')&&l.includes('duplicate')).join('\\n')))"`));
    if (n !== 1) { console.error('FAIL: duplicate created a second notification'); process.exit(1); }
    console.log('PASS: duplicates were deduplicated');
  },

  async poison() {
    step('publish a non-JSON message and a JSON message that is not a valid event');
    rpk('topic produce task.events -k poison', { input: 'this is not json\n' });
    rpk('topic produce task.events -k poison', { input: '{"eventType":"TASK_ASSIGNED"}\n' });
    await sleep(6000);
    step('read the dead-letter topic (headers show the reason)');
    console.log(rpk('topic consume task.events.dlq -o start -n 2 -f "%h\\n%v\\n---\\n"', { timeout: 30000 }));
  },

  async 'dlq-replay'() {
    const { createEvent } = require('@worksphere/event-contracts');
    const title = `DLQ drill ${Date.now()}`;
    const ev = createEvent({ eventType: 'TASK_ASSIGNED', organizationId: 'drillorg', actorId: 'someone', payload: { taskId: 'drilltask', projectId: 'drillproj', assignedTo: 'drilluser', snapshot: { title, status: 'TODO', assignedTo: 'drilluser', version: 1, createdBy: 'someone' } } });
    step('take MongoDB down so every consumer handler fails'); sh('docker compose stop mongo');
    rpk('topic produce task.events -k drilltask', { input: `${JSON.stringify(ev)}\n` });
    console.log('waiting for retries (1s, 2s, 4s backoff) to exhaust and move the message to the DLQ...'); await sleep(25000);
    step('bring MongoDB back and wait for it'); sh('docker compose start mongo'); await sleep(20000);
    console.log('before replay, notifications matching the drill:', mongosh('worksphere_notifications', `print(db.notifications.countDocuments({message:"You were assigned: ${title}"}))`));
    step('replay the DLQ (re-published to the .retry topic for the group that failed)');
    sh('docker compose exec -T notification-service node node_modules/@worksphere/kafka/src/replay-dlq.js task.events.dlq redpanda:9092');
    await sleep(8000);
    console.log('after replay:', mongosh('worksphere_notifications', `print(db.notifications.countDocuments({message:"You were assigned: ${title}"}))`), '(expected 1)');
    console.log('NOTE: run on a fresh stack; older DLQ messages (e.g. from the poison drill) are replayed too and will simply dead-letter again.');
  },

  async scale() {
    step('baseline: one notification-service instance'); console.log(rpk('group describe notification-group'));
    step('scale to 3 instances'); sh('docker compose up -d --scale notification-service=3 --no-recreate notification-service'); await sleep(20000);
    console.log(rpk('group describe notification-group'));
    step('kill one instance, watch partitions rebalance onto the survivors');
    const id = sh('docker compose ps -q notification-service').trim().split('\n')[0]; sh(`docker kill ${id}`); await sleep(20000);
    console.log(rpk('group describe notification-group'));
  },

  async lag() { for (const g of ['notification-group', 'analytics-group', 'activity-group', 'task-cache-group']) console.log(rpk(`group describe ${g}`)); },
};

const name = process.argv[2];
if (!drills[name]) { console.error(`usage: node scripts/drills.js <${Object.keys(drills).join('|')}>`); process.exit(1); }
drills[name]().catch((e) => { console.error(e.stdout || e.stderr || e); process.exit(1); });
