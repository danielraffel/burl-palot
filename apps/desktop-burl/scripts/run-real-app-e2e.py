#!/usr/bin/env python3
import argparse, json, pathlib, subprocess, sys, time

parser = argparse.ArgumentParser()
parser.add_argument("--app", required=True)
parser.add_argument("--project", required=True)
parser.add_argument("--marker", required=True)
parser.add_argument("--output-dir", required=True)
parser.add_argument("--timeout", type=int, default=240)
args = parser.parse_args()
out = pathlib.Path(args.output_dir)
out.mkdir(parents=True, exist_ok=True)
capture = out / "final.png"
evidence = out / "accessibility.json"
state = out / "state.bin"
stdout_path, stderr_path = out / "stdout.log", out / "stderr.log"
cancel_retry_prompt = (
    f"Do not use tools. Begin your response with {args.marker}. Then write a numbered list from 1 through 10, "
    "with one short factual sentence per item. Do not stop before item 10."
)
command = [args.app, "--demo-state", str(state), "--demo-project", args.project,
           "--demo-prompt", cancel_retry_prompt, "--demo-cancel-retry-proof",
           "--demo-capture", str(capture), "--demo-evidence", str(evidence),
           "--window-width", "1200", "--window-height", "800"]
with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
    process = subprocess.Popen(command, stdout=stdout, stderr=stderr, cwd=args.project)
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        code = process.poll()
        if code is not None:
            print(json.dumps({"status": "early-exit", "exitCode": code,
                              "progress": (pathlib.Path(str(evidence) + ".progress").read_text()
                                           if pathlib.Path(str(evidence) + ".progress").exists() else "")}), file=sys.stderr)
            raise SystemExit(code if code else 90)
        if capture.exists() and capture.stat().st_size and evidence.exists() and evidence.stat().st_size:
            nodes = json.loads(evidence.read_text())
            text = "\n".join(f"{node.get('label','')} {node.get('value','')}" for node in nodes)
            progress = pathlib.Path(str(evidence) + ".progress").read_text()
            if args.marker not in text or progress != "streamed\ncancelled\nretried\ndone\n":
                print(json.dumps({"status": "invalid-proof", "progress": progress,
                                  "markerObserved": args.marker in text}), file=sys.stderr)
                process.terminate(); process.wait(timeout=10)
                raise SystemExit(91)
            process.terminate(); process.wait(timeout=10)
            print(json.dumps({"status": "pass", "exitCode": process.returncode,
                              "marker": args.marker, "pngBytes": capture.stat().st_size,
                              "accessibilityNodes": len(nodes)}))
            raise SystemExit(0)
        time.sleep(0.1)
    process.terminate()
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired: process.kill(); process.wait()
print(json.dumps({"status": "timeout", "seconds": args.timeout}), file=sys.stderr)
raise SystemExit(124)
