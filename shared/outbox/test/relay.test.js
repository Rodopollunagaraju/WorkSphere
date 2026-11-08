const { createRelay } = require('../src');

// Minimal in-memory stand-in for the Outbox model (supports the 3 calls the relay makes).
function fakeOutbox(rows) {
  const match = (r, f) => Object.entries(f).every(([k, v]) => {
    if (k === 'nextAttemptAt') return r.nextAttemptAt <= v.$lte;
    if (k === 'lockedAt') return r.lockedAt && r.lockedAt < v.$lt;
    return r[k] === v;
  });
  return {
    updateMany: async (f, u) => { rows.filter((r) => match(r, f)).forEach((r) => Object.assign(r, u.$set)); },
    findOneAndUpdate: (f, u) => {
      const r = rows.filter((x) => match(x, f)).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (r) Object.assign(r, u.$set);
      return { lean: async () => (r ? { ...r } : null) };
    },
    updateOne: async (f, u) => { Object.assign(rows.find((r) => r._id === f._id), u.$set); },
  };
}
const row = (i) => ({ _id: i, eventId: `e${i}`, topic: 'task.events', key: 'k', event: { n: i }, headers: {}, status: 'PENDING', attempts: 0, nextAttemptAt: new Date(0), createdAt: i });

test('publishes pending rows in order and marks them SENT', async () => {
  const rows = [row(2), row(1), row(3)]; const out = [];
  const relay = createRelay({ Outbox: fakeOutbox(rows), producer: { send: async (t, k, v) => out.push(v.n) } });
  expect(await relay.tick()).toBe(3);
  expect(out).toEqual([1, 2, 3]);
  expect(rows.every((r) => r.status === 'SENT')).toBe(true);
});
test('Kafka down: event stays PENDING with backoff, nothing lost, delivered after recovery', async () => {
  const rows = [row(1), row(2)]; let up = false; const out = [];
  const relay = createRelay({ Outbox: fakeOutbox(rows), producer: { send: async (t, k, v) => { if (!up) throw new Error('broker down'); out.push(v.n); } }, logger: { warn() {}, error() {} } });
  expect(await relay.tick()).toBe(0);
  expect(rows[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
  expect(rows[1].attempts).toBe(0); // batch stopped, order preserved
  up = true; rows[0].nextAttemptAt = new Date(0);
  expect(await relay.tick()).toBe(2);
  expect(out).toEqual([1, 2]);
});
test('rows stuck in SENDING (crashed relay) are reclaimed', async () => {
  const rows = [{ ...row(1), status: 'SENDING', lockedAt: new Date(Date.now() - 60000) }]; const out = [];
  const relay = createRelay({ Outbox: fakeOutbox(rows), producer: { send: async (t, k, v) => out.push(v.n) }, lockTimeoutMs: 30000 });
  await relay.tick();
  expect(out).toEqual([1]);
});
test('gives up after maxAttempts (FAILED)', async () => {
  const rows = [row(1)];
  const relay = createRelay({ Outbox: fakeOutbox(rows), producer: { send: async () => { throw new Error('x'); } }, maxAttempts: 1, logger: { warn() {}, error() {} } });
  await relay.tick();
  expect(rows[0].status).toBe('FAILED');
});
