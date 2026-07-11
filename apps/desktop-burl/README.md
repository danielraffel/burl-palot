# Palot for Burl

This directory is the browserless desktop consumer. The existing
`apps/desktop` Electron application remains the behavior and measurement
reference while the native application is brought up alongside it.

The framework revision is recorded in [`burl.lock.json`](./burl.lock.json). It
is an immutable Git commit, not a branch or a developer-local path. A local
framework checkout may be selected explicitly at configure time with
`-DBURL_SOURCE_DIR=/absolute/path`; that override is never committed.

```sh
cmake -S apps/desktop-burl -B build/desktop-burl -DCMAKE_BUILD_TYPE=Release
cmake --build build/desktop-burl --parallel 4
```

During repository bootstrap, configure with
`-DBURL_PALOT_ENABLE_FRAMEWORK=OFF` to validate only the consumer boundary.
Once the pinned Burl revision exports its application SDK, the default
framework-enabled configure resolves that exact revision and builds the native
application target.

Palot product behavior belongs in this repository. General rendering,
application-host, input, accessibility, and service capabilities belong in
Burl and are consumed here only after the lock advances.
