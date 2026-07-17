# Source-aware native vertical slice evidence

The positive fixture carries the same typed OpenCode event names and stable
session/message/part identity used by Palot. Product event translation remains
inside `burl-palot`; the generic reducer, collection, Markdown, text input and
accessibility plumbing come from the Burl development override.

The headless executable proves one `message.part.updated` plus three ordered
`message.part.delta` events, one bounded frame notification and polite AX
announcement, deterministic final state, stable message and accessibility IDs,
native Markdown relayout, conditional bottom-follow, scrolled-away anchoring,
unchanged composer focus/selection/marked text/caret, and stale-generation drop
after cancellation.

Markdown parsing stays on Burl's native attributed-string path. The slice feeds
those attributed spans to Burl's existing PreText-inspired
`pulp::canvas::TextShaper`, retaining one `PreparedText` per content version.
The test observes the framework's global prepare counter: the coalesced stream
creates exactly one prepared generation, while two width-only relayouts reuse
that same shaping and only rerun cheap line-breaking arithmetic. The resulting
height is the value applied to `CollectionModel::Reload`, so changed text
invalidates the variable-height row without introducing a second measurement
engine. An unchanged frame is also asserted to perform neither prepare nor row
reload.

```sh
cmake -S apps/desktop-burl -B build-source-aware -DCMAKE_BUILD_TYPE=Release \
  -DBURL_SOURCE_DIR=/Users/danielraffel/Code/burl-wt-native-migration-feasibility \
  -DSKIA_DIR=/Users/danielraffel/Code/burl-wt-palot-demo/external/skia-build
cmake --build build-source-aware --target palot-source-aware-slice-test --parallel 8
ctest --test-dir build-source-aware -R palot-source-aware-slice --output-on-failure
```

The generic accessibility API currently provides a deterministic announcement
sink, but its own public contract records that built-in macOS VoiceOver
notification installation remains pending. This package proves bounded semantic
announcements and fails closed on claiming a real VoiceOver notification.

This isolated feasibility executable uses the deterministic OpenCode fixture;
it does not claim a live server connection. The production service remains the
live transport path and is outside this focused consumer slice.
