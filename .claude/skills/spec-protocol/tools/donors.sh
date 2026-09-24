#!/usr/bin/env bash
# donors.sh — fetch and pin the open-source repositories a project reuses (its
# donors), so builders adapt proven code instead of writing it from scratch.
#
#   donors.sh <project> --fetch     clone each donor at its pinned commit
#   donors.sh <project> --check     verify the clones and the receipt; fetch nothing
#   donors.sh --selftest            prove it against local bare repositories
#
# THE DONOR LIST — the first of these that holds a non-empty list wins:
#   1. the profile's `donors` (.spec-protocol.json): [{name, url, commit, license, reuse}];
#   2. <project>/docs/upstream-lock.json — its `donors` or `repositories` array
#      (`reusedPaths` is read as `reuse`);
#   3. <workdir>/donors.json — {"donors": [...]}.
# workdir = <project>/CONTROL, or `project-profile.mjs workdir` on a profiled project.
# An entry may also carry licenseFile, licenseSha256 (checked when present) and
# ownerApproved (see LICENSES).
#
# --fetch clones each donor into <workdir>/donors/<name> — outside the product source
# tree, and donors/.gitignore keeps it out of any commit, so nothing is vendored by
# accident — with a shallow fetch of the pinned commit only, proves HEAD equals the
# pin, and records the license file's sha256 in <workdir>/donors/receipt.json.
# A donor with no commit is resolved ONCE to its default branch's current SHA and
# written back to <workdir>/donors.json; every later run reads that pin, so a donor
# never floats. --check proves the same against the receipt without fetching (an
# unpinned donor fails it).
#
# LICENSES: an AGPL donor, or one with no license (declared empty, none, unknown,
# unlicensed or proprietary, or no LICENSE/LICENCE/COPYING file in the checkout), is
# refused unless its entry carries "ownerApproved": true. "Unlicense" (The Unlicense)
# is a license and is allowed.
#
# Prints DONORS-READY: n=<k> (exit 0), or one DONOR-FAILED: name=… reason=… line per
# failed donor (exit 3). Exit 2 undetermined (no project folder, no git/python3, the
# work folder or a donor list unreadable) | 1 usage.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"

undetermined() { printf 'DONORS | UNDETERMINED | %s\n' "$*"; exit 2; }

run() { # run <project> <fetch|check>
  local home="${1%/}" workdir
  [[ -d "$home" ]] || undetermined "no project folder at $home"
  command -v git >/dev/null && command -v python3 >/dev/null || undetermined "git and python3 are both required"
  if [[ -f "$home/.spec-protocol.json" ]]; then
    workdir="$(node "$DIR/project-profile.mjs" workdir "$home")" && [[ -n "$workdir" ]] \
      || undetermined "could not resolve the profiled work folder (node tools/project-profile.mjs workdir failed)"
  else
    workdir="$home/CONTROL"
  fi
  GIT_TERMINAL_PROMPT=0 python3 - "$2" "$home" "$workdir" <<'PY'
import datetime, hashlib, json, os, re, subprocess, sys

mode, home, workdir = sys.argv[1:4]
donors_dir = os.path.join(workdir, "donors")
own_path = os.path.join(workdir, "donors.json")
receipt_path = os.path.join(donors_dir, "receipt.json")
FULL_SHA = re.compile(r"^[0-9a-f]{40}([0-9a-f]{24})?$")
NO_LICENSE = {"", "none", "noassertion", "unknown", "unlicensed", "proprietary"}
LICENSE_FILE = re.compile(r"^(licen[cs]e|copying)([.-].*)?$", re.I)

def load(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        print(f"DONORS | UNDETERMINED | unreadable {path}: {e.__class__.__name__}")
        sys.exit(2)

def listed(doc, *keys):
    if isinstance(doc, list):
        return doc
    for key in keys:
        if isinstance(doc, dict) and isinstance(doc.get(key), list):
            return doc[key]
    return []

def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)

def write_json(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)

own_doc = load(own_path)
own = listed(own_doc, "donors")
sources = [
    ("profile", listed(load(os.path.join(home, ".spec-protocol.json")) or {}, "donors")),
    ("upstream-lock", listed(load(os.path.join(home, "docs", "upstream-lock.json")) or {}, "donors", "repositories")),
    ("donors.json", own),
]
source, donors = next(((s, d) for s, d in sources if d), ("none", []))
receipt = {r.get("name"): r for r in listed(load(receipt_path) or {}, "donors") if isinstance(r, dict)}

failed, ready, resolved, seen = [], [], [], set()
def fail(name, reason):
    failed.append(name)
    print(f"DONOR-FAILED: name={name} reason={reason}")

if mode == "fetch" and donors:
    os.makedirs(donors_dir, exist_ok=True)
    with open(os.path.join(donors_dir, ".gitignore"), "w") as f:
        f.write("# donor clones are reference copies, never product source\n*\n")

for d in donors:
    if not isinstance(d, dict) or not isinstance(d.get("name"), str) or not isinstance(d.get("url"), str):
        fail("-", "entry-needs-name-and-url"); continue
    name, url = d["name"], d["url"]
    slot = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")
    if not slot or slot in seen:
        fail(name, "bad-or-duplicate-name"); continue
    seen.add(slot)
    if re.match(r"^https?://[^/@]+@", url):
        fail(name, "url-has-embedded-credential"); continue
    license_name = str(d.get("license") or "").strip()
    approved = d.get("ownerApproved") is True
    if (license_name.lower() in NO_LICENSE or "agpl" in license_name.lower()) and not approved:
        fail(name, f"license-refused:{license_name or 'none'} (needs ownerApproved:true)"); continue

    commit = str(d.get("commit") or "").strip().lower()
    if not commit:  # the pin this tool wrote back on an earlier run
        commit = next((str(o.get("commit") or "").lower() for o in own if isinstance(o, dict)
                       and o.get("name") == name and o.get("url") == url), "")
    if not commit:
        if mode == "check":
            fail(name, "unpinned (run --fetch once to pin it)"); continue
        r = git("ls-remote", url, "HEAD")
        commit = r.stdout.split()[0] if r.returncode == 0 and r.stdout.split() else ""
        if not FULL_SHA.match(commit):
            fail(name, "could-not-resolve-default-branch-sha"); continue
        resolved.append(dict(d, commit=commit,
                             resolvedAt=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")))
    if not FULL_SHA.match(commit):
        fail(name, "commit-is-not-a-full-sha"); continue

    dest = os.path.join(donors_dir, slot)
    if mode == "fetch":
        if os.path.exists(dest) and not os.path.isdir(os.path.join(dest, ".git")):
            fail(name, f"{dest}-exists-and-is-not-a-donor-clone"); continue
        if not os.path.exists(dest):
            if git("init", "-q", dest).returncode or git("remote", "add", "origin", url, cwd=dest).returncode:
                fail(name, "git-init-failed"); continue
        if git("rev-parse", "HEAD", cwd=dest).stdout.strip() != commit:
            if git("fetch", "-q", "--depth", "1", "origin", commit, cwd=dest).returncode \
               or git("checkout", "-q", "--detach", "FETCH_HEAD", cwd=dest).returncode:
                fail(name, "fetch-of-pinned-commit-failed"); continue
    elif not os.path.isdir(os.path.join(dest, ".git")):
        fail(name, "not-fetched"); continue
    head = git("rev-parse", "HEAD", cwd=dest).stdout.strip()
    if head != commit:
        fail(name, f"head-{head[:12] or 'none'}-is-not-pin-{commit[:12]}"); continue

    lic_file = d.get("licenseFile") or next((f for f in sorted(os.listdir(dest))
                                            if LICENSE_FILE.match(f) and os.path.isfile(os.path.join(dest, f))), None)
    lic_path = os.path.join(dest, lic_file) if lic_file else None
    lic_sha = None
    if lic_path and os.path.isfile(lic_path):
        with open(lic_path, "rb") as f:
            lic_sha = hashlib.sha256(f.read()).hexdigest()
    elif not approved:
        fail(name, "no-license-file-in-checkout (needs ownerApproved:true)"); continue
    if d.get("licenseSha256") and lic_sha != d["licenseSha256"]:
        fail(name, "license-sha256-differs-from-the-declared-one"); continue
    if mode == "check" and (name not in receipt or receipt[name].get("commit") != commit
                            or receipt[name].get("licenseSha256") != lic_sha):
        fail(name, "differs-from-receipt (license file changed, or never fetched with this pin)"); continue
    ready.append({"name": name, "url": url, "commit": commit, "path": dest, "license": license_name or None,
                  "ownerApproved": approved, "licenseFile": lic_file, "licenseSha256": lic_sha,
                  "reuse": d.get("reuse", d.get("reusedPaths", []))})
    print(f"DONOR: name={name} commit={commit[:12]} license={license_name or 'none'} path={dest}")

if resolved:  # write the resolved pins back, so the next run reads them
    by_name = {r["name"]: r for r in resolved}
    merged = [by_name.pop(o.get("name"), o) if isinstance(o, dict) else o for o in own] + list(by_name.values())
    write_json(own_path, merged if isinstance(own_doc, list) else dict(own_doc or {}, donors=merged))
    for r in resolved:
        print(f"DONOR-PINNED: name={r['name']} commit={r['commit']} written to {own_path}")
if mode == "fetch" and donors:
    write_json(receipt_path, {"source": source, "donors": ready})
if failed:
    sys.exit(3)
print(f"DONORS-READY: n={len(ready)}")
PY
}

selftest() {
  local t fails=0 out rc a b
  t="$(mktemp -d "${TMPDIR:-/tmp}/donors-st.XXXXXX")" || exit 2
  trap 'rm -rf "$t"' EXIT
  export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=st GIT_AUTHOR_EMAIL=st@example.invalid \
         GIT_COMMITTER_NAME=st GIT_COMMITTER_EMAIL=st@example.invalid
  ok() { echo "SELFTEST ok   $1"; }
  no() { echo "SELFTEST FAIL $1"; fails=1; }
  mkrepo() { # mkrepo <name> <license text> -> bare repo $t/<name>.git with commits A then B
    git init -q -b main "$t/w-$1" && printf '%s\n' "$2" > "$t/w-$1/LICENSE" && echo a > "$t/w-$1/a.js" \
      && git -C "$t/w-$1" add . && git -C "$t/w-$1" commit -qm A && echo b > "$t/w-$1/b.js" \
      && git -C "$t/w-$1" add . && git -C "$t/w-$1" commit -qm B && git clone -q --bare "$t/w-$1" "$t/$1.git"
  }
  mkrepo mit "MIT License" && mkrepo agpl "GNU AFFERO GENERAL PUBLIC LICENSE" || { echo "SELFTEST FAIL fixture"; exit 1; }
  a="$(git -C "$t/w-mit" rev-parse HEAD~1)"; b="$(git -C "$t/w-mit" rev-parse HEAD)"

  # 1. upstream-lock.json's `repositories` shape, pinned to the OLDER commit: fetched at the pin, not the tip.
  mkdir -p "$t/p1/CONTROL" "$t/p1/docs"
  printf '{"repositories":[{"name":"org/lib","url":"file://%s","commit":"%s","license":"MIT","reusedPaths":["a.js"]}]}\n' \
    "$t/mit.git" "$a" > "$t/p1/docs/upstream-lock.json"
  out="$(bash "$SELF" "$t/p1" --fetch 2>&1)"; rc=$?
  if (( rc == 0 )) && grep -q '^DONORS-READY: n=1$' <<<"$out" \
     && [[ "$(git -C "$t/p1/CONTROL/donors/org-lib" rev-parse HEAD)" == "$a" ]] \
     && grep -q "$(shasum -a 256 "$t/w-mit/LICENSE" | cut -d' ' -f1)" "$t/p1/CONTROL/donors/receipt.json" \
     && [[ "$(git -C "$t/p1/CONTROL/donors/org-lib" rev-list --count HEAD)" == 1 ]]; then
    ok "lock repositories shape: shallow clone at the pin, license sha256 recorded"
  else no "lock fetch rc=$rc: $out"; fi

  # 2. --check passes, then fails once the license file changes.
  bash "$SELF" "$t/p1" --check >/dev/null 2>&1; rc=$?
  echo changed >> "$t/p1/CONTROL/donors/org-lib/LICENSE"
  out="$(bash "$SELF" "$t/p1" --check 2>&1)"; a=$?
  if (( rc == 0 && a == 3 )) && grep -q 'DONOR-FAILED: name=org/lib reason=differs-from-receipt' <<<"$out"; then
    ok "--check passes on a clean clone and names a changed license file"
  else no "--check rc=$rc: $out"; fi

  # 3. unpinned donor: resolved once to the tip, written back, never floats after a new upstream commit.
  mkdir -p "$t/p2/CONTROL"
  printf '{"donors":[{"name":"lib","url":"file://%s","license":"MIT"}]}\n' "$t/mit.git" > "$t/p2/CONTROL/donors.json"
  bash "$SELF" "$t/p2" --fetch >/dev/null 2>&1; rc=$?
  echo c > "$t/w-mit/c.js"; git -C "$t/w-mit" add . && git -C "$t/w-mit" commit -qm C && git -C "$t/w-mit" push -q "$t/mit.git" main
  bash "$SELF" "$t/p2" --fetch >/dev/null 2>&1; rc=$((rc + $?))
  if (( rc == 0 )) && grep -q "\"commit\": \"$b\"" "$t/p2/CONTROL/donors.json" \
     && [[ "$(git -C "$t/p2/CONTROL/donors/lib" rev-parse HEAD)" == "$b" ]]; then
    ok "unpinned donor pinned once in donors.json and held there after upstream moved"
  else no "unpinned pin rc=$rc"; fi

  # 4. AGPL refused, then allowed with ownerApproved; a bogus pin fails with exit 3.
  mkdir -p "$t/p3/CONTROL"
  printf '{"donors":[{"name":"ag","url":"file://%s","commit":"%s","license":"AGPL-3.0"}]}\n' "$t/agpl.git" \
    "$(git -C "$t/w-agpl" rev-parse HEAD)" > "$t/p3/CONTROL/donors.json"
  out="$(bash "$SELF" "$t/p3" --fetch 2>&1)"; rc=$?
  sed -i.bak 's/"license"/"ownerApproved":true,"license"/' "$t/p3/CONTROL/donors.json"
  bash "$SELF" "$t/p3" --fetch >/dev/null 2>&1; a=$?
  if (( rc == 3 && a == 0 )) && grep -q 'reason=license-refused:AGPL-3.0' <<<"$out"; then
    ok "AGPL refused (exit 3) until the owner approves it"
  else no "AGPL rc=$rc approved-rc=$a: $out"; fi
  mkdir -p "$t/p4/CONTROL"
  printf '{"donors":[{"name":"bad","url":"file://%s","commit":"%s","license":"MIT"}]}\n' "$t/mit.git" \
    0000000000000000000000000000000000000000 > "$t/p4/CONTROL/donors.json"
  out="$(bash "$SELF" "$t/p4" --fetch 2>&1)"; rc=$?
  if (( rc == 3 )) && grep -q 'DONOR-FAILED: name=bad reason=fetch-of-pinned-commit-failed' <<<"$out"; then
    ok "a pin the donor does not have fails by name (exit 3)"
  else no "bad pin rc=$rc: $out"; fi

  # 5. a profile's donors win over the lock, and clone into the profile's work folder.
  if command -v node >/dev/null; then
    mkdir -p "$t/p5/docs/state"
    printf '{"schema":"spec-protocol.project-profile/v1","documents":{"spec":"S.md","protocol":"P.md","state":"docs/state/state.json","ledger":"L.md","todo":"T.md","checklist":"C.md","qc":"Q.md"},"policy":{"maxBuilderSubmissions":4,"maxQCVerdicts":4,"builderRoute":"b","qcRoute":"q"},"targets":["web"],"commands":{"validate":["true","x"],"dispatch":["true","x"],"release":["true","x"]},"donors":[{"name":"prof","url":"file://%s","commit":"%s","license":"MIT"}]}\n' \
      "$t/mit.git" "$b" > "$t/p5/.spec-protocol.json"
    echo '{"donors":[{"name":"lockdonor","url":"file:///nonexistent","commit":"x","license":"MIT"}]}' > "$t/p5/docs/upstream-lock.json"
    out="$(bash "$SELF" "$t/p5" --fetch 2>&1)"; rc=$?
    if (( rc == 0 )) && [[ -d "$t/p5/docs/state/spec-protocol/donors/prof/.git" ]] && ! grep -q lockdonor <<<"$out"; then
      ok "profile donors win, cloned under the profiled work folder"
    else no "profile rc=$rc: $out"; fi
  else echo "SELFTEST skip profile case: node not on PATH"; fi
  exit "$fails"
}

case "${1:-}" in
  --selftest) selftest ;;
  ""|-h|--help) sed -n '2,35p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1 ;;
  *) case "${2:-}" in
       --fetch) run "$1" fetch ;;
       --check) run "$1" check ;;
       *) echo "usage: donors.sh <project> --fetch|--check | donors.sh --selftest" >&2; exit 1 ;;
     esac ;;
esac
