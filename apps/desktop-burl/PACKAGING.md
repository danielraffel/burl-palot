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

CMake compiles the sidecar with Bun by default. Reproducible release jobs may
precompile it and pass an absolute
`-DPALOT_OPENCODE_SIDECAR_EXECUTABLE=/path/to/palot-opencode-sidecar`. The
post-build gate copies it, the component manifest, Palot's license, and
third-party notices into the application Resources directory.

Verify the final artifact with:

```sh
./scripts/verify-burl-app-package.sh /path/to/Palot.app
```

The verifier executes a protocol handshake, checks required notices and
manifest files, rejects Electron/Chromium/WebKit/WebView artifacts by name, and
audits native linkage with `otool` on macOS.
