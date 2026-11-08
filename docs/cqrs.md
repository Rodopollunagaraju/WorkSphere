# CQRS and eventual consistency

**Commands** (create/assign/move a task) go to the Task service and its own MongoDB database. **Queries** for the dashboard are served by the
Analytics service from read models that Kafka consumers keep up to date. The two sides share no database.

## What the user sees
- A task is saved and visible on the board immediately (the board reads the Task service).
- The dashboard may lag behind by the time it takes the outbox relay (<= 500 ms poll) + Kafka + the consumer transaction.
- Every analytics response includes `lastUpdatedAt`; the dashboard shows "Updated Ns ago" and a "refreshing" state while it polls every 5 s.

## Why it stays correct
- **Outbox**: the event exists if and only if the task write committed.
- **Version-guarded snapshots**: a stale or duplicate event never overwrites newer state.
- **Idempotent consumers**: the dedupe record and the read-model write commit atomically.
- **Rebuildable**: resetting a consumer group's offsets replays history into a fresh read model.

## Measuring the window
```bash
node scripts/measure-lag.js 30      # needs the stack running
```
It creates tasks one by one and times 201-received -> dashboard-reflects-it. Record your numbers here:

| Date | Machine | Samples | p50 | p95 | max |
|---|---|---|---|---|---|
| _fill in after running_ | | | | | |

> Numbers depend on hardware and on how busy Kafka is; they are intentionally not pre-filled.
