# Kafka partition scaling demo

`node scripts/drills.js scale` runs `notification-service` as 1, then 3 instances, then kills one and prints
`rpk group describe notification-group` each time. The group subscribes to 3 topics + their 3 `.retry` topics, 6 partitions each (36 total).

Expected: 1 member owns all 36 -> 3 members own ~12 each -> after the kill, the 2 survivors own ~18 each, and no messages are lost
(the dedupe table makes any redelivered message harmless).

| Step | Members | Partitions per member | Total lag | Notes |
|---|---|---|---|---|
| 1 instance | | | | _paste `rpk group describe` output_ |
| 3 instances | | | | |
| 1 killed | | | | |

To see lag drop under load, run `k6 run k6/spike.js` in another terminal and watch "Kafka consumer lag" in Grafana before and after scaling.
