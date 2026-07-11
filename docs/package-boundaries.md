# Port package boundaries

The port grows through demand-driven extraction rather than a speculative
rewrite.

| Package | Owns | Must not own |
|---|---|---|
| `@palot/domain` | Palot product types, reducers, schemas | renderer or host APIs |
| `@palot/opencode` | transport-neutral OpenCode contracts | Electron IPC or Burl bindings |
| `@palot/react` | reusable product controllers/components | native services |
| `@palot/ui-web` | Electron/browser presentation | Burl framework code |
| `@palot/ui-burl` | Palot presentation composed from Burl primitives | general framework capabilities |

The existing packages and Electron imports remain untouched until a live Burl
slice needs a contract. Extractions must preserve behavior and gain host-neutral
tests before either application changes to consume them.
