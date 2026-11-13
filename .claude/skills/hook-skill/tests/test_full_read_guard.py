#!/usr/bin/env python3
"""Tests for the full-read guard (hook, read-skill, manifest). Stdlib only: python3 test_full_read_guard.py
Everything runs in a throwaway folder; no real ~/.claude or ~/.claude-nine is read or written."""
import json, os, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
FRG = os.path.join(SKILL, "hooks", "full-read-guard")
FIX = os.path.join(HERE, "fixtures", "frg")
sys.path.insert(0, FRG)


def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class Base(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="frg-test."))
        sk = os.path.join(self.root, "skills")
        w(sk + "/alpha/SKILL.md", "---\nname: alpha\ndepends_on: [beta]\n---\nAlpha steps\n")
        w(sk + "/alpha/references/rules.md", "rule one\nrule two\n")
        w(sk + "/alpha/references/models.md", "model catalog\n")
        w(sk + "/alpha/scripts/run.py", "print('hi')\n")
        w(sk + "/alpha/data/notes.md", "search me\n")
        w(sk + "/beta/SKILL.md", "---\nname: beta\n---\nBeta body\n")
        w(sk + "/gamma/SKILL.md", "Gamma\n")
        w(sk + "/gamma/scripts/go.sh", "echo go\n")
        w(sk + "/universal-sops/SOP-ONE.md", "sop line 1\nsop line 2\n")
        os.makedirs(self.root + "/manifest.d")
        json.dump({"skills": [
            {"skill": "alpha", "depends_on": ["beta", "universal-sops/SOP-ONE.md"],
             "lookup": ["references/models.md", "data/**"]}]}, open(self.root + "/manifest.d/t.json", "w"))
        self.env = dict(os.environ, FRG_SKILLS_ROOTS=sk, FRG_STATE_DIR=self.root + "/state",
                        FRG_MANIFEST_DIR=self.root + "/manifest.d", FRG_MODE="enforce")
        self.env.pop("FRG_PART_CHARS", None)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def hook(self, payload, event="PreToolUse", sid="s1", env=None):
        if isinstance(payload, str):
            payload = json.loads(open(os.path.join(FIX, payload)).read().replace("{ROOT}", self.root))
        payload.update({"hook_event_name": event, "session_id": sid})
        p = subprocess.run([sys.executable, os.path.join(FRG, "frg_hook.py")], input=json.dumps(payload),
                           capture_output=True, text=True, env=env or self.env, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)["hookSpecificOutput"] if p.stdout.strip() else None

    def pre(self, tool, ti, sid="s1", env=None):
        return self.hook({"tool_name": tool, "tool_input": ti, "cwd": self.root}, "PreToolUse", sid, env)

    def bash(self, cmd, sid="s1", env=None):
        return self.pre("Bash", {"command": cmd}, sid, env)

    def blocked(self, r):
        return bool(r) and r.get("permissionDecision") == "deny"

    def read_skill(self, *a, env=None):
        return subprocess.run([sys.executable, os.path.join(FRG, "read_skill.py"), *a], capture_output=True, text=True,
                              env=env or self.env, timeout=30)


class Classify(Base):
    def test_classes(self):
        os.environ.update(self.env)
        import importlib, frg_core as C
        importlib.reload(C)
        C.load_manifest(force=True)
        S = self.root + "/skills/"
        cls = lambda p: C.classify(S + p)["cls"]
        self.assertEqual(cls("alpha/SKILL.md"), "instruction")
        self.assertEqual(cls("alpha/references/rules.md"), "open")  # step folder: whole when opened, not required up front
        self.assertEqual(cls("alpha/INSTALL.md"), "open") if os.path.exists(S + "alpha/INSTALL.md") else None
        self.assertEqual(cls("alpha/references/models.md"), "lookup")
        self.assertEqual(cls("alpha/data/notes.md"), "lookup")
        self.assertEqual(cls("alpha/scripts/run.py"), "lookup")  # not a markdown document
        self.assertEqual(cls("universal-sops/SOP-ONE.md"), "instruction")
        w(S + "alpha/INSTRUCTIONS.md", "x\n")
        w(S + "alpha/INSTALL.md", "x\n")
        w(S + "alpha/prompts/p1.md", "x\n")
        self.assertEqual(cls("alpha/INSTRUCTIONS.md"), "instruction")
        self.assertEqual(cls("alpha/INSTALL.md"), "open")
        self.assertEqual(cls("alpha/prompts/p1.md"), "open")
        self.assertIsNone(C.classify(self.root + "/outside.md"))

    def test_skill_md_never_lookup_even_if_manifest_says_so(self):
        json.dump({"skills": [{"skill": "gamma", "lookup": ["**", "SKILL.md"]}]}, open(self.root + "/manifest.d/g.json", "w"))
        os.environ.update(self.env)
        import importlib, frg_core as C
        importlib.reload(C)
        C.load_manifest(force=True)
        self.assertEqual(C.classify(self.root + "/skills/gamma/SKILL.md")["cls"], "instruction")

    def test_shipped_manifest_never_lists_an_instruction_name(self):
        import frg_core as C
        doc = json.load(open(os.path.join(FRG, "manifest.d", "999.json")))
        self.assertTrue(doc["skills"])
        for e in doc["skills"]:
            for g in e.get("lookup", []):
                base = g.rsplit("/", 1)[-1].lower()
                self.assertNotIn(base, C.HARD_NAMES - {"readme.md"}, (e["skill"], g))
                self.assertFalse(base.endswith("-full.md"), (e["skill"], g))
                if "*" not in g:
                    self.assertFalse(g.lower() == "readme.md", e["skill"])

    def test_shipped_manifest_is_current(self):
        repo = os.path.abspath(os.path.join(SKILL, "..", "..", ".."))
        if not os.path.isdir(os.path.join(repo, ".claude", "skills")):
            self.skipTest("not inside the repository tree")
        p = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "common", "build_frg_manifest.py"), "--repo", repo, "--check"])
        self.assertEqual(p.returncode, 0, "manifest.d/999.json is stale: run scripts/common/build_frg_manifest.py")

    def test_upfront_set_stays_small_for_every_shipped_skill(self):
        repo = os.path.abspath(os.path.join(SKILL, "..", "..", ".."))
        base = os.path.join(repo, ".claude", "skills")
        if not os.path.isdir(base):
            self.skipTest("not inside the repository tree")
        env = dict(os.environ, FRG_SKILLS_ROOTS=base, FRG_STATE_DIR=self.root + "/state")
        code = ("import sys,os,json; sys.path.insert(0, %r); import frg_core as C\n"
                "out={}\n"
                "for sid,lex,real in C.skill_entries():\n"
                "    cl,_=C.closure(sid,real); out[sid]=sum(os.path.getsize(f) for f in cl)\n"
                "print(json.dumps(out))" % FRG)
        sizes = json.loads(subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env).stdout)
        self.assertTrue(sizes)
        for sid, n in sizes.items():
            self.assertLess(n, 150 * 1024, "%s needs %d bytes read up front" % (sid, n))

    def test_shipped_manifest_deps_and_globs_resolve(self):
        repo = os.path.abspath(os.path.join(SKILL, "..", "..", ".."))
        if not os.path.isdir(os.path.join(repo, ".claude", "skills")):
            self.skipTest("not inside the repository tree")
        sys.path.insert(0, os.path.join(SKILL, "scripts", "common"))
        import build_frg_manifest as B
        src = B.sources(repo)
        doc = json.load(open(os.path.join(FRG, "manifest.d", "999.json")))
        for e in doc["skills"]:
            self.assertIn(e["skill"], src)
            for d in e["depends_on"]:
                if d.startswith("universal-sops/"):
                    self.assertTrue(os.path.isfile(os.path.join(repo, d)), d)
                else:
                    self.assertIn(d, src, (e["skill"], d))
                    self.assertNotEqual(d, e["skill"])


class HookRules(Base):
    def test_partial_read_denied_whole_read_allowed(self):
        self.assertTrue(self.blocked(self.hook("pre_read_partial.json")))
        self.assertIsNone(self.hook("pre_read_whole.json"))

    def test_read_on_open_files_need_whole_read_but_not_up_front(self):
        S = self.root + "/skills/alpha/"
        w(S + "prompts/p1.md", "step one\nstep two\n")
        self.assertTrue(self.blocked(self.pre("Read", {"file_path": S + "prompts/p1.md", "limit": 1})))
        self.assertIsNone(self.pre("Read", {"file_path": S + "prompts/p1.md"}))
        self.assertTrue(self.blocked(self.bash("grep -n step %sprompts/p1.md" % S, sid="oo1")))
        self.assertTrue(self.blocked(self.bash("head -1 %sreferences/rules.md" % S, sid="oo2")))
        self.assertTrue(self.blocked(self.pre("Grep", {"pattern": "step", "path": S + "prompts"})))
        # not required before acting, and read-skill does not print it but names the folder
        run = "python3 %sscripts/run.py" % S
        for f in ("alpha/SKILL.md", "beta/SKILL.md", "universal-sops/SOP-ONE.md"):
            self.hook({"tool_name": "Read", "tool_input": {"file_path": self.root + "/skills/" + f}, "cwd": self.root}, "PostToolUse", "oo")
        self.assertFalse(self.blocked(self.bash(run, sid="oo")))
        out = self.read_skill("alpha").stdout
        self.assertNotIn("step one", out)
        self.assertIn("READ-ON-OPEN", out)
        self.assertIn("prompts/", out)

    def test_partial_read_of_lookup_allowed(self):
        self.assertIsNone(self.pre("Read", {"file_path": self.root + "/skills/alpha/data/notes.md", "limit": 1}))
        self.assertIsNone(self.pre("Read", {"file_path": self.root + "/skills/alpha/scripts/run.py", "offset": 1, "limit": 1}))

    def test_read_outside_skills_untouched(self):
        w(self.root + "/other/NOTES.md", "x\n")
        self.assertIsNone(self.pre("Read", {"file_path": self.root + "/other/NOTES.md", "limit": 1}))

    def test_grep_instruction_dir_denied_lookup_allowed(self):
        self.assertTrue(self.blocked(self.hook("pre_grep_skill.json")))
        self.assertIsNone(self.hook("pre_grep_lookup.json"))
        self.assertTrue(self.blocked(self.pre("Grep", {"pattern": "x", "path": self.root + "/skills/alpha/SKILL.md"})))
        self.assertIsNone(self.pre("Grep", {"pattern": "x", "path": self.root + "/skills/alpha", "glob": "*.py"}))
        self.assertIsNone(self.pre("Grep", {"pattern": "x", "path": self.root + "/skills"}))  # cross-skill discovery
        self.assertIsNone(self.pre("Grep", {"pattern": "x", "path": self.root + "/skills/alpha/scripts/run.py"}))

    def test_block_reason_points_to_read_skill(self):
        r = self.hook("pre_bash_head.json")
        self.assertTrue(self.blocked(r))
        self.assertIn("read-skill", r["permissionDecisionReason"])
        self.assertIn("alpha", r["permissionDecisionReason"])

    def test_shell_table(self):
        S = self.root + "/skills/alpha/"
        blocked = [
            "head -20 %sSKILL.md" % S, "tail -5 %sSKILL.md" % S, "sed -n '1,10p' %sSKILL.md" % S,
            "sed -n 5p %sSKILL.md" % S, "grep -n step %sSKILL.md" % S, "grep -rn rule %sreferences/rules.md" % S,
            "rg step %s" % S.rstrip("/"), "grep -r step %s" % S.rstrip("/"), "awk 'NR<5' %sSKILL.md" % S,
            "cut -c1-40 %sSKILL.md" % S, "cat %sSKILL.md | head -5" % S, "cat %sSKILL.md | grep step" % S,
            "head -3 < %sSKILL.md" % S, "less %sSKILL.md" % S, "cd %s && head SKILL.md" % S.rstrip("/"),
            "echo hi; head -2 %sSKILL.md" % S, "ls && grep x %sSKILL.md" % S, "grep x %s*.md" % S,
            "python3 -c \"print(open('%sSKILL.md').read()[:50])\"" % S,
            "grep -n a %suniversal-sops/SOP-ONE.md" % (self.root + "/skills/"),
            "xxd %sSKILL.md" % S, "tail -n +3 %sSKILL.md" % S, "sed -n 2p %sreferences/rules.md" % S,
            "(head -2 %sSKILL.md)" % S, "$(head -2 %sSKILL.md)" % S, "FOO=1 head -2 %sSKILL.md" % S,
            "egrep 'a|b' %sSKILL.md" % S, "fgrep a %sSKILL.md" % S, "grep a ~/../%s" % S.lstrip("/") if False else "grep a %sSKILL.md" % S,
        ]
        allowed = [
            "cat %sSKILL.md" % S, "wc -l %sSKILL.md" % S, "ls %s" % S, "stat %sSKILL.md" % S, "file %sSKILL.md" % S,
            "sha256sum %sSKILL.md" % S, "head -5 %sdata/notes.md" % S, "grep step %sdata/notes.md" % S,
            "tail -3 %sscripts/run.py" % S, "grep -rn print %sscripts" % S, "sed -n 1,3p %sreferences/models.md" % S,
            "head -3 %sreferences/models.md" % S, "grep -r x %s" % (self.root + "/skills"), "head -3 %s/other.md" % self.root,
            "echo head %sSKILL.md" % S, "git -C %s status" % S, "sed -i s/a/b/ /nonexistent", "ls | head -3",
            "cat %sdata/notes.md | head -1" % S, "grep step %sSKILL.md.nothere" % S, "echo 'grep x SKILL.md'",
            "python3 -c 'print(1)'", "find %s -name '*.py'" % S,
        ]
        for c in blocked:
            self.assertTrue(self.blocked(self.bash(c, sid="tb-" + str(abs(hash(c))))), "should block: " + c)
        for c in allowed:
            self.assertFalse(self.blocked(self.bash(c, sid="ta-" + str(abs(hash(c))))), "should allow: " + c)

    def test_act_before_read_then_read_skill_unlocks(self):
        run = "python3 %sskills/alpha/scripts/run.py" % (self.root + "/")
        r = self.bash(run, sid="act")
        self.assertTrue(self.blocked(r))
        self.assertIn("read-skill", r["permissionDecisionReason"])
        p = self.read_skill("alpha")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Alpha steps", p.stdout)
        self.assertIn("Beta body", p.stdout)
        self.assertIn("sop line 2", p.stdout)
        self.assertNotIn("model catalog", p.stdout)  # lookup is not printed
        self.hook({"tool_name": "Bash", "tool_input": {"command": "read-skill alpha"}, "cwd": self.root,
                   "tool_response": {"stdout": p.stdout}}, "PostToolUse", "act")
        self.assertFalse(self.blocked(self.bash(run, sid="act")))
        # a different session has no receipt
        self.assertTrue(self.blocked(self.bash(run, sid="other")))

    def test_dependency_gap_blocks_until_deps_read(self):
        run = "python3 %s/skills/alpha/scripts/run.py" % self.root
        for f in ("alpha/SKILL.md",):  # the skill alone, normal whole reads
            self.hook({"tool_name": "Read", "tool_input": {"file_path": self.root + "/skills/" + f}, "cwd": self.root}, "PostToolUse", "dep")
        self.assertTrue(self.blocked(self.bash(run, sid="dep")))  # beta and the SOP are still unread
        for f in ("beta/SKILL.md", "universal-sops/SOP-ONE.md"):
            self.hook({"tool_name": "Read", "tool_input": {"file_path": self.root + "/skills/" + f}, "cwd": self.root}, "PostToolUse", "dep")
        self.assertFalse(self.blocked(self.bash(run, sid="dep")))

    def test_no_transitive_dependency(self):
        w(self.root + "/skills/beta/references/deep.md", "deep\n")  # beta is a dependency; its own reads are its own
        json.dump({"skills": [{"skill": "alpha", "depends_on": ["beta"]}, {"skill": "beta", "depends_on": ["gamma"]}]},
                  open(self.root + "/manifest.d/t.json", "w"))
        p = self.read_skill("alpha")
        self.assertIn("Beta body", p.stdout)   # a dependency's SKILL.md is read in full
        self.assertNotIn("deep", p.stdout)     # its step folders are read-on-open
        self.assertNotIn("Gamma", p.stdout)    # and ITS dependency is not pulled in

    def test_partial_receipt_does_not_unlock(self):
        env = dict(self.env, FRG_PART_CHARS="120")
        p1 = self.read_skill("alpha", env=env)
        self.assertIn("part 1 of", p1.stdout)
        run = "python3 %s/skills/alpha/scripts/run.py" % self.root
        self.hook({"tool_name": "Bash", "tool_input": {"command": "read-skill alpha"}, "cwd": self.root, "tool_response": {"stdout": p1.stdout}}, "PostToolUse", "part")
        self.assertTrue(self.blocked(self.bash(run, sid="part", env=env)))

    def test_edit_in_skill_needs_receipt(self):
        r = self.pre("Edit", {"file_path": self.root + "/skills/gamma/scripts/go.sh", "old_string": "a", "new_string": "b"}, sid="ed")
        self.assertTrue(self.blocked(r))
        self.hook({"tool_name": "Read", "tool_input": {"file_path": self.root + "/skills/gamma/SKILL.md"}, "cwd": self.root}, "PostToolUse", "ed")
        self.assertIsNone(self.pre("Edit", {"file_path": self.root + "/skills/gamma/scripts/go.sh", "old_string": "a", "new_string": "b"}, sid="ed"))

    def test_changed_file_makes_receipt_stale(self):
        gp = self.root + "/skills/gamma/SKILL.md"
        self.hook({"tool_name": "Read", "tool_input": {"file_path": gp}, "cwd": self.root}, "PostToolUse", "st")
        run = "bash %s/skills/gamma/scripts/go.sh" % self.root
        self.assertFalse(self.blocked(self.bash(run, sid="st")))
        w(gp, "Gamma changed\n")
        self.assertTrue(self.blocked(self.bash(run, sid="st")))

    def test_skill_tool_marks_in_use_and_counts_skill_md(self):
        self.assertIsNone(self.hook("pre_skill.json"))
        run = "python3 %s/skills/gamma/scripts/go.sh" % self.root
        self.hook({"tool_name": "Skill", "tool_input": {"skill": "gamma"}, "cwd": self.root}, "PreToolUse", "sk")
        self.assertFalse(self.blocked(self.bash(run, sid="sk")))

    def test_compaction_resets_receipts(self):
        run = "bash %s/skills/gamma/scripts/go.sh" % self.root
        self.hook({"tool_name": "Read", "tool_input": {"file_path": self.root + "/skills/gamma/SKILL.md"}, "cwd": self.root}, "PostToolUse", "cp")
        self.assertFalse(self.blocked(self.bash(run, sid="cp")))
        self.hook({}, "PreCompact", "cp")
        self.assertTrue(self.blocked(self.bash(run, sid="cp")))
        self.hook({"tool_name": "Read", "tool_input": {"file_path": self.root + "/skills/gamma/SKILL.md"}, "cwd": self.root}, "PostToolUse", "cp")
        self.hook({"source": "compact"}, "SessionStart", "cp")
        self.assertTrue(self.blocked(self.bash(run, sid="cp")))

    def test_loop_breaker_allows_and_logs_third_repeat(self):
        c = "head -3 %s/skills/alpha/SKILL.md" % self.root
        res = [self.blocked(self.bash(c, sid="lb")) for _ in range(5)]
        self.assertEqual(res, [True, True, True, False, False])
        self.assertIn("loop-breaker", open(self.root + "/state/frg.log").read())
        # a different call is still blocked
        self.assertTrue(self.blocked(self.bash(c + " ", sid="lb2")))

    def test_modes(self):
        c = "head -3 %s/skills/alpha/SKILL.md" % self.root
        self.assertFalse(self.blocked(self.bash(c, env=dict(self.env, FRG_MODE="off"))))
        self.assertFalse(self.blocked(self.bash(c, env=dict(self.env, FRG_MODE="audit"))))
        self.assertIn("would-block", open(self.root + "/state/frg.log").read())
        self.assertTrue(self.blocked(self.bash(c)))

    def test_fails_open_on_garbage(self):
        for raw in ("", "not json", "[]", '{"hook_event_name":"PreToolUse"}'):
            p = subprocess.run([sys.executable, os.path.join(FRG, "frg_hook.py")], input=raw, capture_output=True, text=True, env=self.env)
            self.assertEqual(p.returncode, 0)
            self.assertEqual(p.stdout.strip(), "")


class ReadSkill(Base):
    def test_parts_concatenate_to_source(self):
        big = "".join("line %d of a long instruction file\n" % i for i in range(400))
        w(self.root + "/skills/alpha/INSTRUCTIONS.md", big)
        env = dict(self.env, FRG_PART_CHARS="1500")
        first = self.read_skill("alpha", env=env)
        import re
        n = int(re.search(r"part 1 of (\d+)", first.stdout).group(1))
        self.assertGreater(n, 3)
        text = first.stdout
        for i in range(2, n + 1):
            text += self.read_skill("alpha", "--part", str(i), env=env).stdout
        for i in range(400):
            self.assertIn("line %d of a long instruction file\n" % i, "".join(
                x.split("----- BEGIN PART", 1)[-1] for x in [text]))
        self.assertEqual(len(re.findall(r"FRG-RECEIPT [0-9a-f]{16} \d+/%d" % n, text)), n)

    def test_unknown_skill_lists_valid_names(self):
        p = self.read_skill("nope")
        self.assertEqual(p.returncode, 2)
        self.assertIn("alpha", p.stderr)

    def test_order_skill_md_first_and_numbered_alias(self):
        shutil.copytree(self.root + "/skills/gamma", self.root + "/skills/07-delta")
        p = self.read_skill("delta")
        self.assertEqual(p.returncode, 0)
        p2 = self.read_skill("07")
        self.assertEqual(p2.returncode, 0)
        out = self.read_skill("alpha").stdout
        self.assertLess(out.index("Alpha steps"), out.index("Beta body"))
        self.assertLess(out.index("Beta body"), out.index("sop line 1"))
        self.assertNotIn("rule one", out)  # references/ is read-on-open

    def test_sop_file_target(self):
        p = self.read_skill("universal-sops/SOP-ONE.md")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("sop line 2", p.stdout)

    def test_wrapper_script_runs(self):
        p = subprocess.run([os.path.join(FRG, "read-skill"), "gamma"], capture_output=True, text=True, env=self.env)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Gamma", p.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
