#!/usr/bin/env python3
"""Regenerate hooks/full-read-guard/manifest.d/999.json from the real skill folders of this repo. Stdlib only.

  build_frg_manifest.py [--repo DIR] [--out FILE] [--check]

Rules (the same everywhere; no size rule exists):
  * Only markdown documents can be instruction files. Code, data, json, html, archives are lookup by nature.
  * SKILL.md, INSTRUCTIONS.md, INSTALL.md, QC.md, CORE_UPDATES.md, root README.md and *-full.md are never lookup.
  * A markdown file is lookup when it sits in a lookup folder (tests, scripts, tools, assets, evidence, fixtures,
    runtime, schemas, config, data, adapters, hooks, ...) and its name is not an instruction
    name (sop, protocol, rubric, checklist, contract, runbook, playbook, standard, rules), or when its name marks
    it as release metadata or a catalog (changelog, examples, models, model-routing, nine-router-api, api-patterns).
  * Every other markdown file is NOT listed here: at the skill root it is an up-front instruction document; below the
    root (prompts, protocols, templates, steps, playbooks, examples, references, ...) it is read-on-open (not required
    up front, but whole when opened).
depends_on lists are kept from the existing shard (one level, decided by Trevor); this script never invents them.
"""
import argparse, json, os, re, sys

LOOKUP_DIRS = {"tests", "scripts", "tools", "assets", "evidence", "fixtures", "test-fixtures", "runtime", "schemas",
               "config", "data", "extensions",
               "adapters", "advisors", "email-library", "platform", "timer-artifacts", "hooks", "monitors",
               "prove", "receipts", "launcher_core", "repo-integration", "launchd", "agents", "schema", "validators",
               "golden", "prompt-templates"}
STRICT_LOOKUP_DIRS = {"tests", "fixtures", "test-fixtures", "evidence", "golden"}  # never overridden by a name
INSTR_NAME = re.compile(r"(sop|protocol|rubric|checklist|contract|runbook|playbook|standard|rules)", re.I)
LOOKUP_NAME = re.compile(r"^(changelog|models|model-routing|nine-router-api|api-patterns|third_party_license)\.md$|catalog|registry|glossary", re.I)
HARD = {"skill.md", "instructions.md", "install.md", "qc.md", "core_updates.md"}
SKIP = {"node_modules", ".git", "__pycache__"}


def sources(repo):
    out = {}
    base = os.path.join(repo, ".claude", "skills")
    for n in sorted(os.listdir(base)):
        d = os.path.join(base, n)
        if os.path.isdir(d) and not os.path.islink(d) and os.path.isfile(os.path.join(d, "SKILL.md")):
            out[re.sub(r"^\d+-", "", n)] = d
    extra = [os.path.join(repo, "23-ai-workforce-blueprint")] + [
        os.path.join(repo, "installer-registration", "helpers", h) for h in ("66-kie-image", "68-kie-audio")]
    for d in extra:
        if os.path.isfile(os.path.join(d, "SKILL.md")):
            out[re.sub(r"^\d+-", "", os.path.basename(d))] = d
    return out


def is_lookup_md(rel):
    low = rel.lower()
    base = low.rsplit("/", 1)[-1]
    if base in HARD or base.endswith("-full.md") or ("/" not in rel and base == "readme.md"):
        return False
    segs = rel.split("/")[:-1]
    if any(s in STRICT_LOOKUP_DIRS for s in segs):
        return True
    if LOOKUP_NAME.search(base):
        return True
    if any(s in LOOKUP_DIRS for s in segs):
        return not INSTR_NAME.search(base)
    return False


def entry(name, d, depends):
    exact, dirs = [], {}
    for r, ds, fs in os.walk(d):
        ds[:] = sorted(x for x in ds if x not in SKIP)
        for f in sorted(fs):
            if not f.lower().endswith((".md", ".markdown", ".mdx")):
                continue
            rel = os.path.relpath(os.path.join(r, f), d).replace(os.sep, "/")
            if is_lookup_md(rel):
                exact.append(rel)
    # fold into folder globs when every markdown file below that folder is lookup
    allmd = {}
    for r, ds, fs in os.walk(d):
        ds[:] = [x for x in ds if x not in SKIP]
        for f in fs:
            if f.lower().endswith((".md", ".markdown", ".mdx")):
                allmd[os.path.relpath(os.path.join(r, f), d).replace(os.sep, "/")] = None
    globs, used = [], set()
    tops = sorted({e.split("/")[0] for e in exact if "/" in e})
    for t in tops:
        under = [m for m in allmd if m.startswith(t + "/")]
        if under and all(m in exact for m in under):
            globs.append(t + "/**")
            used.update(under)
    globs += [e for e in exact if e not in used]
    return {"skill": name, "depends_on": depends, "lookup": sorted(globs)}


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--repo", default=os.path.abspath(os.path.join(here, "..", "..", "..", "..", "..")))
    ap.add_argument("--out", default=os.path.abspath(os.path.join(here, "..", "..", "hooks", "full-read-guard", "manifest.d", "999.json")))
    ap.add_argument("--check", action="store_true", help="exit 1 when the shard on disk differs from a fresh build")
    a = ap.parse_args()
    old = {}
    try:
        for e in json.load(open(a.out, encoding="utf-8")).get("skills", []):
            old[e["skill"]] = e.get("depends_on", [])
    except (OSError, ValueError):
        pass
    src = sources(a.repo)
    # a dependency that is not a bundled skill folder (or a universal-sops file) cannot be read, so it is dropped
    keep = lambda n: [x for x in old.get(n, []) if x in src or (x.startswith("universal-sops/") and os.path.isfile(os.path.join(a.repo, x)))]
    skills = [entry(n, d, keep(n)) for n, d in sorted(src.items())]
    doc = {"schema": "frg.manifest/v1", "about": "Generated by scripts/common/build_frg_manifest.py. lookup = markdown files that may be searched; every other markdown file is an instruction file that must be read whole. depends_on = direct dependencies (one level).", "skills": skills}
    text = json.dumps(doc, indent=1, ensure_ascii=False) + "\n"
    if a.check:
        return 0 if (os.path.exists(a.out) and open(a.out, encoding="utf-8").read() == text) else 1
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote %s (%d skills)" % (a.out, len(skills)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
