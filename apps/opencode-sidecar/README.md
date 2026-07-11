# Palot OpenCode sidecar

`palot-opencode-sidecar` is a self-contained newline-framed JSON bridge for a
native Burl application. The native process spawns it with piped stdin/stdout;
stdout is protocol-only and diagnostics belong on stderr.

Build and package:

```sh
bun run --cwd apps/opencode-sidecar build
bun run --cwd apps/opencode-sidecar package
bun run --cwd apps/opencode-sidecar package:app-resources -- "/path/to/Palot.app"
```

The compiled Bun executable includes its JavaScript runtime and npm modules,
so the `.app` does not require a separately installed Bun or Node runtime.

Each input and output frame is one JSON object followed by `\n`. Protocol
version `1` supports `command`, `subscribe`, `unsubscribe`, `abort`, and
`shutdown` inputs. Output frames are `ready`, `response`, `subscribed`,
`event`, `unsubscribed`, `aborted`, `shutdown`, or `error`. IDs correlate
out-of-order responses and subscriptions.

Connection frames may carry only an opaque `credentialId`; raw tokens or
passwords are not part of this protocol. The initial standalone sidecar does
not install a credential resolver and therefore fails closed for credential-
backed remote connections. Local OpenCode requires no credential material.

On EOF, shutdown, SIGINT, or SIGTERM, active command controllers and event
streams are cancelled and an owned OpenCode process is terminated.
