# Architecture review: PASS

The packaged Palot primary UI is a native C++ Burl view tree laid out by Yoga, painted by Skia Graphite, and presented through Dawn on Metal. Runtime launch logs prove a presentable Dawn Metal surface and Skia Graphite on the shared Dawn device. Package and linkage inspection reject Chromium, Electron, WebKit, WebView, and `app.asar` artifacts.

OpenCode integration is isolated in a bundled arm64 sidecar with bounded newline-delimited JSON framing, explicit command correlation, cancellation, generation filtering, stderr separation, and verified provenance. The consumer pins Burl commit `2e3a592f6e94153a33b1bed277fcc6d8894d03ae` immutably. Palot product code remains outside the Burl framework repository.

