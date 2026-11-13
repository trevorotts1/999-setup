"""999 host profile path and environment resolver (PD-036).

The 999 installation has no OpenClaw tree. Everything the Presentations
department needs is resolved from THIS skill tree plus the user's chosen
project folder:

  skill_root    <repo>/.claude/skills/signature-presentation (the vendored tree)
  dept_scripts  <skill_root>/scripts   (build_deck.py, run_signature_deck.py)
  project_dir   --project-dir, else the current working directory
  run_dir       --run-dir, else <project>/presentation-runs/<local stamp>
  workspace     <project>/.presentation-999/workspace, a shim whose
                departments/Presentations link points at the vendored tree so
                the vendored bin/presentation exit-61 materialization check
                passes without an OpenClaw install
  outbox        <run_dir>/working/outbox.jsonl (the file-queue notify transport)
  downloads     <HOME>/Downloads (the second delivery destination)

The notify transport is the file queue, never the OpenClaw gateway. The
Command Center board mirror stays OFF unless the caller has configured a board
address (COMMAND_CENTER_URL or MISSION_CONTROL_URL); this module never invents
one.

The image key is read BY NAME from the user's own ``API docs.md``. A key value
is returned only to the child environment; ``plan()`` reports presence and
length, never the value, and nothing here prints a secret.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SKILL_ROOT = Path(__file__).resolve().parent.parent
VENDORED_MD = SKILL_ROOT / "VENDORED.md"
OUTBOX_QUEUE = SKILL_ROOT / "bin" / "presentation-outbox-queue"
API_DOCS_NAME = "API docs.md"
IMAGE_KEY_NAMES = ("KIE_API_KEY", "KIE_AI_API_KEY", "KIE_APIKEY")
PLACEHOLDERS = ("", "changeme", "change-me", "your-key-here", "your_key_here",
                "xxx", "todo", "placeholder")

_KEY_LINE = re.compile(
    r"^\s*(?:[-*]\s*)?(?:\*\*)?([A-Za-z][A-Za-z0-9_]*)(?:\*\*)?\s*[:=]\s*(.+?)\s*$")

def skill_root() -> Path:
    return SKILL_ROOT

def dept_scripts() -> Path:
    return SKILL_ROOT / "scripts"

def project_dir(value: Optional[str] = None) -> Path:
    """The user's chosen project folder: explicit value, else the cwd."""
    return Path(value).expanduser().resolve() if value else Path.cwd().resolve()

def default_run_dir(project: Path) -> Path:
    """A fresh run folder under the user's chosen project folder."""
    stamp = time.strftime("%Y-%m-%d-%H%M%S")
    return (Path(project) / "presentation-runs" / stamp).resolve()

def run_dir(project: Path, value: Optional[str] = None) -> Path:
    """Resolve --run-dir; the default lives under the project folder."""
    return Path(value).expanduser().resolve() if value else default_run_dir(project)

def under(path: Path, project: Path) -> bool:
    """True when path is the project folder or below it."""
    path, project = Path(path).resolve(), Path(project).resolve()
    return path == project or project in path.parents

def downloads_dir() -> Path:
    return (Path.home() / "Downloads").resolve()

def ensure_run_dir(path: Path) -> Path:
    """Create the run folder and its three working subfolders (idempotent)."""
    path = Path(path).resolve()
    path.mkdir(parents=True, exist_ok=True)
    for sub in ("working/copy", "working/interview", "working/checkpoints"):
        (path / sub).mkdir(parents=True, exist_ok=True)
    return path

def _owner_path(run: Path) -> Path:
    return Path(run) / "working" / "checkpoints" / "999-owner.json"

def save_owner(run: Path, owner_msg_id: str) -> None:
    """Persist the session's owner message id for later turns of the same run.

    Without this a later --complete that did not repeat --owner-msg-id falls
    back to the OpenClaw operator store (and on a clean account creates a
    ~/.openclaw folder the 999 profile must not need).
    """
    if not owner_msg_id:
        return
    path = _owner_path(run)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"owner_msg_id": owner_msg_id}, indent=2),
                    encoding="utf-8")

def load_owner(run: Path) -> str:
    try:
        return str(json.loads(_owner_path(run).read_text(encoding="utf-8"))
                   .get("owner_msg_id") or "")
    except (OSError, json.JSONDecodeError, AttributeError):
        return ""

# ---------------------------------------------------------------------------
# API docs.md -- image key read by name, value never printed
# ---------------------------------------------------------------------------
def api_docs_candidates(project: Path, explicit: Optional[str] = None) -> List[Path]:
    out: List[Path] = []
    if explicit:
        out.append(Path(explicit).expanduser().resolve())
    out.extend([
        Path(project) / API_DOCS_NAME,
        Path(project) / "docs" / API_DOCS_NAME,
        Path.home() / "Downloads" / API_DOCS_NAME,
        Path.home() / API_DOCS_NAME,
    ])
    return out

def find_api_docs(project: Path, explicit: Optional[str] = None) -> Optional[Path]:
    for candidate in api_docs_candidates(project, explicit):
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None

def read_key(api_docs: Path) -> Tuple[Optional[str], Optional[str]]:
    """Return (key name, value) for the first known image-key name in the file.

    The value is for the child environment only; callers must never print it.
    """
    try:
        lines = Path(api_docs).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None, None
    known = {name.upper(): name for name in IMAGE_KEY_NAMES}
    for line in lines:
        match = _KEY_LINE.match(line)
        if not match:
            continue
        name = known.get(match.group(1).upper())
        if not name:
            continue
        value = match.group(2).strip().strip("`'\"").strip()
        if value.lower() in PLACEHOLDERS or value.startswith("<"):
            continue
        return name, value
    return None, None

def image_key(project: Path, explicit_docs: Optional[str] = None) -> Dict[str, Any]:
    """Plan-safe view of the image key: name, presence, length, source path."""
    docs = find_api_docs(project, explicit_docs)
    if docs is None:
        return {"name": None, "present": False, "length": 0, "source": None}
    name, value = read_key(docs)
    return {"name": name, "present": bool(name and value),
            "length": len(value or ""), "source": str(docs)}

# ---------------------------------------------------------------------------
# dependency gate -- presentation-deps.json is the one canon
# ---------------------------------------------------------------------------
def _python_import_present(spec: str) -> bool:
    for module in [m.strip() for m in spec.split(",") if m.strip()]:
        try:
            if importlib.util.find_spec(module) is None:
                return False
        except (ImportError, ValueError):
            return False
    return True

def _dep_present(dep: Dict[str, Any]) -> bool:
    kind = dep.get("kind")
    if kind == "binary":
        if shutil.which(str(dep.get("binary_name") or dep.get("name") or "")):
            return True
        provided = str(dep.get("provides_with") or "")
        return bool(provided and shutil.which(provided))
    if kind == "python_import":
        return _python_import_present(str(dep.get("import_spec") or ""))
    return False

def dependency_report() -> Dict[str, Any]:
    """Names of every dependency, split present/missing, required subset named.

    The names are the manifest's own ``name`` strings, so a missing tool is
    reported by exactly the name the dependency canon uses.
    """
    manifest = dept_scripts() / "presentation-deps.json"
    if not manifest.is_file():
        return {"manifest": str(manifest), "manifest_found": False,
                "present": [], "missing": [], "required_missing": []}
    try:
        doc = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"manifest": str(manifest), "manifest_found": True,
                "error": f"unreadable: {exc}", "present": [], "missing": [],
                "required_missing": []}
    present: List[str] = []
    missing: List[str] = []
    required_missing: List[str] = []
    for dep in doc.get("deps") or []:
        name = str(dep.get("name") or "")
        if not name:
            continue
        if _dep_present(dep):
            present.append(name)
        else:
            missing.append(name)
            if dep.get("required"):
                required_missing.append(name)
    return {"manifest": str(manifest), "manifest_found": True,
            "present": present, "missing": missing,
            "required_missing": required_missing}

# ---------------------------------------------------------------------------
# workspace shim -- satisfies bin/presentation's exit-61 materialization check
# ---------------------------------------------------------------------------
def workspace_dir(project: Path) -> Path:
    return (Path(project).resolve() / ".presentation-999" / "workspace")

def ensure_workspace(project: Path) -> Path:
    """Create the shim and point departments/Presentations at the vendored tree.

    Raises RuntimeError (never silently proceeds) when the link cannot be
    created -- proceeding without it would trip bin/presentation exit 61 with a
    misleading "department not materialized" message.
    """
    ws = workspace_dir(project)
    link = ws / "departments" / "Presentations"
    (ws / "departments").mkdir(parents=True, exist_ok=True)
    if link.exists() or link.is_symlink():
        try:
            if link.resolve() == SKILL_ROOT.resolve():
                return ws
        except OSError:
            pass
        raise RuntimeError(
            f"{link} exists but does not point at {SKILL_ROOT}; remove it and re-run")
    try:
        link.symlink_to(SKILL_ROOT, target_is_directory=True)
    except (OSError, NotImplementedError) as exc:
        raise RuntimeError(
            f"cannot create the workspace link {link} -> {SKILL_ROOT}: {exc}. "
            f"The 999 host profile needs directory symlinks; enable them and re-run. "
            f"(The build was NOT started.)") from exc
    return ws

# ---------------------------------------------------------------------------
# plan + environment
# ---------------------------------------------------------------------------
def _vendored_record() -> Dict[str, Any]:
    if not VENDORED_MD.is_file():
        return {"present": False}
    try:
        text = VENDORED_MD.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {"present": False}
    files = re.search(r"^- Files vendored: (\d+)$", text, re.M)
    digest = re.search(r"^- Tree digest: `sha256:([0-9a-f]{64})`$", text, re.M)
    commit = re.search(r"^- Source commit: `([0-9a-f]{40})`$", text, re.M)
    return {"present": True,
            "files": int(files.group(1)) if files else None,
            "tree_digest": digest.group(1) if digest else None,
            "source_commit": commit.group(1) if commit else None}

def board_mirror() -> Dict[str, Any]:
    """ON only when a board address is configured; host only, never a token."""
    for name in ("COMMAND_CENTER_URL", "MISSION_CONTROL_URL"):
        value = str(os.environ.get(name) or "").strip()
        if value:
            host = value.split("://", 1)[-1].split("/", 1)[0]
            return {"board_mirror": "on", "configured_by": name, "host": host}
    return {"board_mirror": "off", "configured_by": None, "host": None}

def plan(project: Path, run: Path, owner_msg_id: Optional[str] = None,
         api_docs: Optional[str] = None) -> Dict[str, Any]:
    """Read-only description of what the wrapper would do. Never prints a key."""
    key = image_key(project, api_docs)
    deps = dependency_report()
    return {
        "profile": "999",
        "skill_root": str(SKILL_ROOT),
        "vendored": _vendored_record(),
        "dept_scripts": str(dept_scripts()),
        "project_dir": str(project),
        "run_dir": str(run),
        "workspace": str(workspace_dir(project)),
        "openclaw_root": str(Path(project) / ".presentation-999" / ".openclaw"),
        "notify": {"transport": "file-queue",
                   "command": str(OUTBOX_QUEUE),
                   "outbox": str(Path(run) / "working" / "outbox.jsonl")},
        "command_center": board_mirror(),
        "image_key": key,
        "owner_message_id": owner_msg_id or "",
        "delivery": {"run_dir": str(Path(run) / "delivery"),
                     "downloads": str(downloads_dir())},
        "dependencies": deps,
        "commands": {
            "interview_next": f"{SKILL_ROOT / 'bin' / 'presentation-999'} "
                              f"--interview --run-dir {run} --next",
            "interview_complete": f"{SKILL_ROOT / 'bin' / 'presentation-999'} "
                                  f"--interview --run-dir {run} --complete",
            "build": f"{SKILL_ROOT / 'bin' / 'presentation-999'} "
                     f"--build --run-dir {run} --slides <slides.json> "
                     f"--out <out.pptx>",
            "deps": f"{SKILL_ROOT / 'bin' / 'presentation-999'} --deps",
        },
    }

def env(project: Path, run: Optional[Path] = None,
        owner_msg_id: Optional[str] = None,
        api_docs: Optional[str] = None,
        base: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Child environment for the vendored driver and the vendored door.

    Explicit exports win over a secrets file in the vendored bin/presentation
    (PRES-050); the notify command is always set, so no OpenClaw install and no
    secrets file is required.
    """
    child = dict(os.environ if base is None else base)
    ws = ensure_workspace(project)
    # Pin BOTH OpenClaw roots into the project folder. The vendored engine and
    # resource_profile write state next to the OpenClaw root; on a clean
    # account that must not create ~/.openclaw, and on a box that has one it
    # must not read another client's state.
    shim_root = Path(project).resolve() / ".presentation-999" / ".openclaw"
    child["OPENCLAW_ROOT"] = str(shim_root)
    child["OPENCLAW_WORKSPACE"] = str(ws)
    child["OPENCLAW_WORKSPACE_PATH"] = str(ws)
    child["PRESENTATION_NOTIFY_CMD"] = str(OUTBOX_QUEUE)
    if run is not None:
        child["PRESENTATION_RUN_DIR"] = str(Path(run).resolve())
    if owner_msg_id:
        child["PRESENTATION_REQUESTER_CHAT_ID"] = owner_msg_id
        child["PRESENTATION_REQUESTER_CHANNEL"] = "claude-code"
        child["PRESENTATION_OWNER_MSG_ID"] = owner_msg_id
    docs = find_api_docs(project, api_docs)
    if docs is not None:
        name, value = read_key(docs)
        if name and value:
            child["KIE_API_KEY"] = value
    return child

if __name__ == "__main__":  # pragma: no cover -- manual inspection only
    proj = project_dir(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps(plan(proj, default_run_dir(proj)), indent=2))
