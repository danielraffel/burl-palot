# Phase B source component references

These crops are consumer-owned references derived from the deterministic Electron
`01-shell` capture. They are not a replacement for the full-screen parity gate.

Regenerate and verify them from the repository root:

```sh
bun run generate:source-components
bun run test:source-components
```

The generator fails closed when either committed source input changes, a semantic
selector is missing or ambiguous, an expected source ID drifts, or a crop leaves
the pinned 2400x1600 DPR2 image. `generated-v1/evidence.json` records source,
crop, and per-component evidence hashes.
