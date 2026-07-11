# Native Palot evidence

`screenshots/native-opencode-chat.jpeg` is a macOS window capture taken after
launching the native `com.palot.burl` bundle and driving it through macOS UI
automation. The interaction selected this repository as the project, submitted
`Reply exactly: NATIVE PALOT OK` through Burl's native composer, and rendered
the real streamed OpenCode response `NATIVE PALOT OK` in the Skia/Dawn window.

The screenshot SHA-256 is
`5e1d1deac0e8bae46c5c06a988357a833415fc7fb4f08cfc6dd33b71a9ffbb0c`.

`screenshots/final-native-opencode-chat.png` is the final GPU back-buffer
capture from the immutable-Burl Release bundle using the packaged sidecar,
semantic virtual transcript, and native Markdown renderer. Its SHA-256 is
`000d8d31df37cb7b88471d516acd9dcc81f3e9467eec0511865c862c39687ae3`.

The package boundary is checked with:

```sh
bash scripts/verify-burl-app-package.sh /absolute/path/to/Palot.app
```

That verifier executes the bundled sidecar handshake, checks required
manifests and notices, inventories the bundle, audits native linkage, and fails
on Electron, Chromium, WebKit, WebView, or `app.asar` artifacts.
