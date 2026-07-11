# Native demo evidence

This directory intentionally contains no pre-declared passing results. Generate
a run only after the `.app`, real OpenCode transcript, screenshot, trace,
benchmark, accessibility dump, persistence test report, and independent reviews
exist. The collector launches the actual executable, audits its bundle and
linked libraries for browser runtimes, validates every required input, copies
the artifacts, and records their SHA-256 digests using Burl evidence schema v1.

```sh
python3 scripts/native_demo_evidence.py \
  --app /path/to/Palot.app --output evidence/native-demo/run-id \
  --run-id run-id --repository https://github.com/example/burl-palot \
  --commit 0000000000000000000000000000000000000000 \
  --dependency-lock 0000000000000000000000000000000000000000 \
  --build /path/to/build.json --screenshot /path/to/chat.png \
  --trace /path/to/trace.json --benchmark /path/to/benchmark.json \
  --accessibility /path/to/accessibility.json --chat /path/to/real-chat.json \
  --persistence /path/to/persistence.json \
  --architecture-review /path/to/architecture.md \
  --adversarial-review /path/to/adversarial.md
```

An accessibility dump must include the workspace, project picker, composer, and
at least one transcript node with a non-empty role and label. Persistence proof
must explicitly pass multiline, tab, and truncated-file recovery cases. The
collector exits nonzero rather than emitting a partial manifest.
