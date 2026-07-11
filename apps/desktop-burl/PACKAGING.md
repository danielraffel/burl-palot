# Standalone package contract

The native target embeds a self-contained OpenCode sidecar at:

```text
Palot.app/Contents/Resources/bin/palot-opencode-sidecar
```

Native code resolves `palot::sidecar::kResourceRelativePath` against the
platform bundle Resources URL. The executable-relative constant is a bounded
fallback for launchers that expose only the main executable path. Neither path
depends on the current working directory, environment `PATH`, or a developer
checkout.

CMake compiles the sidecar with the exact Bun version declared by the root
`packageManager` field and rejects lockfile drift. Reproducible release jobs may
precompile it and pass an absolute
`-DPALOT_OPENCODE_SIDECAR_EXECUTABLE=/path/to/palot-opencode-sidecar`, together
with `PALOT_OPENCODE_SIDECAR_SHA256`, `PALOT_OPENCODE_SIDECAR_ARCH`, and an
absolute `PALOT_OPENCODE_SIDECAR_PROVENANCE` JSON path. Missing or mismatched
metadata fails configuration or the pre-copy verification. The
post-build gate copies it, the component manifest, Palot's license, and
third-party notices, exact OpenCode SDK license, checksum, and provenance into
the application Resources directory. The package verifier checks the copied
sidecar checksum again.

Verify the final artifact with:

```sh
./scripts/verify-burl-app-package.sh /path/to/Palot.app
```

The verifier executes a protocol handshake, checks required notices and
manifest files, rejects Electron/Chromium/WebKit/WebView artifacts by name, and
audits native linkage with `otool` on macOS.
