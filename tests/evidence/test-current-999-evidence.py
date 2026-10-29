#!/usr/bin/env python3
"""Contract guard for evidence/current-999-evidence.json (T-02).

Every defect in the PBB-264 verdict is one of four classes. Each class gets a
guard that fires on ANY instance of it, not just the instance the verdict named.

  G1  a citation whose substantiating text is not inside the range it cites.
      The range is read OUT OF THE ARTIFACT, never from this file, so narrowing
      a citation fails here. Every line citation in the artifact must be
      registered with a needle, so a new instance cannot dodge the guard.
  G2  two figures in one measured object computed with two different
      instruments, so the pair cannot both hold.
  G3  a file-PRESENCE test standing in for a USABILITY claim. The update gate
      opens exactly <skill>/VERSION and the content must pass is_version(), so
      a present-but-invalid file and a case-spelled file are both unusable.
  G4  hash evidence a reader cannot recompute from a reachable object.

Usage:
    python3 -I tests/evidence/test-current-999-evidence.py [--commit <sha>] [--repo <path>]
    python3 -I tests/evidence/test-current-999-evidence.py --selftest

--commit reads the artifact out of that commit's tree; omit it to read the
worktree file. --selftest proves every guard still discriminates: a seeded
defect must fire the guard that owns it and a clean artifact must pass all.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ART = "evidence/current-999-evidence.json"
REGISTRY = "CONTROL/bundled-skills.txt"
SKILLS_ROOT = ".claude/skills"

MAC = ".claude/skills/nine-router-setup/scripts/setup-macos.sh"
WIN = ".claude/skills/nine-router-setup/scripts/setup-windows.ps1"
CHK = ".claude/skills/spec-protocol/tools/check-update.sh"
SLF = ".claude/skills/spec-protocol/tools/self-update.sh"
WIRE = ".claude/skills/convert-and-flow-operator/wire.sh"
SYNC = "scripts/sync-nine-skills.sh"
LAUN = "launchers/macos/claude-nine"
INST = "AGENT_INSTALL.md"
READ = "README.md"

# (json pointer, file, range as the artifact writes its NUMBER, needle inside it)
CITATIONS = [
    ("interfaces[0].symbols[0]", MAC, "323", "bundled_skills"),
    ("interfaces[0].symbols[1]", MAC, "363", "link_one_skill"),
    ("interfaces[0].symbols[2]", MAC, "408", "link_skills_into_root"),
    ("interfaces[0].symbols[3]", WIN, "226", "Get-BundledSkills"),
    ("interfaces[0].symbols[4]", WIN, "316", "Link-BundledSkills"),

    ("interfaces[3].symbols[0]", MAC, "1128", "main"),
    ("interfaces[3].symbols[1]", MAC, "1173-1175", "Darwin"),
    ("interfaces[3].symbols[1]", MAC, "1173-1175", "arm64"),
    ("interfaces[3].symbols[2]", MAC, "143-160", "probe_"),
    ("interfaces[3].symbols[3]", MAC, "491", "write_nine_settings"),
    ("interfaces[3].symbols[4]", MAC, "550", "set_operator_key"),
    ("interfaces[3].symbols[5]", MAC, "989", "skills_only_mode"),
    ("interfaces[3].measured.host_gate", MAC, "1173-1175", "arm64"),
    ("interfaces[3].measured.host_gate", MAC, "1174", "Darwin"),
    ("interfaces[3].measured.host_gate", MAC, "1175", "arm64"),
    ("interfaces[3].measured.dry_run", MAC, "1161", "--check only applies with --skills-only"),

    ("interfaces[4].symbols[0]", WIN, "23", "param"),
    ("interfaces[4].symbols[1]", WIN, "385-389", "Windows_NT"),
    ("interfaces[4].symbols[2]", WIN, "226", "Get-BundledSkills"),
    ("interfaces[4].symbols[3]", WIN, "316", "Link-BundledSkills"),
    ("interfaces[4].symbols[4]", WIN, "375", "DPAPI"),

    ("interfaces[2].measured.wire_sh_contract", WIRE, "39", "exits 0"),
    ("interfaces[2].measured.wire_sh_contract", WIRE, "187-188", "ALWAYS succeed"),

    ("interfaces[5].measured.documented_install", INST, "169-170", "helper-deps.py install"),
    ("interfaces[5].measured.documented_install", READ, "213-214", "helper-deps.py install"),
    ("interfaces[5].measured.doc_pin_drift", INST, "164", "v1.1.6"),
    ("interfaces[5].measured.doc_pin_drift", INST, "187", "v1.1.6"),

    ("interfaces[6].symbols[0]", CHK, "48", "SKILLS=("),
    ("interfaces[6].symbols[1]", CHK, "129", "check_one_skill"),
    ("interfaces[6].measured.local_version_gate_exact", CHK, "129", "check_one_skill"),
    ("interfaces[6].measured.local_version_gate_exact", CHK, "131", 'local_file="$LOCAL_SKILLS_ROOT/$skill/VERSION"'),
    ("interfaces[6].measured.local_version_gate_exact", CHK, "137-140", "no VERSION"),
    ("interfaces[6].measured.local_version_gate_exact", CHK, "77-88", "is_version"),
    ("interfaces[6].measured.local_version_gate_exact", CHK, "77-88", "*[!0-9.]*"),

    ("interfaces[7].symbols[0]", SLF, "83", "REPO_SKILL_SUBPATH"),
    ("interfaces[7].symbols[1]", SLF, "206-208", "spec-protocol"),

    ("interfaces[8].symbols[0]", MAC, "692", "so_link_escapes"),
    ("interfaces[8].symbols[1]", MAC, "710", "so_tree_diff"),
    ("interfaces[8].symbols[2]", MAC, "771", "so_sync"),
    ("interfaces[8].symbols[3]", MAC, "838", "so_refresh_updater"),
    ("interfaces[8].symbols[4]", MAC, "989", "skills_only_mode"),
    ("interfaces[8].symbols[5]", MAC, "1146-1150", "--skills-only"),

    ("interfaces[9].measured.launcher_invocation", LAUN, "205-206", "sync-nine-skills.sh"),
    ("interfaces[9].measured.self_install_flag", SYNC, "67", "--install"),
    ("interfaces[9].measured.self_install_flag", SYNC, "71", "sync-nine-skills.sh"),
    ("interfaces[9].measured.self_install_flag", SYNC, "84", "mode 755"),
    ("interfaces[9].measured.doc_claim", INST, "234", "installer places"),
    ("missing_capabilities[9].evidence", INST, "234", "installer places"),
]

# Citations of documents OUTSIDE this repository. Their root is named in the
# artifact (spec_citations_root.document_root), so they are checkable only on a
# machine that carries that project. When it is absent the guard says so and
# claims nothing, instead of passing on an instrument that never ran.
OUT_OF_TREE = [
    ("spec_citations[0]", "TODO.md", "25-39", "T-02"),
    ("spec_citations[1]", "ACCEPTANCE-MATRIX.md", "59", "R-26"),
    ("spec_citations[2]", "ACCEPTANCE-MATRIX.md", "67", "R-30"),
    ("spec_citations[3]", "CHECKLIST.md", "130-136", "R-26"),
    ("spec_citations[3]", "CHECKLIST.md", "150-156", "R-30"),
    ("spec_citations[5]", "DISCOVERIES.md", "217-231", "D-16"),
    ("spec_citations[6]", "DISCOVERIES.md", "399-413", "D-29"),
    ("spec_citations[7]", "SPEC.md", "8-11", "Guided bootstrap"),
    ("spec_citations[8]", "SPEC.md", "50-53", "supervisors"),
]
OUT_OF_TREE_POINTERS = {c[0] for c in OUT_OF_TREE} | {"spec_citations_root.why_this_is_stated"}

# strings that may hold line citations; every one must be registered above
CITED_POINTERS = {c[0] for c in CITATIONS} | OUT_OF_TREE_POINTERS
CITE_TOKEN = re.compile(r"\bL(\d+)(?:-(\d+))?\b|\blines? (\d+)(?:-(\d+))?\b")
HEX40 = re.compile(r"\b[0-9a-f]{40}\b")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def is_version(v):
    """check-update.sh is_version() L77-87, same behaviour."""
    if not v:
        return False
    if re.search(r"[^0-9.]", v):
        return False
    if v.startswith(".") or v.endswith("."):
        return False
    if ".." in v:
        return False
    return len(v) <= 32


def split_key(part):
    m = re.match(r"^([^\[]*)(?:\[(\d+)\])?$", part)
    return m.group(1), (int(m.group(2)) if m.group(2) is not None else None)


def resolve(root, pointer):
    """'interfaces[3].measured.host_gate' -> the value at that path."""
    node = root
    for part in pointer.split("."):
        key, idx = split_key(part)
        if key:
            node = node[key]
        if idx is not None:
            node = node[idx]
    return node


def walk_strings(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def read_blob(repo, commit, path):
    if commit:
        p = git(repo, "cat-file", "-p", f"{commit}:{path}")
        return p.stdout.splitlines() if p.returncode == 0 else None
    f = Path(repo, path)
    return f.read_text().splitlines() if f.is_file() else None


def blob_text(repo, commit, path):
    if commit:
        p = git(repo, "cat-file", "-p", f"{commit}:{path}")
        return p.stdout if p.returncode == 0 else None
    # exact-name resolution: APFS is case-INsensitive, the update gate is not
    parent, name = Path(repo, path).parent, Path(path).name
    if not parent.is_dir():
        return None
    hits = [p for p in parent.iterdir() if p.name == name]
    return hits[0].read_text() if hits and hits[0].is_file() else None


def registered_skills(repo, commit):
    text = blob_text(repo, commit, REGISTRY) or ""
    return sorted(l.strip() for l in text.splitlines()
                  if l.strip() and not l.strip().startswith("#"))


def top_level(repo, commit, skill):
    if commit:
        names = git(repo, "ls-tree", "--name-only", commit, "--", f"{SKILLS_ROOT}/{skill}/").stdout
    else:
        d = Path(repo, SKILLS_ROOT, skill)
        names = "\n".join(str(p) for p in d.iterdir()) if d.is_dir() else ""
    return {Path(n).name for n in names.splitlines() if n}


def cited(text, span):
    """True when the artifact names this span in a citation spelling."""
    pat = r"(?<![0-9])" + re.escape(span).replace(r"\-", "-") + r"(?![0-9])"
    return re.search(r"\bL?" + pat, text) is not None


def span_lines(span):
    a, _, b = span.partition("-")
    return int(a), int(b or a)


def guard_G1(repo, commit, ej, out):
    registered = set()
    for pointer, path, span, needle in CITATIONS:
        registered.add((pointer, span))
        try:
            text = resolve(ej, pointer)
        except (KeyError, IndexError, TypeError):
            out.append(f"G1 FAIL {pointer}: citation registered but the artifact no longer carries it")
            continue
        if not isinstance(text, str) or not cited(text, span):
            out.append(f"G1 FAIL {pointer}: artifact no longer cites {span} — the citation was "
                       f"narrowed without moving the claim")
            continue
        lo, hi = span_lines(span)
        lines = read_blob(repo, commit, path)
        if lines is None:
            out.append(f"G1 FAIL {pointer}: {path} not in the tree")
            continue
        if needle.lower() not in "\n".join(lines[lo - 1:hi]).lower():
            out.append(f"G1 FAIL {pointer} cites {span} in {path}, but {needle!r} is not in those "
                       f"lines — the range does not cover the claim")

    orphan = 0
    for path, text in walk_strings(ej):
        if "reported_unverified" in path or not CITE_TOKEN.search(text):
            continue
        if path in CITED_POINTERS:
            continue
        orphan += 1
        out.append(f"G1 FAIL {path} carries a line citation but no needle is registered for it")

    try:
        root = resolve(ej, "spec_citations_root").get("document_root")
    except (KeyError, IndexError, TypeError, AttributeError):
        out.append("G1 FAIL spec_citations_root is absent — the artifact cites documents by bare "
                   "filename with no root, so a reader cannot follow the citation")
        root = None
    skipped = 0
    for pointer, name, span, needle in OUT_OF_TREE:
        if root is None or not (Path(root, name).is_file()):
            skipped += 1
            continue
        lo, hi = span_lines(span)
        lines = Path(root, name).read_text().splitlines()
        if needle.lower() not in "\n".join(lines[lo - 1:hi]).lower():
            out.append(f"G1 FAIL {pointer} cites {name} {span}, but {needle!r} is not in those lines")
    if skipped:
        out.append(f"G1 SKIPPED {skipped} out-of-tree citation claims: document root {root!r} is "
                   f"absent here, so they were NOT checked and no pass is claimed for them")
    else:
        out.append(f"G1 {len(OUT_OF_TREE)} out-of-tree citation claims checked at {root}")
    out.append(f"G1 {len(CITATIONS)} in-repo citation claims checked, {orphan} unregistered strings")


def guard_G2(repo, commit, ej, out):
    m7 = next(i["measured"] for i in ej["interfaces"] if i["id"] == "IF-07")
    reg = registered_skills(repo, commit)
    tops = {s: top_level(repo, commit, s) for s in reg}
    exact = sorted(s for s in reg if "VERSION" in tops[s])
    without = sorted(s for s in reg if "VERSION" not in tops[s])

    if m7["skill_dirs_with_VERSION"] != len(exact):
        out.append(f"G2 FAIL skill_dirs_with_VERSION={m7['skill_dirs_with_VERSION']} but one "
                   f"case-sensitive instrument over the {len(reg)} registry entries gives {len(exact)}")
    if sorted(m7["registered_skills_without_VERSION"]) != without:
        out.append(f"G2 FAIL registered_skills_without_VERSION={m7['registered_skills_without_VERSION']} "
                   f"but the same instrument gives {without}")
    gate = m7.get("update_capability_under_the_gate")
    if not isinstance(gate, dict):
        out.append("G2 FAIL IF-07.measured carries no update_capability_under_the_gate object — "
                   "the artifact has no single instrument behind its update-gap figures")
        return
    can, cannot = gate["registered_skills_can_report_names"], gate["registered_skills_cannot_report_names"]
    if gate["registered_skills_can_report"] != len(can):
        out.append("G2 FAIL registered_skills_can_report disagrees with its own name list")
    if gate["registered_skills_cannot_report"] != len(cannot):
        out.append("G2 FAIL registered_skills_cannot_report disagrees with its own name list")
    if sorted(can + cannot) != reg:
        out.append(f"G2 FAIL can + cannot = {sorted(can + cannot)} != registry {reg}")
    out.append(f"G2 registry={len(reg)} exact-VERSION={len(exact)} without={len(without)} "
               f"can={len(can)} cannot={len(cannot)}")


def guard_G3(repo, commit, ej, out):
    m7 = next(i["measured"] for i in ej["interfaces"] if i["id"] == "IF-07")
    gate = m7.get("update_capability_under_the_gate")
    if not isinstance(gate, dict):
        out.append("G3 FAIL IF-07.measured has no usable-vs-unusable split, so a file that exists "
                   "but cannot be read as a version is counted as usable — presence stood in for usability")
        return
    cannot = set(gate["registered_skills_cannot_report_names"])
    reg = registered_skills(repo, commit)
    usable = []
    for s in reg:
        raw = blob_text(repo, commit, f"{SKILLS_ROOT}/{s}/VERSION")
        content = raw.strip() if raw is not None else None
        if content is not None and is_version(content):
            usable.append(s)
            if s in cannot:
                out.append(f"G3 FAIL {s}: the gate reads {s}/VERSION = {content!r} fine, "
                           f"yet it is listed as unable to report an update")
        elif s not in cannot:
            why = (f"VERSION holds {content!r}, which is_version() rejects"
                   if content is not None else "no exact-case VERSION file the gate can open")
            out.append(f"G3 FAIL {s}: the gate cannot read a version ({why}), yet it is absent "
                       f"from registered_skills_cannot_report_names — file presence counted as usability")
    out.append(f"G3 {len(usable)} of {len(reg)} registered skills usable by the gate; "
               f"unusable: {sorted(cannot)}")


def guard_G4(repo, commit, ej, out):
    masked = json.loads(json.dumps(ej))
    quarantined = set()
    for iface in masked["interfaces"]:
        block = iface.pop("reported_unverified", {})
        quarantined.update(HEX40.findall(json.dumps(block)))
    masked.pop("missing_capabilities", None)
    tokens = sorted(set(HEX40.findall(json.dumps(masked))) - quarantined)
    bad = 0
    for t in tokens:
        if git(repo, "cat-file", "-t", t).returncode != 0:
            bad += 1
            out.append(f"G4 FAIL {t} does not resolve to a git object — hash evidence a reader "
                       f"cannot recompute belongs under reported_unverified with its readback")
    for iface in ej["interfaces"]:
        block = iface.get("reported_unverified")
        if not block:
            continue
        if not block.get("caveat") or not block.get("readback_commands"):
            out.append(f"G4 FAIL {iface['id']} quarantines hashes without a caveat and readback commands")
    out.append(f"G4 {len(tokens)} hash tokens asserted outside quarantine, {bad} unresolvable; "
               f"{len(quarantined)} quarantined as reported-only")


def run(repo, commit, ej, out):
    guard_G1(repo, commit, ej, out)
    guard_G2(repo, commit, ej, out)
    guard_G3(repo, commit, ej, out)
    guard_G4(repo, commit, ej, out)
    return sum(1 for l in out if " FAIL " in f" {l} ")


def selftest(repo, commit):
    good = load(repo, commit)
    out, bad = [], 0
    base, baseline = [], 0
    baseline = run(repo, commit, good, base)

    def check(name, mut, expect):
        nonlocal bad
        ej = json.loads(json.dumps(good))
        mut(ej)
        lines = []
        n = run(repo, commit, ej, lines)
        fired = n > baseline
        verdict = "ok  " if fired == expect else "FAIL"
        if fired != expect:
            bad += 1
            for l in lines:
                out.append(f"      {l}")
        out.append(f"SELFTEST {verdict} {name}: failures {baseline}->{n}, fired={fired} expected={expect}")

    check("G1 citation range narrowed off-by-one",
          lambda e: resolve_set(e, "interfaces[3].symbols[1]", "OS gate L1131-1132"), True)
    check("G1 claim wider than its citation",
          lambda e: resolve_set(e, "interfaces[3].measured.host_gate",
                                "Darwin AND arm64 required (L1131-1132)"), True)
    check("G1 new unregistered citation",
          lambda e: resolve_set(e, "interfaces[2].measured.skill_version",
                                "v2.1.23 (see L44-45)"), True)
    check("G2 mixed instruments in one measured object",
          lambda e: resolve_set(e, "interfaces[6].measured.registered_skills_without_VERSION",
                                ["drama-studio"]), True)
    check("G3 present-but-invalid VERSION counted as usable",
          lambda e: resolve(e, "interfaces[6].measured")["update_capability_under_the_gate"]
          ["registered_skills_cannot_report_names"].remove("drama-song-ad-factory"), True)
    check("G3 case-spelled version file counted as usable",
          lambda e: resolve(e, "interfaces[6].measured")["update_capability_under_the_gate"]
          ["registered_skills_cannot_report_names"].remove("council-of-wise-elders"), True)
    check("G4 hash that resolves to nothing",
          lambda e: resolve(e, "interfaces[2].measured").update(
              {"skill_tree_digest_sha256": "f" * 40}), True)
    out.append(f"SELFTEST baseline artifact under test carries {baseline} failing guard lines; "
               f"selftest asserts each seeded defect adds at least one")
    return bad, out


def resolve_set(root, pointer, value):
    parts = pointer.split(".")
    node = root
    for part in parts[:-1]:
        key, idx = split_key(part)
        if key:
            node = node[key]
        if idx is not None:
            node = node[int(idx)]
    key, idx = split_key(parts[-1])
    if idx is not None:
        node[key][int(idx)] = value
    else:
        node[key] = value


def load(repo, commit):
    if commit:
        p = git(repo, "cat-file", "-p", f"{commit}:{ART}")
        if p.returncode:
            raise SystemExit(f"cannot read {ART} at {commit}: {p.stderr.strip()}")
        return json.loads(p.stdout)
    return json.loads(Path(repo, ART).read_text())


def main():
    args, repo, commit, st = sys.argv[1:], ".", None, False
    while args:
        a = args.pop(0)
        if a == "--repo":
            repo = args.pop(0)
        elif a == "--commit":
            commit = args.pop(0)
        elif a == "--selftest":
            st = True
        else:
            raise SystemExit(f"unknown argument {a}")
    if st:
        bad, out = selftest(repo, commit)
    else:
        out = []
        bad = run(repo, commit, load(repo, commit), out)
    print(f"target: {ART} @ {commit or 'worktree'}")
    for l in out:
        print(" ", l)
    print(f"\nRESULT: {'FAIL' if bad else 'PASS'} ({bad} failing lines)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
