#!/usr/bin/env bash
# install-hooks.sh — REGISTER THE ENFORCERS (fix #1)
#
# Usage:
#   install-hooks.sh [--root <config-root>]
#   install-hooks.sh --selftest
#
# Copies this skill's four hooks into <root>/hooks/ and MERGES their
# registrations into <root>/settings.json. <root> defaults to
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}. The registrations:
#   Stop                                 -> conversation-gate.py, gate0-claim-gate.py
#   PreToolUse matcher "Workflow"        -> workflow-syntax-gate.py
#   PreToolUse matcher "Workflow|Agent|Task" -> dispatch-gate.py
#
# MERGE, NEVER REPLACE. Every existing key and hook entry is kept. A hook whose
# filename is already registered is not added twice; if it sits under a
# different matcher, that entry's matcher is updated (or, when the entry also
# runs other hooks, the one hook is moved to its own entry so the others keep
# their matcher). A registered command whose file is gone is repointed at the
# fresh copy. settings.json is backed up to
# settings.json.bak-spec-protocol-<ISO8601Z> before any change; a run that
# changes nothing writes nothing and makes no backup. The file is never printed.
#
# Then runs every copied hook's --selftest (the ones that have one).
#
# EXIT CODES
#   0  installed (or already installed), every hook selftest passed
#   1  installed, but a hook selftest failed
#   2  UNDETERMINED — no python3, a hook source missing, or settings.json
#      unparseable (nothing written)
set -uo pipefail

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
SRC_HOOKS="${SCRIPT_DIR}/hooks"
PY="${INSTALL_HOOKS_PYTHON:-python3}"   # install-hooks.ps1 passes the Windows interpreter
HOOK_FILES="conversation-gate.py gate0-claim-gate.py workflow-syntax-gate.py dispatch-gate.py"

install_root() {
  local root="$1" f bak rc=0
  command -v "${PY}" >/dev/null 2>&1 || { echo "INSTALL-HOOKS UNDETERMINED | ${PY} not found — nothing written" >&2; return 2; }
  for f in ${HOOK_FILES}; do
    [ -f "${SRC_HOOKS}/${f}" ] || { echo "INSTALL-HOOKS UNDETERMINED | skill copy missing: ${SRC_HOOKS}/${f}" >&2; return 2; }
  done
  mkdir -p "${root}/hooks" || return 2
  for f in ${HOOK_FILES}; do
    cp "${SRC_HOOKS}/${f}" "${root}/hooks/${f}" && chmod 755 "${root}/hooks/${f}" || return 2
  done
  bak="${root}/settings.json.bak-spec-protocol-$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "${PY}" - "${root}" "${bak}" "${PY}" <<'PYEOF'
import json, os, shlex, shutil, sys
root, bak, py = sys.argv[1], sys.argv[2], sys.argv[3]
path = os.path.join(root, "settings.json")
hooks_dir = os.path.join(root, "hooks")
WANT = [("Stop", None, "conversation-gate.py"),
        ("Stop", None, "gate0-claim-gate.py"),
        ("PreToolUse", "Workflow", "workflow-syntax-gate.py"),
        ("PreToolUse", "Workflow|Agent|Task", "dispatch-gate.py")]
if os.path.exists(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            raise ValueError
    except Exception:
        print("INSTALL-HOOKS UNDETERMINED | %s is not a JSON object — nothing written" % path, file=sys.stderr)
        sys.exit(2)
else:
    data = {}
before = json.dumps(data, sort_keys=True)
hooks = data.setdefault("hooks", {})
if not isinstance(hooks, dict):
    print("INSTALL-HOOKS UNDETERMINED | hooks in %s is not an object — nothing written" % path, file=sys.stderr)
    sys.exit(2)

def cmd_for(fname):
    return '%s "%s"' % (py, os.path.join(hooks_dir, fname).replace("\\", "/"))

def cmd_path(cmd, fname):
    try:
        toks = shlex.split(cmd)
    except ValueError:
        toks = cmd.split()
    return next((t for t in toks if t.endswith(fname)), None)

for event, matcher, fname in WANT:
    entries = hooks.setdefault(event, [])
    found = None
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for h in entry.get("hooks") or []:
            if isinstance(h, dict) and fname in str(h.get("command", "")):
                found = (entry, h)
                break
        if found:
            break
    if found is None:
        new = {"hooks": [{"type": "command", "command": cmd_for(fname), "timeout": 30}]}
        if matcher is not None:
            new = {"matcher": matcher, **new}
        entries.append(new)
        continue
    entry, h = found
    p = cmd_path(str(h.get("command", "")), fname)
    if not p or not os.path.isfile(os.path.expanduser(p)):
        h["command"] = cmd_for(fname)
    if matcher is not None and entry.get("matcher") != matcher:
        if len(entry.get("hooks") or []) == 1:
            entry["matcher"] = matcher
        else:
            entry["hooks"].remove(h)
            entries.append({"matcher": matcher, "hooks": [h]})

if json.dumps(data, sort_keys=True) == before:
    print("INSTALL-HOOKS | root=%s | settings=unchanged" % root)
    sys.exit(0)
if os.path.exists(path) and not os.path.exists(bak):  # never overwrite an earlier backup
    shutil.copy2(path, bak)
tmp = path + ".tmp.%d" % os.getpid()
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
print("INSTALL-HOOKS | root=%s | settings=merged | backup=%s" % (root, bak if os.path.exists(bak) else "none (no prior file)"))
PYEOF
  rc=$?
  [ "${rc}" = "0" ] || return 2
  rc=0
  for f in ${HOOK_FILES}; do
    grep -q -- '--selftest' "${root}/hooks/${f}" || { echo "INSTALL-HOOKS | hook=${f} | selftest=none"; continue; }
    if "${PY}" "${root}/hooks/${f}" --selftest >/dev/null 2>&1 </dev/null; then
      echo "INSTALL-HOOKS | hook=${f} | selftest=pass"
    else
      echo "INSTALL-HOOKS | hook=${f} | selftest=FAIL"; rc=1
    fi
  done
  return "${rc}"
}

run_selftest() {
  local T out rc c1 c2 ok=1
  T="$(mktemp -d "${TMPDIR:-/tmp}/install-hooks-selftest.XXXXXX")" || exit 2
  # shellcheck disable=SC2064
  trap "rm -rf '${T}'" EXIT
  # The operator-box shape: dispatch-gate AND workflow-syntax-gate under a
  # "Workflow" matcher in ONE entry, plus a foreign Stop hook and a decoy key.
  mkdir -p "${T}/root/hooks"
  cat > "${T}/root/settings.json" <<'JSON'
{"apiKeyHelper": "DECOY-MUST-SURVIVE", "hooks": {
  "PreToolUse": [{"matcher": "Workflow", "hooks": [
     {"type": "command", "command": "python3 /nonexistent/workflow-syntax-gate.py"},
     {"type": "command", "command": "python3 /nonexistent/dispatch-gate.py"}]}],
  "Stop": [{"hooks": [{"type": "command", "command": "echo mine"}]}]}}
JSON
  out="$(bash "${SELF}" --root "${T}/root" 2>&1)"; rc=$?
  c1="$(shasum -a 256 "${T}/root/settings.json" | awk '{print $1}')"
  bash "${SELF}" --root "${T}/root" >/dev/null 2>&1
  c2="$(shasum -a 256 "${T}/root/settings.json" | awk '{print $1}')"
  python3 - "${T}/root/settings.json" <<'PYEOF' || ok=0
import json, sys
d = json.load(open(sys.argv[1]))
h = d["hooks"]
def where(fname):
    return [(e.get("matcher"), c["command"]) for e in h.get("PreToolUse", []) + h.get("Stop", [])
            for c in e["hooks"] if fname in c["command"]]
assert d["apiKeyHelper"] == "DECOY-MUST-SURVIVE"
assert any(c["command"] == "echo mine" for e in h["Stop"] for c in e["hooks"])
for f in ("conversation-gate.py", "gate0-claim-gate.py"):
    assert len(where(f)) == 1 and where(f)[0][0] is None, f
assert len(where("workflow-syntax-gate.py")) == 1 and where("workflow-syntax-gate.py")[0][0] == "Workflow"
assert len(where("dispatch-gate.py")) == 1 and where("dispatch-gate.py")[0][0] == "Workflow|Agent|Task"
assert "/nonexistent/" not in json.dumps(d)
PYEOF
  [ "${c1}" = "${c2}" ] || ok=0
  ls "${T}/root" | grep -q '^settings.json.bak-spec-protocol-' || ok=0
  [ "$(ls "${T}/root" | grep -c '^settings.json.bak-spec-protocol-')" = "1" ] || ok=0
  case "${out}" in *DECOY*) ok=0 ;; esac
  if [ "${ok}" = "1" ]; then
    echo "install-hooks.sh selftest: PASS (merge kept foreign keys/hooks, moved dispatch-gate to Workflow|Agent|Task, one backup, re-run byte-identical; first-run rc=${rc})"
    exit 0
  fi
  echo "install-hooks.sh selftest: FAIL"
  printf '%s\n' "${out}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --root) install_root "${2:?--root needs a path}"; exit $? ;;
  -h|--help) sed -n '2,30p' "${SELF}"; exit 0 ;;
  "") install_root "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; exit $? ;;
  *) echo "install-hooks.sh: unknown argument $1" >&2; exit 2 ;;
esac
