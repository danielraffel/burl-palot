# `@palot/opencode`

Host-neutral OpenCode commands, results, events, and stream contracts are
exported from `@palot/opencode`. The Node/Bun SDK transport is deliberately a
separate `@palot/opencode/node` export so renderer bundles do not inherit
process or socket capabilities.

The adapter starts `opencode serve` without credentials on its command line,
or connects to an existing server. Remote authentication uses an opaque
`credentialId`; a privileged host-provided fetch factory resolves and injects
the credential below the application boundary. A missing resolver fails
closed.

```sh
bun test packages/opencode

# Opt-in real local server smoke. This starts and stops OpenCode in a temporary
# project without sending a model prompt or consuming provider resources.
OPENCODE_INTEGRATION=1 bun test packages/opencode/test/live-opencode.test.ts
```

The normal adapter tests verify exact v2 SDK calls for project/session access,
resolved-model prompt submission, explicit-text retry, cancellation, and the
global event stream. The live smoke proves process start, health connection,
and real project selection only; it does not claim a completed chat response.
