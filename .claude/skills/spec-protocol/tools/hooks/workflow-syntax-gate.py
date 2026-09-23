#!/usr/bin/env python3
"""PreToolUse gate for the Workflow tool -- blocks scripts that cannot parse.

Why this exists: `node --check file.js` FALSE-PASSES workflow scripts. It parses
them as CommonJS while they are ESM (`export const meta = ...`), so real syntax
errors slip through and the workflow only fails at launch. This gate parses the
script the way the runtime does -- `const meta` de-exported, body wrapped in an
async function so top-level `return`/`await` are legal -- checked as .mjs.

On a genuine parse error: exit 2, which blocks the launch and returns the exact
node error to the model so it fixes the script in one pass.

FAILS OPEN by design. Missing node, timeouts, unreadable input, or any ambiguity
exits 0 and allows the call. A broken gate must never become a broken harness.
"""
import json, os, re, subprocess, sys, tempfile

WRAP_PREFIX = "async function __wf__(){\n"
LINE_OFFSET = 1  # lines the wrapper adds above the original body

# If the wrapper itself is what upset the parser, do not block.
WRAPPER_ARTIFACTS = (
    "may only appear at the top level",
    "Cannot use import statement",
    "await is only valid",
)


def allow():
    sys.exit(0)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        allow()

    if data.get("tool_name") != "Workflow":
        allow()

    ti = data.get("tool_input") or {}
    script = ti.get("script")
    origin = "inline script"

    if not script:
        path = ti.get("scriptPath")
        if not path or not os.path.isfile(path):
            allow()  # name-based launch: nothing local to check
        try:
            with open(path, encoding="utf-8") as fh:
                script = fh.read()
        except Exception:
            allow()
        origin = path

    if not isinstance(script, str) or not script.strip():
        allow()

    body = re.sub(r"^\s*export\s+(const\s+meta\b)", r"\1", script, count=1, flags=re.M)
    wrapped = WRAP_PREFIX + body + "\n}\n"

    tmp = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
            fh.write(wrapped)
            tmp = fh.name
        result = subprocess.run(
            ["node", "--check", tmp], capture_output=True, text=True, timeout=25
        )
    except Exception:
        allow()  # node missing / timeout -> never block
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass

    if result.returncode == 0:
        allow()

    err = result.stderr or ""
    if any(a in err for a in WRAPPER_ARTIFACTS):
        allow()  # our wrapper caused it, not the author

    # Map node's line numbers back onto the original script.
    err = re.sub(r"^(.*\.mjs):(\d+)", lambda m: "%s:%d" % (origin, int(m.group(2)) - LINE_OFFSET), err, flags=re.M)
    err = err.replace(tmp or "", origin)

    sys.stderr.write(
        "BLOCKED: this workflow script will not parse -- it would have failed at launch.\n\n"
        + err.strip()
        + "\n\nThe reported line is where the parser GAVE UP, not necessarily the mistake.\n"
          "'Unexpected token' at column 0 of a line means an earlier '(', '[', '{' or quote\n"
          "was never closed -- search UPWARD from that line for the unclosed opener.\n"
          "Workflow scripts must be plain JavaScript: no type annotations, interfaces, generics.\n"
          "Note: plain `node --check file.js` FALSE-PASSES these scripts (CommonJS vs ESM).\n"
          "Fix the script and retry. Writing it to a file and launching via scriptPath avoids\n"
          "the JSON escaping that breaks inline scripts.\n"
    )
    sys.exit(2)


main()
