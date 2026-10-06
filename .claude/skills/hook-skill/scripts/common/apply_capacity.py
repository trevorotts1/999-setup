#!/usr/bin/env python3
"""Measure this box and write the result where the hooks and Claude Code read it. Stdlib only.

  apply_capacity.py --probe DIR/capacity_probe.py --limits FILE --settings FILE [--settings FILE ...]
                    [--manifest FILE] [--dry-run]
  apply_capacity.py --restore --manifest FILE [--dry-run]     put each settings env back as it was before install

per_workflow_cap comes from capacity_probe.py (RAM, logical cores, container limits; never typed by hand).
Writes, merging and never clobbering other keys:
  limits.json            concurrent_agents_per_workflow = cap, concurrent_agents_total = min(500, cap * 50)
  each settings.json     env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS = "<cap>"
With --manifest the value each settings.json held BEFORE the first install is recorded (once) so uninstall can restore it.
Idempotent. A missing/unreadable settings file that does not exist yet is created; an invalid one is left untouched.
"""
import argparse, importlib.util, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settings_merge  # noqa: E402

ENV_NAME = "CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS"


def load_probe(path):
    spec = importlib.util.spec_from_file_location("capacity_probe", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_json(path, doc, dry):
    print("%s %s" % ("would write" if dry else "wrote", path))
    if not dry:
        settings_merge.DRY = False
        settings_merge.save(path, doc)


def load_manifest(path):
    try:
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
        return m if isinstance(m, dict) else None
    except (OSError, ValueError):
        return None


def apply(probe_result, limits, settings, dry=False, manifest=None):
    cap, total = probe_result["per_workflow_cap"], probe_result["max_working_agents"]
    lim = {}
    if os.path.exists(limits):
        try:
            with open(limits, encoding="utf-8") as f:
                lim = json.load(f)
        except (OSError, ValueError):
            lim = {}
        if not isinstance(lim, dict):
            lim = {}
    lim.update({"concurrent_agents_per_workflow": cap, "concurrent_agents_total": total})
    write_json(limits, lim, dry)
    for s in settings:
        doc = settings_merge.load(s)  # raises on invalid JSON: nothing is modified
        if "env" in doc and not isinstance(doc["env"], dict):
            raise ValueError("%s: settings.env is not an object" % s)
        m = load_manifest(manifest) if manifest else None
        if m is not None and not dry:
            prior = m.setdefault("env_prior", {})
            if s not in prior:  # first install only: later runs must not record our own value as "prior"
                prior[s] = {"had_env": "env" in doc, "value": doc.get("env", {}).get(ENV_NAME)}
                settings_merge.DRY = False
                settings_merge.save(manifest, m)
        doc.setdefault("env", {})[ENV_NAME] = str(cap)
        write_json(s, doc, dry)


def restore(manifest, dry=False):
    m = load_manifest(manifest)
    for s, was in ((m or {}).get("env_prior") or {}).items():
        if not os.path.exists(s):
            continue
        doc = settings_merge.load(s)
        env = doc.get("env")
        if isinstance(env, dict):
            if was.get("value") is None:
                env.pop(ENV_NAME, None)
            else:
                env[ENV_NAME] = was["value"]
            if not env and not was.get("had_env"):
                del doc["env"]
            write_json(s, doc, dry)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--probe")
    p.add_argument("--limits")
    p.add_argument("--manifest")
    p.add_argument("--restore", action="store_true")
    p.add_argument("--settings", action="append", default=[])
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    try:
        if a.restore:
            if not a.manifest:
                p.error("--restore needs --manifest")
            restore(a.manifest, a.dry_run)
            return 0
        if not a.probe or not a.limits:
            p.error("--probe and --limits are required")
        r = load_probe(a.probe).probe()
        print("capacity: %s GB, %s cores (%s) -> per_workflow_cap %d, max_working_agents %d" % (
            r["ram_gb"], r["cores"], r["source"], r["per_workflow_cap"], r["max_working_agents"]))
        apply(r, a.limits, a.settings, a.dry_run, a.manifest)
    except (ValueError, OSError, KeyError) as e:
        print("apply_capacity: %s: %s (nothing further written)" % (type(e).__name__, e), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
