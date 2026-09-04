# Architecture Decision Records

Use an ADR for decisions that materially affect Sammy's architecture, compatibility, dependencies, or modernization strategy. Investigation notes and observations belong in `docs/archaeology.md`; routine implementation details do not need an ADR.

Name records sequentially as `NNNN-short-title.md`, beginning with `0001`. Keep each record concise and use this structure:

```markdown
# Decision title

## Status

Proposed | Accepted | Superseded

## Context

What behavior, evidence, constraints, and alternatives shape the decision?

## Decision

What approach was chosen, and why?

## Consequences

What benefits, costs, risks, and follow-up work result?
```

Commit ADRs with the change they govern when practical. Supersede an accepted ADR with a new record rather than rewriting its history.
