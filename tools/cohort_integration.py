#!/usr/bin/env python3
"""Cohort integration gate for the 999-setup repository (PBB-125 / T-44).

Read-only evaluator. It takes an integration plan (JSON) and returns an
ACCEPT/REFUSE verdict with typed refusals. It never writes, never merges and
never pushes. Without `remote` the evaluation is pure and in-memory; with
`--verify-remote` it performs GET-only `gh api` reads (target ref, lease ref,
protection, rulesets, check-runs, repair commits, containment). The caller owns
the merge; this module owns the refusal logic.

Clauses enforced (T-44 acceptance):
  * single shared target owner .......... remote lease-ref holder, generation, expiry-as-evidence
  * compatible 999 cohorts .............. shared-file classes, combined candidates, BC-01..BC-08, dependencies
  * explicit distribution + hash order .. deterministic order plus order digest, parity basis
  * required checks ..................... per-head success receipts, or a proven empty check surface
  * named repair remote content proof ... exact SHA, tree and containment read back from the remote

ponytail: plan in / verdict out; one narrow read-only remote adapter.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys

FULL_SHA = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
CONTENT_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
BC_CASES = {"BC-0%d" % i for i in range(1, 9)}
MERGE_METHODS = {"merge", "squash", "rebase"}
PROOF_METHODS = {"ancestry", "tree_equality", "content_equivalence"}
VENDORED_PREFIX = ".claude/skills/conversational-ai-system/"
# Named shared-file classes from the 999 merge plan (S6 vendoring write, S7 release markers).
SHARED_FILES = {
    "VERSION": "S7",
    "CHANGELOG.md": "S7",
    "DIST-02-PACKAGING-MANIFEST.json": "S6",
    "CONTROL/bundled-skills.txt": "S6",
}
ALLOWED_EDGES = {"onboarding->999", "onboarding->cc"}


def _is_sha(value):
    return isinstance(value, str) and bool(FULL_SHA.match(value))


def _is_digest(value):
    return isinstance(value, str) and bool(CONTENT_DIGEST.match(value))


def shared_file_class(path):
    """Return the named shared-file class for a 999 path, or None."""
    if path in SHARED_FILES:
        return SHARED_FILES[path]
    if path.startswith(VENDORED_PREFIX):
        return "S6"
    return None


class RemoteError(Exception):
    """A remote observation could not be made. Fail closed, never guess."""


class GhRemote:
    """Read-only GitHub observations through the `gh` CLI.

    Only GET is used. There is no write, no merge and no push path in this
    class, so a plan can be verified without any ability to mutate the target.
    ponytail: one narrow `get`; add methods only when a clause needs one.
    """

    def __init__(self, repo, run=None, timeout=30):
        self.repo = repo
        self._run = run or subprocess.run
        self.timeout = timeout

    def get(self, path):
        """Return (http_status, body). 404 yields (404, None); everything else fails closed."""
        try:
            proc = self._run(
                ["gh", "api", path],
                capture_output=True, text=True, timeout=self.timeout, check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise RemoteError("gh api %s could not run: %s" % (path, exc))
        if proc.returncode == 0:
            try:
                return 200, json.loads(proc.stdout or "null")
            except ValueError as exc:
                raise RemoteError("gh api %s returned unparsable JSON: %s" % (path, exc))
        stderr = proc.stderr or ""
        status = re.search(r"HTTP (\d{3})", stderr)
        if status and status.group(1) == "404":
            return 404, None
        raise RemoteError("gh api %s failed (rc=%d%s)"
                          % (path, proc.returncode, ", HTTP %s" % status.group(1) if status else ""))


def verify_remote(plan, remote):
    """Cross-check a plan against remote observations. Returns extra refusals.

    This is what turns a declared `source: "remote"` into an observed fact:
    target head, lease-ref SHA, protection, required contexts, check
    conclusions, repair commit existence, tree content and containment.

    Remote mode additionally requires `target_owner.observed_lease_sha` and
    `repairs[].remote_read.tree_sha`; without them there is nothing to compare
    the remote against and the plan is refused. The lease read-back is never
    skipped: a `lease_ref` outside `refs/` is refused instead.
    """
    refusals = []

    def refuse(code, detail):
        refusals.append({"code": code, "detail": detail})

    def get(path):
        try:
            status, body = remote.get(path)
        except RemoteError as exc:
            return None, None, str(exc)
        return status, body, None

    repo = plan.get("canonical_remote") or ""
    branch = plan.get("target_branch") or "main"
    surface = plan.get("check_surface") if isinstance(plan.get("check_surface"), dict) else {}
    target_sha = plan.get("target_sha_after")

    # ---- target head read-back ------------------------------------------
    status, body, error = get("repos/%s/git/ref/heads/%s" % (repo, branch))
    if error:
        refuse("remote.target_unreadable", error)
    elif status != 200 or not isinstance(body, dict):
        refuse("remote.target_unreadable",
               "target ref %s/%s returned %s" % (repo, branch, status))
    else:
        observed = (body.get("object") or {}).get("sha")
        if observed != target_sha:
            refuse("remote.target_sha_mismatch",
                   "remote %s/%s is %r, plan claims %r" % (repo, branch, observed, target_sha))

    # ---- lease ref read-back --------------------------------------------
    owner = plan.get("target_owner") if isinstance(plan.get("target_owner"), dict) else {}
    lease_ref = owner.get("lease_ref")
    expected_lease_sha = owner.get("observed_lease_sha")
    if isinstance(lease_ref, str) and lease_ref.startswith("refs/"):
        status, body, error = get("repos/%s/git/%s" % (repo, lease_ref[len("refs/"):]))
        if error:
            refuse("remote.lease_unreadable", error)
        elif status != 200 or not isinstance(body, dict):
            refuse("remote.lease_unreadable",
                   "lease ref %s is not held on the remote (status %s)" % (lease_ref, status))
        elif not isinstance(expected_lease_sha, str) or \
                (body.get("object") or {}).get("sha") != expected_lease_sha:
            refuse("remote.lease_sha_mismatch",
                   "lease ref %s holds %r, plan claims %r"
                   % (lease_ref, (body.get("object") or {}).get("sha"), expected_lease_sha))
    else:
        # Never skip this read-back: a lease ref with no remote address is not
        # evidence of a single owner, and the verdict must not claim one.
        refuse("remote.lease_ref_invalid",
               "target_owner.lease_ref must be a full refs/... ref to read the lease back, got %r"
               % (lease_ref,))

    # ---- protection and required contexts --------------------------------
    # 404 on this sub-resource means "not protected" in this environment, proven
    # by sibling repos answering 200 with the same token (PREP-MERGE §1.4).
    # A 403 is not read as "unprotected": it fails closed as unreadable.
    status, body, error = get("repos/%s/branches/%s/protection" % (repo, branch))
    if error:
        refuse("remote.protection_unreadable", error)
    else:
        protected = status == 200
        if protected != surface.get("protection_observed"):
            refuse("remote.protection_mismatch",
                   "remote protection is %r, plan claims %r"
                   % (protected, surface.get("protection_observed")))

    observed_contexts = set()
    status, body, error = get("repos/%s/rulesets" % repo)
    if error:
        refuse("remote.ruleset_unreadable", error)
    elif status == 200 and isinstance(body, list):
        for ruleset in body:
            if not isinstance(ruleset, dict) or ruleset.get("target") != "BRANCH":
                continue
            if ruleset.get("enforcement") != "ACTIVE":
                continue
            ruleset_id = ruleset.get("id")
            if ruleset_id is None:
                refuse("remote.ruleset_unreadable", "active branch ruleset without an id")
                continue
            st, detail, err = get("repos/%s/rulesets/%s" % (repo, ruleset_id))
            if err or st != 200 or not isinstance(detail, dict):
                refuse("remote.ruleset_unreadable",
                       "ruleset %r unreadable (%s)" % (ruleset_id, err or st))
                continue
            for rule in detail.get("rules") or []:
                if not isinstance(rule, dict) or rule.get("type") != "required_status_checks":
                    continue
                params = rule.get("parameters") or {}
                for check in params.get("required_status_checks") or []:
                    if isinstance(check, dict) and isinstance(check.get("context"), str):
                        observed_contexts.add(check["context"])
    declared_contexts = set(surface.get("required_contexts") or [])
    if observed_contexts != declared_contexts:
        refuse("remote.check_surface_mismatch",
               "remote required contexts %s != plan %s"
               % (sorted(observed_contexts), sorted(declared_contexts)))

    # ---- required check conclusions on the cohort head -------------------
    cohort_head = plan.get("cohort_head_sha")
    if isinstance(cohort_head, str):
        status, body, error = get(
            "repos/%s/commits/%s/check-runs?per_page=100" % (repo, cohort_head))
        runs = {}
        if error:
            refuse("remote.check_unreadable", error)
        elif status == 200 and isinstance(body, dict):
            for run in body.get("check_runs") or []:
                if not isinstance(run, dict):
                    continue
                name = run.get("name")
                run_id = run.get("id") if isinstance(run.get("id"), int) else 0
                if name not in runs or run_id >= runs[name][0]:
                    runs[name] = (run_id, run.get("conclusion"))
        else:
            refuse("remote.check_unreadable",
                   "check-runs for %s returned %s" % (cohort_head, status))
        for context in sorted(declared_contexts):
            if context not in runs:
                refuse("remote.check_missing",
                       "remote has no %r check run on %s" % (context, cohort_head))
            elif runs[context][1] != "success":
                refuse("remote.check_not_success",
                       "remote %r concluded %r on %s"
                       % (context, runs[context][1], cohort_head))

    # ---- named repairs: exact commit, content and containment ------------
    for repair in plan.get("repairs") or []:
        if not isinstance(repair, dict):
            continue
        repair_id = repair.get("repair_id") or "<unnamed>"
        commit_sha = repair.get("commit_sha")
        remote_read = repair.get("remote_read") if isinstance(repair.get("remote_read"), dict) else {}
        if not isinstance(commit_sha, str):
            continue
        status, body, error = get("repos/%s/git/commits/%s" % (repo, commit_sha))
        if error or status != 200 or not isinstance(body, dict):
            refuse("remote.repair_unreadable",
                   "%s: commit %s not read back (%s)" % (repair_id, commit_sha, error or status))
            continue
        if body.get("sha") != commit_sha:
            refuse("remote.repair_sha_mismatch",
                   "%s: remote reports %r for %s" % (repair_id, body.get("sha"), commit_sha))
            continue
        tree_sha = (body.get("tree") or {}).get("sha")
        if remote_read.get("tree_sha") != tree_sha:
            refuse("remote.repair_content_mismatch",
                   "%s: remote tree %r, plan claims %r"
                   % (repair_id, tree_sha, remote_read.get("tree_sha")))
            continue
        status, body, error = get(
            "repos/%s/compare/%s...%s" % (repo, commit_sha, target_sha))
        if error or status != 200 or not isinstance(body, dict):
            refuse("remote.repair_unreadable",
                   "%s: containment of %s in %r unreadable (%s)"
                   % (repair_id, commit_sha, target_sha, error or status))
        elif body.get("status") not in ("ahead", "identical"):
            refuse("remote.repair_not_contained",
                   "%s: remote compare %s...%s is %r"
                   % (repair_id, commit_sha, target_sha, body.get("status")))

    return refusals



def order_digest(ordered_candidates):
    """sha256 over the canonical ordered identity of the cohort."""
    payload = [
        {
            "task_id": c["task_id"],
            "head_sha": c["head_sha"],
            "content_digest": c["content_digest"],
            "distribution_order": c["distribution_order"],
        }
        for c in ordered_candidates
    ]
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(blob).hexdigest()


def _result(refusals, ordered, target_owner, required_contexts, repairs_proven,
            remote_state="not-run"):
    refusals = sorted(refusals, key=lambda r: (r["code"], r["detail"]))
    return {
        "verdict": "ACCEPT" if not refusals else "REFUSE",
        "refusals": refusals,
        "order": [c["task_id"] for c in ordered],
        "order_digest": order_digest(ordered) if ordered else None,
        "target_owner": target_owner,
        "required_contexts": required_contexts,
        "repairs_proven": repairs_proven,
        "remote_verification": remote_state,
    }


def evaluate(plan, remote=None):
    """Evaluate one integration plan. Deterministic; the only I/O is read-only.

    `remote`, when given, must expose `get(path) -> (http_status, body)` and is
    used to turn declared remote reads into observed facts. Without it the gate
    validates shape and internal consistency only, and says so in
    `remote_verification`.
    """
    refusals = []
    repairs_proven = []
    required_contexts = []

    def refuse(code, detail):
        refusals.append({"code": code, "detail": detail})

    if not isinstance(plan, dict):
        return _result([{"code": "plan.malformed", "detail": "plan must be a JSON object"}],
                       [], None, [], [])

    # ---- target identity -------------------------------------------------
    if plan.get("repo") != "999":
        refuse("plan.repo_not_999", "repo must be the 999 alias; this gate owns 999 only")
    if plan.get("canonical_remote") != "trevorotts1/999-setup":
        refuse("plan.remote_mismatch",
               "canonical_remote must be trevorotts1/999-setup, got %r" % (plan.get("canonical_remote"),))
    if plan.get("target_branch") != "main":
        refuse("plan.target_not_main", "target_branch must be main")
    if plan.get("force_push_or_deletion") is not False:
        refuse("target.force_or_deletion",
               "force_push_or_deletion must be explicitly false; the 999 server would allow it")

    # ---- single shared target owner --------------------------------------
    owner = plan.get("target_owner")
    holder = None
    if not isinstance(owner, dict):
        refuse("owner.missing", "target_owner is required: remote lease holder and generation")
    else:
        holder = owner.get("holder")
        generation = owner.get("generation")
        if not isinstance(holder, str) or not holder:
            refuse("owner.missing", "target_owner.holder must be a non-empty native agent id")
        if not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
            refuse("owner.missing", "target_owner.generation must be an integer >= 1")
        lease_ref = owner.get("lease_ref")
        if not isinstance(lease_ref, str) or not lease_ref:
            refuse("owner.missing", "target_owner.lease_ref is required (remote ref CAS lock)")
        elif not lease_ref.startswith("refs/"):
            # A ref outside refs/ has no remote read-back: accepting it here
            # would let verify_remote skip the lease proof and still claim it.
            refuse("owner.lease_ref_invalid",
                   "target_owner.lease_ref must be a full refs/... ref, got %r" % (lease_ref,))
        if owner.get("observed_holder") != holder:
            refuse("owner.not_holder",
                   "lease preflight observed %r, plan claims %r"
                   % (owner.get("observed_holder"), holder))
        if owner.get("observed_generation") != generation:
            refuse("owner.generation_mismatch",
                   "lease preflight observed generation %r, plan claims %r"
                   % (owner.get("observed_generation"), generation))
        ttl = owner.get("ttl_seconds")
        if not isinstance(ttl, int) or isinstance(ttl, bool) or ttl <= 0:
            refuse("owner.invalid_ttl", "ttl_seconds must be a positive integer")
        if owner.get("expired") is True:
            refuse("owner.expired_requires_fence",
                   "an expired lease is evidence, never a takeover right: fence the old writer first")
        if not isinstance(owner.get("expired"), bool):
            refuse("owner.missing", "target_owner.expired must be an explicit boolean")
    extra_owners = plan.get("additional_owners")
    if extra_owners is not None and not isinstance(extra_owners, list):
        # A non-list declaration cannot be counted, so it cannot be proven
        # empty: fail closed instead of reading an unparseable owner set as one.
        refuse("owner.multiple",
               "single shared target owner violated: additional_owners must be a list, got %s"
               % type(extra_owners).__name__)
    elif isinstance(extra_owners, list) and extra_owners:
        refuse("owner.multiple",
               "single shared target owner violated: %d additional owner(s) declared" % len(extra_owners))

    # ---- candidates: shape and compatibility -----------------------------
    candidates = plan.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        refuse("cohort.empty", "cohort must contain at least one candidate")
        candidates = []

    wellformed = []
    seen_tasks = set()
    seen_heads = set()
    for index, cand in enumerate(candidates):
        label = "candidates[%d]" % index
        if not isinstance(cand, dict):
            refuse("candidate.malformed", "%s must be an object" % label)
            continue
        task_id = cand.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            refuse("candidate.malformed", "%s.task_id must be a non-empty string" % label)
            continue
        if cand.get("target_owner") is not None and cand.get("target_owner") != holder:
            refuse("owner.candidate_mismatch",
                   "%s names target owner %r, lease holder is %r"
                   % (task_id, cand.get("target_owner"), holder))
        if task_id in seen_tasks:
            refuse("cohort.duplicate_identity", "task_id %r appears twice" % task_id)
            continue
        seen_tasks.add(task_id)
        head_sha = cand.get("head_sha")
        if not _is_sha(head_sha):
            refuse("candidate.malformed", "%s.head_sha must be a 40 or 64 character git SHA" % task_id)
            continue
        if head_sha in seen_heads:
            refuse("cohort.duplicate_identity", "head_sha %s appears twice" % head_sha)
            continue
        seen_heads.add(head_sha)
        if not _is_digest(cand.get("content_digest")):
            refuse("candidate.digest_malformed",
                   "%s.content_digest must be sha256:<64 hex>" % task_id)
            continue
        dist = cand.get("distribution_order")
        if not isinstance(dist, int) or isinstance(dist, bool) or dist < 0:
            refuse("candidate.malformed",
                   "%s.distribution_order must be a non-negative integer" % task_id)
            continue
        files = cand.get("files")
        if not isinstance(files, list) or not all(isinstance(f, str) and f for f in files):
            refuse("candidate.malformed", "%s.files must be a list of paths" % task_id)
            continue
        case = cand.get("compatibility_case")
        if case not in BC_CASES:
            refuse("cohort.unknown_compatibility_case",
                   "%s.compatibility_case %r is not BC-01..BC-08" % (task_id, case))
            continue
        depends_on = cand.get("depends_on", [])
        if not isinstance(depends_on, list) or not all(isinstance(d, str) for d in depends_on):
            refuse("candidate.malformed", "%s.depends_on must be a list of task ids" % task_id)
            continue
        combined = cand.get("combined_members", [])
        if combined is None:
            combined = []
        if not isinstance(combined, list) or not all(isinstance(m, str) for m in combined):
            refuse("candidate.malformed", "%s.combined_members must be a list of task ids" % task_id)
            continue
        cand = dict(cand)
        cand["depends_on"] = depends_on
        cand["combined_members"] = combined
        wellformed.append(cand)

    # Distribution order must be unique and is the only ordering input.
    by_distribution = {}
    for cand in wellformed:
        key = cand["distribution_order"]
        if key in by_distribution:
            refuse("order.duplicate",
                   "distribution_order %d is claimed by %s and %s"
                   % (key, by_distribution[key]["task_id"], cand["task_id"]))
        by_distribution[key] = cand
    ordered = sorted(wellformed, key=lambda c: (c["distribution_order"], c["head_sha"]))

    # ---- shared files and combined candidates (BC-02) --------------------
    file_owners = {}
    for cand in wellformed:
        for path in cand["files"]:
            file_owners.setdefault(path, []).append(cand["task_id"])
    for path in sorted(file_owners):
        owners = file_owners[path]
        if len(owners) < 2:
            continue
        eligible = [
            c for c in wellformed
            if c["task_id"] in owners
            and c.get("combined_members")
            and set(owners) - {c["task_id"]} <= set(c["combined_members"])
        ]
        if len(eligible) == 1:
            continue
        cls = shared_file_class(path) or "shared"
        if len(eligible) > 1:
            refuse("cohort.multiple_combined_owners",
                   "%s file %s has %d competing combined candidates: %s"
                   % (cls, path, len(eligible), sorted(c["task_id"] for c in eligible)))
        else:
            refuse("cohort.shared_file_collision",
                   "%s file %s written by %s; BC-02 requires one combined candidate"
                   % (cls, path, sorted(owners)))

    # ---- dependencies must be ordered or already on main -----------------
    upstream_merged = plan.get("merged_upstream", [])
    if not isinstance(upstream_merged, list):
        refuse("candidate.malformed", "merged_upstream must be a list of task ids")
        upstream_merged = []
    position = {c["task_id"]: i for i, c in enumerate(ordered)}
    for cand in ordered:
        for dep in cand["depends_on"]:
            if dep in position:
                if position[dep] >= position[cand["task_id"]]:
                    refuse("cohort.dependency_unordered",
                           "%s depends on %s, which is not distributed before it"
                           % (cand["task_id"], dep))
            elif dep not in upstream_merged:
                refuse("cohort.dependency_missing",
                       "%s depends on %s, which is neither in the cohort nor merged upstream"
                       % (cand["task_id"], dep))

    # ---- publication edge and parity basis for the vendored tree --------
    edges = plan.get("publication_order_edges", [])
    if not isinstance(edges, list):
        refuse("order.edge_unknown", "publication_order_edges must be a list")
        edges = []
    for edge in edges:
        if edge not in ALLOWED_EDGES:
            refuse("order.edge_unknown", "unknown publication order edge %r" % (edge,))
    for cand in ordered:
        touches_tree = any(p.startswith(VENDORED_PREFIX) for p in cand["files"])
        if not touches_tree:
            continue
        if "onboarding->999" not in edges:
            refuse("order.edge_missing",
                   "%s writes the vendored skill tree but the onboarding->999 edge is not declared"
                   % cand["task_id"])
        if cand.get("parity_basis") != "pack-classification":
            refuse("hash.parity_whole_tree",
                   "%s writes the vendored skill tree; parity must be PACK.md classification, "
                   "never whole-tree byte equality (got %r)"
                   % (cand["task_id"], cand.get("parity_basis")))

    # ---- explicit hash order --------------------------------------------
    if ordered:
        computed = order_digest(ordered)
        declared_digest = plan.get("order_digest")
        if declared_digest is not None and declared_digest != computed:
            refuse("order.digest_mismatch",
                   "declared order_digest %r != computed %s" % (declared_digest, computed))
        declared_hash_order = plan.get("hash_order")
        if declared_hash_order is not None:
            actual = [c["content_digest"] for c in ordered]
            if declared_hash_order != actual:
                refuse("order.hash_order_mismatch",
                       "declared hash_order does not match the distribution order's content digests")

    # ---- required checks -------------------------------------------------
    surface = plan.get("check_surface")
    if not isinstance(surface, dict):
        refuse("checks.surface_unproven",
               "check_surface is required: a remote api read of protection and required contexts")
    else:
        contexts = surface.get("required_contexts")
        protected = surface.get("protection_observed")
        if surface.get("source") != "remote-api-read" \
                or not isinstance(surface.get("observed_at"), str) \
                or not surface.get("observed_at"):
            refuse("checks.surface_unproven",
                   "check_surface must come from a remote api read with an observed_at timestamp")
        if not isinstance(protected, bool):
            refuse("checks.surface_unproven", "check_surface.protection_observed must be a boolean")
        if not isinstance(contexts, list) or not all(isinstance(c, str) and c for c in contexts):
            refuse("checks.surface_unproven",
                   "check_surface.required_contexts must be a list of context names")
        else:
            required_contexts = contexts
            if protected is True and not contexts:
                refuse("checks.empty_with_protection",
                       "protection reports true with zero required contexts: that enforces nothing")

    cohort_head = plan.get("cohort_head_sha")
    if not _is_sha(cohort_head):
        refuse("checks.no_head", "cohort_head_sha is required: the exact head the checks ran on")
    receipts = plan.get("check_receipts", [])
    if not isinstance(receipts, list):
        refuse("checks.missing", "check_receipts must be a list")
        receipts = []
    for context in required_contexts:
        matching = [r for r in receipts
                    if isinstance(r, dict) and r.get("context") == context]
        if not matching:
            refuse("checks.missing", "required context %r has no receipt" % context)
            continue
        at_head = [r for r in matching if r.get("head_sha") == cohort_head]
        if not at_head:
            refuse("checks.head_stale",
                   "required context %r has no receipt on cohort head %s (stale evidence)"
                   % (context, cohort_head))
            continue
        latest = max(at_head, key=lambda r: r.get("run_id") if isinstance(r.get("run_id"), int) else 0)
        if latest.get("conclusion") != "success":
            refuse("checks.not_success",
                   "required context %r concluded %r on %s"
                   % (context, latest.get("conclusion"), cohort_head))

    # ---- target and proof method ----------------------------------------
    target_sha_after = plan.get("target_sha_after")
    if plan.get("target_sha_source") != "remote":
        refuse("target.remote_proof_missing",
               "target_sha_after must be read back from the remote (target_sha_source=remote)")
    if not _is_sha(target_sha_after):
        refuse("target.remote_proof_missing", "target_sha_after must be a git SHA read from the remote")
    merge_method = plan.get("merge_method")
    proof_method = plan.get("proof_method")
    if merge_method not in MERGE_METHODS:
        refuse("proof.method_mismatch", "merge_method must be one of %s" % sorted(MERGE_METHODS))
    elif proof_method not in PROOF_METHODS:
        refuse("proof.method_mismatch", "proof_method must be one of %s" % sorted(PROOF_METHODS))
    elif merge_method == "merge" and proof_method != "ancestry":
        refuse("proof.method_mismatch", "a merge commit is proven by ancestry")
    elif merge_method in ("squash", "rebase") and proof_method == "ancestry":
        refuse("proof.method_mismatch",
               "%s rewrites commits: ancestry would be a false proof; use tree_equality or "
               "content_equivalence" % merge_method)

    # ---- named repairs (BC-08) ------------------------------------------
    repairs = plan.get("repairs", [])
    if not isinstance(repairs, list):
        refuse("repair.remote_proof_missing", "repairs must be a list")
        repairs = []
    baseline_commit = plan.get("baseline_commit")
    seen_repair_ids = set()
    seen_repair_shas = set()
    for index, repair in enumerate(repairs):
        label = "repairs[%d]" % index
        if not isinstance(repair, dict):
            refuse("repair.remote_proof_missing", "%s must be an object" % label)
            continue
        repair_id = repair.get("repair_id")
        if not isinstance(repair_id, str) or not repair_id:
            refuse("repair.remote_proof_missing", "%s.repair_id is required" % label)
            continue
        if repair_id in seen_repair_ids:
            refuse("repair.duplicate", "repair_id %r appears twice" % repair_id)
            continue
        seen_repair_ids.add(repair_id)
        commit_sha = repair.get("commit_sha")
        if not _is_sha(commit_sha):
            refuse("repair.remote_proof_missing", "%s.commit_sha must be a git SHA" % repair_id)
            continue
        if commit_sha in seen_repair_shas:
            refuse("repair.duplicate", "repair commit %s appears twice" % commit_sha)
            continue
        seen_repair_shas.add(commit_sha)
        if commit_sha == baseline_commit or repair.get("proof") == "baseline":
            refuse("repair.baseline_only",
                   "%s is proven only by the baseline merge; BC-08 owes its own remote proof"
                   % repair_id)
            continue
        if not _is_digest(repair.get("content_digest")):
            refuse("repair.remote_proof_missing",
                   "%s.content_digest must be sha256:<64 hex>" % repair_id)
            continue
        remote_read = repair.get("remote_read")
        if not isinstance(remote_read, dict):
            refuse("repair.remote_proof_missing",
                   "%s has no remote_read: local ancestry is not remote content proof" % repair_id)
            continue
        if remote_read.get("source") != "remote":
            refuse("repair.remote_proof_not_remote",
                   "%s.remote_read.source must be 'remote'" % repair_id)
            continue
        if not isinstance(remote_read.get("observed_at"), str) or not remote_read.get("observed_at"):
            refuse("repair.remote_proof_missing",
                   "%s.remote_read.observed_at is required" % repair_id)
            continue
        if remote_read.get("sha") != commit_sha:
            refuse("repair.sha_mismatch",
                   "%s: remote reports %r, plan claims %s"
                   % (repair_id, remote_read.get("sha"), commit_sha))
            continue
        if remote_read.get("content_digest") != repair.get("content_digest"):
            refuse("repair.content_mismatch",
                   "%s: remote content digest %r != declared %r"
                   % (repair_id, remote_read.get("content_digest"), repair.get("content_digest")))
            continue
        if remote_read.get("contained_in") != target_sha_after:
            refuse("repair.not_contained",
                   "%s: remote containment %r is not the read-back target %r"
                   % (repair_id, remote_read.get("contained_in"), target_sha_after))
            continue
        repairs_proven.append(repair_id)

    remote_state = "not-run"
    if remote is not None:
        remote_state = "read-only-remote-api"
        refusals.extend(verify_remote(plan, remote))

    return _result(refusals, ordered, ("%s@%s" % (holder, owner.get("generation")) if holder else None),
                   required_contexts, repairs_proven, remote_state)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    verify = False
    if argv and argv[0] == "--verify-remote":
        verify = True
        argv = argv[1:]
    if len(argv) != 1:
        sys.stderr.write("usage: cohort_integration.py [--verify-remote] <plan.json>\n")
        return 2
    try:
        with open(argv[0], "r", encoding="utf-8") as handle:
            plan = json.load(handle)
    except (OSError, ValueError) as exc:
        json.dump({"verdict": "ERROR", "detail": str(exc)}, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 2
    remote = None
    repo = plan.get("canonical_remote") if isinstance(plan, dict) else None
    if verify and isinstance(repo, str) and repo:
        remote = GhRemote(repo)
    result = evaluate(plan, remote)
    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0 if result["verdict"] == "ACCEPT" else 1


if __name__ == "__main__":
    raise SystemExit(main())
