# ADR NNNN — <short title>

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD
- **Supersedes:** none
- **Context:** <area / spec / component>

## Context / forces

What problem or pressure prompts this decision? What constraints apply (compatibility
commitments, the invariants in ADR 0001, performance, etc.)?

## Decision

The change, stated precisely. Name the concrete files/interfaces it touches.

## Compatibility review (required if it touches `ObservationEvent` or `EventSource`)

- Does it preserve `v1.x` field compatibility (add optional fields; never repurpose/remove)?
- Does it keep the reconciliation gate green?
- Does it keep replay deterministic?
- If any answer is "no": this is a **v2** discussion — document the migration path.

## Rationale

Why this option over the alternatives. Tie back to the project invariants where relevant.

## Consequences

- (+) Positive outcomes.
- (−) Costs / limitations / follow-up work (be honest about caveats).

## Validation

How the decision is proven — tests added, gates kept green, runtime evidence. An ADR that
affects analytics or storage MUST cite the reconciliation / identical-analytics tests.
