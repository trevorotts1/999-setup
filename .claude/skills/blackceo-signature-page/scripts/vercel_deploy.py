#!/usr/bin/env python3
"""vercel_deploy.py: the 999 edition's Vercel deploy rail.

Fix plan Item 28, Row 7. Skill 71's onboarding deploy route names a
Vercel skill from the OpenClaw tree, which does not resolve in this
harness. This module vendors the rail: it checks the installed
Vercel CLI against the pinned minimum and then passes the deploy
through to the real CLI. The matching bootstrap pin for the 999
installer lives in references/vercel-cli-pin.json (the installer
currently provisions vercel@latest; replacing that with the pin is
a named integration step, and the Item 27 parity checker flags the
drift until it lands).

MIN_VERCEL_CLI = "64.0.2"

Usage:
  vercel_deploy.py check
      Print the installed CLI version and whether it meets the pin.
  vercel_deploy.py deploy -- <vercel deploy arguments>
      Refuse when the installed CLI is older than MIN_VERCEL_CLI or
      absent; otherwise run `vercel deploy` with the given arguments
      and pass its exit code through.
"""
import re
import subprocess
import sys

MIN_VERCEL_CLI = "64.0.2"


def installed_version():
    proc = subprocess.run(["vercel", "--version"], text=True,
                          capture_output=True)
    if proc.returncode != 0:
        return None
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", proc.stdout or "")
    if not match:
        return None
    return tuple(int(x) for x in match.groups())


def parse(version):
    return tuple(int(x) for x in version.split("."))


def main(argv):
    if not argv or argv[0] not in ("check", "deploy"):
        print(__doc__.split("Usage:")[1].strip())
        return 2
    found = installed_version()
    if argv[0] == "check":
        if found is None:
            print("vercel CLI: NOT INSTALLED (the 999 installer "
                  "provisions it; see references/vercel-cli-pin.json)")
            return 1
        dotted = ".".join(str(x) for x in found)
        ok = found >= parse(MIN_VERCEL_CLI)
        print(f"vercel CLI: {dotted} (minimum pinned {MIN_VERCEL_CLI}: "
              f"{'OK' if ok else 'TOO OLD'})")
        return 0 if ok else 1
    if found is None or found < parse(MIN_VERCEL_CLI):
        dotted = ".".join(str(x) for x in found) if found else "none"
        print(f"REFUSED: vercel deploy requires CLI >= {MIN_VERCEL_CLI} "
              f"(found {dotted}). The bootstrap pin is "
              "references/vercel-cli-pin.json.")
        return 2
    rest = argv[1:]
    if rest and rest[0] == "--":
        rest = rest[1:]
    proc = subprocess.run(["vercel", "deploy", *rest])
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
