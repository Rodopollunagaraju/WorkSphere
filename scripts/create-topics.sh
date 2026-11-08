#!/bin/sh
# Creates domain topics (6 partitions) plus retry and DLQ variants.
for t in task.events project.events user.events; do
  for suffix in "" .retry .dlq; do
    rpk topic create "${t}${suffix}" -p 6 -r 1 --brokers redpanda:9092 || true
  done
done
