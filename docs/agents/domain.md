# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/GLOSSARY.md`**: the repo glossary. Use its vocabulary when naming domain concepts; do not drift to synonyms it explicitly avoids.
- **`docs/DECISIONS.md`**: architecture decision records, as numbered `## ADR-###` sections. There is no `docs/adr/` directory in this repo.
- **`docs/contracts/adapter-spi.md`**, **`docs/contracts/ir-and-rendering.md`**, **`docs/contracts/transforms-compiler.md`**: adapter, IR and rewrite contracts.
- **`docs/api-contract.md`**: HTTP API contract.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos). This repo keeps the same conceptual layout with two path deviations:

```
/
├── docs/
│   ├── GLOSSARY.md          ← glossary (instead of /GLOSSARY.md)
│   ├── DECISIONS.md         ← ADRs (instead of docs/adr/)
│   └── contracts/
├── api/
└── web/
```

Multi-context repos use `GLOSSARY-MAP.md` at the root; this repo is single-context.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-006 (layer dependencies), but worth reopening because…_
