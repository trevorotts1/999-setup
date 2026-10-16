"""MOCK-only tests: ghl_image_stage resolves the KIE key through the shared
secret-name canon (shared-utils/secret_names.json), not its own bare-name list.

No real keys, no network. Every value is a generic FAKE fixture.
"""
from __future__ import annotations

import json
import os
import sys

_TOOLS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "tools"))
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)

import pytest

import ghl_image_stage as st

FAKE_KEY = "FAKEkie0000000000000000000000001"  # 32 chars, not placeholder-shaped


# The dirs ghl_image_stage itself resolves shared-utils from: the in-tree repo
# siblings, plus $SKILL6_SHARED_UTILS_DIR. The OpenClaw tree
# (~/.openclaw/skills, /data/.openclaw/skills) is NOT probed by this pack --
# PACK.md "nothing in this pack borrows from the OpenClaw skills tree at
# runtime", the same in-tree binding tools/model_router.py uses.
_SHARED_UTILS_BASES = [
    os.path.normpath(os.path.join(_TOOLS_DIR, "..", "..", "shared-utils")),
    os.path.normpath(os.path.join(_TOOLS_DIR, "..", "..", "..", "shared-utils")),
]
if os.environ.get("SKILL6_SHARED_UTILS_DIR"):
    _SHARED_UTILS_BASES.append(os.environ["SKILL6_SHARED_UTILS_DIR"])


def _canon_dir() -> str | None:
    """The shared-utils dir carrying the canon, or None when it is unreadable."""
    for base in _SHARED_UTILS_BASES:
        if os.path.isfile(os.path.join(base, "secret_names.json")):
            return base
    return None


def _canon_kie_family() -> list[str]:
    base = _canon_dir()
    assert base is not None, "canon absent -- guarded by the module-level skip below"
    with open(os.path.join(base, "secret_names.json"), encoding="utf-8") as fh:
        return json.load(fh)["canonical_names"]["KIE_API_KEY"]


# Every assertion in this module reads the shared secret-name canon, and the
# placeholder guard they exercise (`_kie_value_ok`) fails open when the canon is
# unreadable. The 999 repo ships no shared-utils, so with no designation there is
# nothing to assert against -- skip honestly rather than fail on a missing
# dependency (or, worse, pass only because an OpenClaw tree happened to be
# mounted on the box running the tests).
pytestmark = pytest.mark.skipif(
    _canon_dir() is None,
    reason=("shared-utils canon unreadable: ghl_image_stage resolves it in-tree "
            "(tools/../../shared-utils) plus $SKILL6_SHARED_UTILS_DIR, and never from "
            "the OpenClaw tree; the 999 repo ships no shared-utils. Point "
            "SKILL6_SHARED_UTILS_DIR at a dir holding secret_names.json + "
            "secret_helper.py to exercise these canon assertions."),
)


@pytest.fixture
def no_stores(monkeypatch, tmp_path):
    monkeypatch.setattr(st, "_KIE_ENV_STORES", (str(tmp_path / "absent.env"),))


def test_names_come_from_the_shared_canon():
    assert list(st._KIE_KEY_ENV_NAMES) == _canon_kie_family()


def test_every_canon_alias_resolves_from_env(no_stores):
    for name in _canon_kie_family():
        assert st._resolve_kie_api_key({name: FAKE_KEY}) == FAKE_KEY, name


def test_alias_resolves_from_store(monkeypatch, tmp_path):
    alias = _canon_kie_family()[1]
    store = tmp_path / ".env"
    store.write_text(f"# fake\n{alias}={FAKE_KEY}\n", encoding="utf-8")
    monkeypatch.setattr(st, "_KIE_ENV_STORES", (str(store),))
    assert st._resolve_kie_api_key({}) == FAKE_KEY


def test_placeholder_is_rejected_and_fails_honestly(no_stores):
    with pytest.raises(st.ImagePipelineError) as ei:
        st._resolve_kie_api_key({"KIE_API_KEY": "PASTE_REAL_TOKEN_HERE"})
    assert ei.value.honest_fail is True
    assert "PASTE_REAL_TOKEN_HERE" not in str(ei.value)  # never echo a value


def test_absent_error_names_aliases_and_says_client_own_key(no_stores):
    with pytest.raises(st.ImagePipelineError) as ei:
        st._resolve_kie_api_key({})
    msg = str(ei.value)
    assert "client's" in msg and "operator's own" not in msg
    for name in _canon_kie_family():
        assert name in msg
