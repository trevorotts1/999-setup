#!/usr/bin/env python3
"""check-helper-pins.py — CI guard: every helper pin must equal OpenClaw main.

Run in .github/workflows/helper-pin-guard.yml against a checkout of
trevorotts1/openclaw-onboarding, and locally by
installer-registration/test-helper-pins.sh.

Fails (exit 1) when any of these is true:
  * a "skill" helper's pinned version differs from skill-version.txt at the
    checked ref, or its pinned tree hash differs from that ref's tree — the
    pin is OLDER than OpenClaw origin/main (the case this guard exists for);
  * a "files" helper has a file whose pinned sha256 differs from the checked
    ref's bytes;
  * a vendored folder under installer-registration/helpers/ no longer hashes
    to its own pin (the manifest and the folder drifted apart);
  * a KIE vendor skill (kie-models, kie-chat-agents) is declared in the
    manifest or shipped as a vendored folder — rule 14, they are never
    installed.

Exit 0 = every pin current and every vendored tree matching its pin.
Exit 2 = usage or an unreadable input (never reported as "current").

stdlib only. Reads no credential of any kind.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_MANIFEST = HERE / "helper-dependencies.json"
DEFAULT_HELPERS = HERE / "helpers"
DEFAULT_ONBOARDING = "openclaw-onboarding"  # sourcePath prefix in the manifest


def _skip(rel):
    parts = rel.split("/")
    return ("__pycache__" in parts
            or rel.endswith(".pyc")
            or ".bak-" in rel
            or rel.endswith(".log")
            or parts[-1] == ".DS_Store")


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree_hash_local(root):
    lines = []
    for p in sorted(Path(root).rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if _skip(rel):
            continue
        lines.append(f"{sha256_file(p)}  {rel}")
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


class Onboarding:
    """Reads the onboarding repository at one ref.

    A git checkout is read through `git show <ref>:<path>`, so a dirty local
    working tree can never make a stale pin look current. A plain directory
    (an extracted fixture) is read from disk.
    """

    def __init__(self, path, ref):
        self.path = Path(path)
        if not self.path.is_dir():
            raise SystemExit(
                f"helper pins FATAL: onboarding checkout not found: "
                f"{self.path}")
        self.ref = ref
        self.git = self._git_dir()
        if self.git and not self._rev():
            raise SystemExit(
                f"helper pins FATAL: ref {ref!r} does not exist in "
                f"{self.path} — fetch it first "
                f"(git -C {self.path} fetch origin {ref.split('/')[-1]})")

    def _git_dir(self):
        try:
            r = subprocess.run(
                ["git", "-C", str(self.path), "rev-parse", "--git-dir"],
                capture_output=True, text=True)
        except FileNotFoundError:
            return False
        return r.returncode == 0

    def _rev(self):
        r = subprocess.run(
            ["git", "-C", str(self.path), "rev-parse", "--verify",
             "--quiet", f"{self.ref}^{{commit}}"],
            capture_output=True, text=True)
        return r.returncode == 0

    def read(self, rel):
        """Bytes of one repository path at the checked ref."""
        if self.git:
            r = subprocess.run(
                ["git", "-C", str(self.path), "show", f"{self.ref}:{rel}"],
                capture_output=True)
            if r.returncode != 0:
                raise FileNotFoundError(rel)
            return r.stdout
        p = self.path / rel
        if not p.is_file():
            raise FileNotFoundError(rel)
        return p.read_bytes()

    def listdir(self, d):
        """Repo-relative paths of the files under directory d (skips excluded)."""
        if self.git:
            r = subprocess.run(
                ["git", "-C", str(self.path), "ls-tree", "-r", "--name-only",
                 self.ref, "--", d],
                capture_output=True, text=True)
            if r.returncode != 0:
                raise FileNotFoundError(d)
            names = r.stdout.splitlines()
        else:
            base = self.path / d
            if not base.is_dir():
                raise FileNotFoundError(d)
            names = [(d + "/" + p.relative_to(base).as_posix())
                     for p in sorted(base.rglob("*")) if p.is_file()]
        out = []
        for n in names:
            if not n.startswith(d + "/"):
                continue
            rel = n[len(d) + 1:]
            if _skip(rel):
                continue
            out.append(rel)
        return out

    def tree_hash(self, d):
        rels = self.listdir(d)
        lines = [f"{sha256_bytes(self.read(f'{d}/{r}'))}  {r}"
                 for r in sorted(rels)]
        return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def repo_rel(source_path):
    """'openclaw-onboarding/66-kie-image' -> '66-kie-image'."""
    p = source_path.replace("\\", "/").strip("/")
    if p.startswith(DEFAULT_ONBOARDING + "/"):
        return p[len(DEFAULT_ONBOARDING) + 1:]
    return p


# Rule 14 / KIE-U1 amendment U1-b: the KIE vendor skills are instruction text
# only and are NEVER installed. No manifest entry and no vendored folder may
# ever carry these names.
VENDOR_SKILLS_BANNED = ("kie-models", "kie-chat-agents")


def check_vendor_skills(manifest, helpers_dir):
    """Fail if a banned vendor skill is declared or shipped (U1-b)."""
    failures = []
    banned = set(VENDOR_SKILLS_BANNED)
    for h in manifest.get("helpers") or []:
        if not isinstance(h, dict):
            continue
        hits = [f"{k}={h.get(k)!r}" for k in ("id", "name", "skillName",
                                              "installPath")
                if isinstance(h.get(k), str)
                and any(seg in banned for seg in h[k].split("/"))]
        if hits:
            failures.append(
                "VENDOR SKILL BANNED — "
                f"{h.get('name') or h.get('id')} declares "
                f"{', '.join(hits)}; KIE vendor skills are never installed "
                f"(rule 14)")
    root = Path(helpers_dir)
    if root.is_dir():
        for p in sorted(root.iterdir()):
            if p.name in banned:
                failures.append(
                    f"VENDOR SKILL BANNED — vendored folder present: "
                    f"{p} (KIE vendor skills are never installed, rule 14)")
    return failures


def check(manifest_path, helpers_dir, onb):
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    helpers = manifest.get("helpers")
    if not isinstance(helpers, list) or not helpers:
        raise SystemExit(
            f"helper pins FATAL: manifest declares no helpers: {manifest_path}")
    failures = check_vendor_skills(manifest, helpers_dir)
    for h in helpers:
        name = h.get("name")
        if not name:
            failures.append("manifest entry has no name")
            continue
        vendored = Path(helpers_dir) / name
        kind = h.get("kind", "skill")
        pin = h.get("treeSha256")
        if not vendored.is_dir():
            failures.append(f"{name}: vendored folder missing: {vendored}")
            continue
        if not pin:
            failures.append(f"{name}: manifest entry has no treeSha256 "
                            f"(run helper-deps.py repin)")
            continue
        got_vendored = tree_hash_local(vendored)
        if got_vendored != pin:
            failures.append(
                f"{name}: VENDORED DRIFT — manifest pin {pin}, folder "
                f"{got_vendored} (installer-registration/helpers/{name} no "
                f"longer matches helper-dependencies.json; rerun "
                f"helper-deps.py repin and commit)")
            continue  # the folder is the thing being shipped; stop here
        try:
            src = repo_rel(h.get("sourcePath", ""))
        except Exception:
            failures.append(f"{name}: manifest entry has no sourcePath")
            continue
        if kind == "files":
            declared = {f.get("path"): f for f in (h.get("files") or [])}
            if not declared:
                failures.append(f"{name}: files helper declares no files")
                continue
            for rel in sorted(declared):
                if not (vendored / rel).is_file():
                    failures.append(
                        f"{name}: declared file missing from the vendored "
                        f"folder: {rel} (installer-registration/helpers/"
                        f"{name}/{rel})")
            for rel, f in declared.items():
                try:
                    blob = onb.read(f["sourcePath"])
                except FileNotFoundError:
                    failures.append(
                        f"{name}: STALE PIN — {f['sourcePath']} no longer "
                        f"exists at {onb.ref} in openclaw-onboarding")
                    continue
                got = sha256_bytes(blob)
                if got != f.get("sha256"):
                    failures.append(
                        f"{name}: STALE PIN — {f['path']} differs from "
                        f"openclaw@{onb.ref} ({f['sourcePath']}): pin "
                        f"{f.get('sha256')}, origin/main {got} (rerun "
                        f"helper-deps.py repin against a current checkout)")
        else:
            try:
                onb_ver = onb.read(f"{src}/skill-version.txt").decode(
                    "utf-8", "replace").strip()
            except FileNotFoundError:
                failures.append(
                    f"{name}: STALE PIN — {src}/skill-version.txt missing at "
                    f"{onb.ref} in openclaw-onboarding")
                continue
            if onb_ver != h.get("version"):
                failures.append(
                    f"{name}: STALE PIN — pin {h.get('version')}, "
                    f"openclaw-onboarding {src} at {onb.ref} is {onb_ver} "
                    f"(rerun helper-deps.py repin)")
                continue
            onb_tree = onb.tree_hash(src)
            if onb_tree != pin:
                failures.append(
                    f"{name}: STALE PIN — tree hash differs from "
                    f"openclaw-onboarding {src} at {onb.ref}: pin {pin}, "
                    f"origin/main {onb_tree} (rerun helper-deps.py repin)")
    return failures


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="check-helper-pins.py",
        description="Fail when a helper pin is older than OpenClaw origin/main.")
    ap.add_argument("--onboarding", required=True,
                    help="checkout of trevorotts1/openclaw-onboarding (git "
                         "checkout preferred; a plain tree of the same files "
                         "also works)")
    ap.add_argument("--ref", default="origin/main",
                    help="ref to compare against (default: origin/main)")
    ap.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    ap.add_argument("--helpers", default=str(DEFAULT_HELPERS))
    a = ap.parse_args(argv)
    try:
        onb = Onboarding(a.onboarding, a.ref)
        failures = check(a.manifest, a.helpers, onb)
    except SystemExit:
        raise
    except Exception as e:
        print(f"helper pins: internal error: {e}", file=sys.stderr)
        return 2
    for f in failures:
        print(f"helper pins: FAIL {f}")
    if failures:
        print(f"helper pins: {len(failures)} pin(s) stale or drifted; "
              f"checked against openclaw-onboarding@{a.ref}.")
        return 1
    print(f"helper pins: ok — every pin equals openclaw-onboarding@{a.ref} "
          f"and every vendored helper folder matches its pin.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
