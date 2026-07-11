# Native Palot evidence

`screenshots/native-opencode-chat.jpeg` is a macOS window capture taken after
launching the native `com.palot.burl` bundle and driving it through macOS UI
automation. The interaction selected this repository as the project, submitted
`Reply exactly: NATIVE PALOT OK` through Burl's native composer, and rendered
the real streamed OpenCode response `NATIVE PALOT OK` in the Skia/Dawn window.

The screenshot SHA-256 is
`5e1d1deac0e8bae46c5c06a988357a833415fc7fb4f08cfc6dd33b71a9ffbb0c`.

The package boundary is checked with:

```sh
bash scripts/verify-burl-app-package.sh /absolute/path/to/Palot.app
```

That verifier executes the bundled sidecar handshake, checks required
manifests and notices, inventories the bundle, audits native linkage, and fails
on Electron, Chromium, WebKit, WebView, or `app.asar` artifacts.
