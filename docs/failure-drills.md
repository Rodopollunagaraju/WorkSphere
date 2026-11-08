# Failure drills

Each drill proves one reliability claim on the **running stack** (`docker compose up --build -d`, then `npm install` on the host).
Run with `node scripts/drills.js <name>`. The expected behaviour is below; **fill in the result tables yourself**: they are not pre-filled.

| Drill | Command | Claim | Expected | Observed (date / result) |
|---|---|---|---|---|
| Consumer catch-up | `catchup` | A stopped consumer loses nothing | After restart, analytics total == 100, no gaps | |
| Duplicate delivery | `duplicate` | Redelivered events have no extra effect | Exactly 1 notification after 3 re-publishes; `kafka_messages_total{result="duplicate"}` grows | |
| Poison message | `poison` | Bad messages cannot block the partition | Both land in `task.events.dlq` with `last-error` header; other events keep flowing | |
| DLQ replay | `dlq-replay` | Failed events can be recovered | Handler fails while Mongo is down -> retry x3 -> DLQ; after Mongo returns and replay runs, the notification exists once | |
| Relay crash | see below | No event lost if the relay dies | Event still delivered | |
| Partition scaling | `scale` | Consumers scale by partitions | 36 partitions (6 topics x 6) spread over 1 -> 3 -> 2 members | |

## Relay crash (manual)
1. `docker compose stop redpanda` then create a task (API still returns 201, `outbox_pending` > 0 in Grafana).
2. `docker compose start redpanda`: the relay delivers the backlog; the notification and dashboard catch up.
3. For a hard crash mid-publish: `docker compose kill task-service` right after a write, then `docker compose start task-service`; rows stuck in SENDING are reclaimed after 30 s.

## What the automated tests already cover (no stack needed)
`shared/outbox` (ordering, Kafka down, reclaim, give-up), `shared/kafka` (dedupe, retry, DLQ, skip other groups, backoff), `shared/read-models` (stale/replayed events).
The drills above exercise the *real* Kafka/Mongo wiring, which the unit tests replace with fakes.
