# Glossary and ADR format

Worked examples. Copy the shape, never the content.

## A glossary entry

```markdown
## Shipment

A Shipment is one physical dispatch of goods from one warehouse to one destination, created when the
first parcel leaves and closed when the last parcel is delivered.

Not to be confused with **Order** — an Order can contain several Shipments and exists before any of
them; writing "the order shipped" in docs or code is a bug in the sentence.
```

The not-line is the check: an entry without it is not finished, because the term's boundary is exactly
what the next argument will be about.

## An ADR

`docs/adr/0003-outbox-for-order-events.md`:

```markdown
# 0003 — Publish order events through an outbox table

## Context

Order state changes must reach the billing and notification services. Publishing directly from the
request handler loses events when the broker is down, and billing has already reconciled from
duplicate events twice.

## Decision

Every order event is written to an `outbox` table in the same transaction as the state change; a
relay publishes rows and marks them sent. Handlers are idempotent on event id.

## Consequences

- No event is lost to a broker outage; delivery is at-least-once, so handlers deduplicate.
- Relay lag becomes user-visible delay to billing; alert on outbox age above one minute.
- The outbox table grows with order volume; prune rows older than 30 days.
```

One page: context, decision, consequences. No meeting history, no rejected-options catalogue — a
rejected option earns an ADR only when someone will propose it again.
