# Visual scenario runner

`evidence/visual-parity/scenarios.v1.json` is the source/native evidence
contract for the eleven parity passes. It pins the clean source revision,
fixture route, clock, viewport, capture boundary, regions, actions, and semantic
postconditions. Captures are compared only at their declared pixel dimensions;
the runner never crops, pads, stretches, or uses fit-cover normalization.

Emit the deterministic source setup plan:

```sh
python3 scripts/run-visual-scenario.py \
  --manifest evidence/visual-parity/scenarios.v1.json \
  --scenario 01-shell --emit-source-plan
```

The source driver applies the returned CDP new-document clock/animation setup,
sets the declared localStorage state on the Palot Dev origin, navigates to the
declared hash route, waits for fonts and two animation frames, and captures the
declared boundary. It must not modify the clean source checkout.

Comparison requires two images plus provenance and semantic snapshots:

```sh
python3 scripts/run-visual-scenario.py \
  --manifest evidence/visual-parity/scenarios.v1.json \
  --scenario 01-shell \
  --reference source.png --candidate native.png \
  --reference-meta source-meta.json --candidate-meta native-meta.json \
  --reference-semantics source-semantics.json \
  --candidate-semantics native-semantics.json \
  --output result.json
```

Each metadata document contains `lane`, full Git `revision`, `osBuild`,
`captureMethod`, `clock`, `route`, boundary, logical/pixel dimensions, and DPR.
The source revision must equal the manifest pin. Semantic documents use nested
JSON fields matching the scenario postcondition paths. A missing field, failed
postcondition, wrong boundary, stale clock/route, incomplete provenance, or
one-pixel dimension mismatch fails before metrics are emitted.

The result records input and manifest hashes, whole-frame metrics, and metrics
for every declared logical region. Results are canonical, sorted JSON and are
byte-identical for identical inputs.
