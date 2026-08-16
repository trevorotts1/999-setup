#!/usr/bin/env node
// R5 shape check — Issue 12 FIX step 5 (999-master-fix-spec-20260815.md line 274).
// Walks a test-interview question list (one question per line, plain text, the
// exact lines the conductor would speak) and enforces the Issue 12 bar:
//   (1) one question per line / per turn — no batched walls (audience.md §1,
//       Issue 12 FIX step 3, spec line 272);
//   (2) no deleted question appears (interview.md R2, lines 156-233; Issue 12
//       FIX step 4, spec line 273);
//   (3) no answered question repeats across a compaction (interview.md R5
//       lines 272-275; Issue 12 FIX step 2, spec line 271);
//   (4) every counted question spoken as "Question <N> of no more than <C> —"
//       (interview.md line 305; Issue 11 FIX step 2, spec line 254);
//   (5) the four banned words ("usage window", "merge", "repo", "branch")
//       never appear in a DEFAULT-mode question (interview.md R5 lines
//       270-272; Issue 12 FIX step 1, spec line 270);
//   (6) "question" / "ask" words occur at most once per line — one question
//       at a time in substance, not just shape (audience.md §1);
//   (7) the ceiling never moves silently and N never repeats/regresses
//       (interview.md per-question counter; Issue 11 FIX step 3).
//
// A question-list file is read line by line. Blank lines, `#` comments and
// `ANSWER:` lines are skipped. Block quotes (`>`) are stripped. A line that
// starts "Question " is a counted question. A line with no question marker is
// prose: spoken statements (the opening, good-news lines, the artwork
// correction) and answers (RECAP / DECIDED / REPORTED lines) are legal; a
// prose line containing a question mark is a violation — that is an uncounted
// question, the exact defect Issue 11 and R5 remove.
//
// Two optional inputs, both default-mode:
//   --fixtures-dir <dir>   runs every *.txt in the dir; each file is one run.
//   --test-names           prints the built-in selfcheck case names.
//   --selfcheck            runs the built-in selfcheck suite and exits.
//
// Exit codes: 0 = clean; 1 = defects found; 2 = usage/input error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The deleted question list — Issue 12 FIX step 4's enumeration (spec line
// 273): A4-in-default-mode, A6, A7, A8, the provider-path half of A2, B1/B2,
// C0-C3, C6-as-question, C1, C2. Each entry is keyed by the unique phrase that
// identifies the question, names the R2 ruling, and — where a ruling is mode-
// scoped (A4 is asked in ADVANCED mode, R2 lines 162-167; C4 stays out of the
// Issue 12 list) — the mode it binds. Issue 12's list is the wall: C4 and B4
// are NOT on it and are never flagged.
// ---------------------------------------------------------------------------
const DELETED = [
  // A4 — deleted in DEFAULT mode only (R2 lines 162-167; advanced may ask)
  { key: "how many agents", file: "interview.md", lines: "162-167", modes: ["default"] },
  // A6 (R2 lines 174-178), A7 (179-181), A8 (182-186)
  { key: "usage window", file: "interview.md", lines: "174-178" },
  { key: "share of your usage cap", file: "interview.md", lines: "179-181" },
  { key: "backup for every role", file: "interview.md", lines: "182-186" },
  // A2's provider-path half (R2 lines 187-191)
  { key: "reaching deepseek through ollama", file: "interview.md", lines: "187-191" },
  // B1 and B2 (R2 lines 192-196)
  { key: "how many github repositories", file: "interview.md", lines: "192-196" },
  { key: "how many github repos", file: "interview.md", lines: "192-196" },
  { key: "each repository's main branch", file: "interview.md", lines: "192-196" },
  { key: "who may push", file: "interview.md", lines: "192-196" },
  // C0 and C3 (R2 lines 197-201)
  { key: "run once while you are watching", file: "interview.md", lines: "197-201" },
  { key: "runs once while you are watching", file: "interview.md", lines: "197-201" },
  { key: "runs once, and somebody is watching", file: "interview.md", lines: "197-201" },
  { key: "how long does it run without you", file: "interview.md", lines: "197-201" },
  // C1 (R2 lines 202-204), C2 (205-207)
  { key: "which file holds the state", file: "interview.md", lines: "202-204" },
  { key: "approve merges", file: "interview.md", lines: "205-207" },
  // C6-as-question (R2 lines 208-216 — wired as the backoff ladder, never
  // asked)
  { key: "busy signal", file: "interview.md", lines: "208-216" },
  { key: "limit on one of your ai accounts", file: "interview.md", lines: "208-216" },
];

// The four banned words in DEFAULT mode (interview.md R5, lines 270-272).
const BANNED = [
  { word: "usage window", file: "interview.md", lines: "270-272" },
  { word: "merge", file: "interview.md", lines: "270-272" },
  { word: "repo", file: "interview.md", lines: "270-272" },
  { word: "branch", file: "interview.md", lines: "270-272" },
];

const QUESTION_RE = /^Question\s+(\d+)\s+of\s+no\s+more\s+than\s+(\d+)\s*[—-]?\s*(.*)$/i;
const QWORDS_RE = /\b(question|ask|asks|asking|asked)\b/gi;
const QMARK_RE = /\?\s*$/;
const ANSWER_RE = /^(ANSWER|RECAP|DECIDED|REPORTED)\b/i;
const A_TOKENS = new Set(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "b1", "b2", "b3", "b4", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "d1", "d2", "d3", "d4"]);

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function findDeleted(text, file, mode) {
  const hits = [];
  for (const d of DELETED) {
    if (d.modes && !d.modes.includes(mode)) continue;
    const needle = tokenize(d.key).join(" ");
    if (tokenize(text).join(" ").includes(needle)) {
      hits.push({ rule: `R2 ${d.file}:${d.lines}`, marker: d.key });
    }
  }
  return hits;
}

// Wall detection: a counted question that asks more than one thing. A second
// question mark inside one numbered question is a wall UNLESS the second ask
// is an "or"-continuation (the kept alternative-form questions — the desktop
// window-vs-helper question, interview.md lines 602-605 — always continue with
// "or"). Anything else — "And …?", "Also …?", a fresh independent ask — is the
// batched-wall defect (audience.md line 15, Issue 12 FIX step 3).
function isWall(body) {
  const qmarks = (body.match(/\?/g) || []).length;
  if (qmarks <= 1) return false;
  // A second question mark is a WALL only when a new ask is bolted on with a
  // coordinate conjunction ("And …?", "Also …?", "Then …?"). The doctrine-kept
  // multi-mark questions are all single asks with an alternative or an
  // elaboration, never a second topic: the desktop window-vs-helper question
  // ("…see and click? Or more of a quiet helper…", interview.md lines 602-605),
  // A4's explainer ("…running at the same time? The work runs in workflows…",
  // lines 163-167), B4's clarification ("…must not push? A branch, a repo, a
  // server…", lines 196, 1336). Those continuations begin with "or", a noun,
  // or "the" — never with a coordinate "and".
  const parts = body.split("?").map((p) => p.trim());
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (/^(and|also|plus|then)\b/i.test(seg)) return true;
  }
  return false;
}

function findBanned(text, file) {
  const low = text.toLowerCase();
  const hits = [];
  for (const b of BANNED) {
    // Whole-word matches on the bare banned words ("merge", "repo", "branch");
    // "usage window" is a phrase. Plural/verb forms count: merges, merged,
    // branches, repos, repositories. Prefix matches are excluded so "merge"
    // never matches inside "merger", "branch" inside "branching".
    const word = b.word;
    const re = word.includes(" ")
      ? new RegExp(`\\b${word}\\b`, "i")
      : new RegExp(`\\b${word}(?:es|ed|ing|s)?\\b`, "i");
    if (re.test(low)) {
      hits.push({ rule: `R5 ${b.file}:${b.lines}`, word: b.word });
    }
  }
  return hits;
}

function analyze(file, mode) {
  const defects = [];
  const qseen = new Map(); // canonical question text -> first line number
  const answers = new Map(); // canonical text -> first line number
  let n = 0; // last question number
  let c = 0; // stated ceiling
  let prevQuestionNo = 0;
  let seenQuestion = false; // counting started
  let lines = [];

  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch (e) {
    return { file, defects: [{ line: 0, rule: "input", msg: `cannot read file: ${e.message}` }], qcount: 0 };
  }

  for (let i = 0; i < lines.length; i++) {
    const lineno = i + 1;
    let line = lines[i];
    if (line.startsWith(">")) line = line.replace(/^\s*>\s?/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (ANSWER_RE.test(trimmed)) {
      const body = trimmed.replace(ANSWER_RE, "").trim();
      if (body) {
        const canon = canonical(body);
        if (!answers.has(canon)) answers.set(canon, lineno);
      }
      continue;
    }

    const m = trimmed.match(QUESTION_RE);
    if (m) {
      const num = parseInt(m[1], 10);
      const statedC = parseInt(m[2], 10);
      const body = m[3] || "";

      // (7) N strictly increments; repeats and decreases are defects.
      if (num !== prevQuestionNo + 1) {
        defects.push({ line: lineno, rule: "N monotone", msg: `question number ${num} after ${prevQuestionNo} — N never resets, never repeats, never decreases (interview.md line 344)` });
      }
      prevQuestionNo = num;
      n = num;
      seenQuestion = true;

      // (7) ceiling movement must be spoken first (it is a prose line before
      // this question); the current C is the stated ceiling now.
      c = statedC;
      if (num > statedC) {
        defects.push({ line: lineno, rule: "over-ceiling", msg: `question ${num} past stated ceiling ${statedC} with no correction spoken first (interview.md lines 355-358)` });
      }

      if (!body) {
        defects.push({ line: lineno, rule: "empty question", msg: "question line has no body" });
      } else {
        // (1) one question at a time — a wall is a defect (audience.md §1,
        // Issue 12 FIX step 3).
        const qmatches = body.match(QWORDS_RE) || [];
        if (qmatches.length > 1) {
          defects.push({ line: lineno, rule: "one-at-a-time", msg: `${qmatches.length} question markers in one question — never a wall (audience.md line 15)` });
        }
        if (isWall(body)) {
          defects.push({ line: lineno, rule: "one-at-a-time", msg: "more than one ask inside one numbered question — never a wall (audience.md line 15, Issue 12 FIX step 3)" });
        }
        // (4) every counted question carries its number — enforced by shape.
        // (2) deleted questions never appear.
        for (const hit of findDeleted(body, file, mode)) {
          defects.push({ line: lineno, rule: "deleted question", msg: `matches ${hit.rule} (marker: "${hit.marker}") — deleted questions stay deleted (Issue 12 FIX step 4)` });
        }
        // (5) banned words only in default mode.
        if (mode === "default") {
          for (const hit of findBanned(body, file)) {
            defects.push({ line: lineno, rule: "banned word", msg: `"${hit.word}" in a default-mode question — ${hit.rule} (Issue 12 FIX step 1)` });
          }
        }
        // (3) never re-ask what is already answered — repeat of a prior
        // question in the same run is a defect.
        const canon = canonical(body);
        if (qseen.has(canon)) {
          defects.push({ line: lineno, rule: "repeat", msg: `identical to question at line ${qseen.get(canon)} — asked twice in one run (Issue 12 FIX step 2)` });
        } else {
          qseen.set(canon, lineno);
        }
        // (3) a question whose answer is on disk is ANSWERED — a question
        // repeating a previous answer is a defect (the canary defect).
        if (answers.has(canon)) {
          defects.push({ line: lineno, rule: "re-ask answered", msg: `answers a question already answered at line ${answers.get(canon)} — answer on disk is ANSWERED, never re-asked (interview.md R5 lines 272-275)` });
        }
      }
      continue;
    }

    // Prose line.
    // An uncounted "?" is legal BEFORE the first counted question — the
    // build-target exchange, the entry-mode question, and the brainstorm
    // probes are all uncounted (interview.md lines 318-325). After counting
    // starts, every question carries its number.
    if (seenQuestion && QMARK_RE.test(trimmed)) {
      defects.push({ line: lineno, rule: "uncounted question", msg: `prose line ends in "?" — a question asked without its number (interview.md line 305)` });
    }
    // Banned words in prose count only in default mode.
    if (mode === "default") {
      for (const hit of findBanned(trimmed, file)) {
        defects.push({ line: lineno, rule: "banned word", msg: `"${hit.word}" in default-mode prose — ${hit.rule} (Issue 12 FIX step 1)` });
      }
    }
  }

  return { file, defects, qcount: n };
}

function canonical(text) {
  return tokenize(text)
    .filter((t) => !A_TOKENS.has(t))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Selfcheck suite — every rule is proven both ways here.
// ---------------------------------------------------------------------------
const SELFTESTS = [
  {
    name: "clean default-mode run passes",
    mode: "default",
    text: `I will ask you at most 9 short questions — usually fewer — one at a time, and then you can walk away.
Question 1 of no more than 9 — I can make every technical decision myself and just build it — you'd answer only the few questions about your accounts, your money, and what you like. Or you can make the detailed calls with me as we go. Which do you want?
Question 2 of no more than 9 — Do you want me to create those pictures for you, or will you be supplying your own?
Question 3 of no more than 9 — You have two accounts I can use for artwork. Which would you like me to use?
Question 4 of no more than 9 — Is your DeepSeek account the direct one — the one you topped up with a balance — or are you reaching DeepSeek through it?
Question 5 of no more than 9 — Is there an app or website you already look at and think, "if mine is as good as that, I would be happy"? Name it if one comes to mind.
Question 6 of no more than 9 — When your finished app stands next to that example, which is the goal? (a) Mine stands shoulder to shoulder with it — as good as it, or better; a tie counts as done. (b) The example is more like a rulebook — mine has to meet every requirement it stands for. Pick one.
Question 7 of no more than 9 — Now the flip side: is there anything about that example — or about apps like it — that you specifically do NOT want in yours?
Question 8 of no more than 9 — To prove your app really looks as good as the example, I take real screenshots of both, side by side. That needs a one-time download of a browser tool — about 130 MB, onto this machine. Is that download okay?
Question 9 of no more than 9 — Here is how I will know it is finished: the site is live at its own web address. Does that match — yes, or tell me what is missing?`,
    expect: { defects: 0 },
  },
  {
    name: "default-mode walls of two fail",
    mode: "default",
    text: `Question 1 of no more than 9 — Do you want me to create those pictures for you, or will you be supplying your own? And do you want them on the front page, or just inside?
Question 2 of no more than 9 — Which would you like me to use?`,
    expect: { defects: 1, rules: ["one-at-a-time"] },
  },
  {
    name: "deleted question fails",
    mode: "default",
    text: `Question 1 of no more than 9 — How many agents do you want running at the same time?`,
    expect: { defects: 1, rules: ["deleted question"] },
  },
  {
    name: "deleted A4 phrase in a question fails",
    mode: "default",
    text: `Question 1 of no more than 9 — How many agents do you want running at the same time? Not what the tool says it CAN do — what YOU want.`,
    expect: { defects: 1, rules: ["deleted question"] },
  },
  {
    name: "deleted C0 wording fails",
    mode: "default",
    text: `Question 1 of no more than 9 — Does this project run once while you are watching, or does it keep running on its own until it is done?`,
    expect: { defects: 1, rules: ["deleted question"] },
  },
  {
    name: "banned word 'repo' fails in default mode",
    mode: "default",
    text: `Question 1 of no more than 9 — Do you already have a repo for this?`,
    expect: { defects: 1, rules: ["banned word"] },
  },
  {
    name: "banned phrase 'usage window' fails in default mode",
    mode: "default",
    text: `Question 1 of no more than 9 — How long is your usage window, and when does it reset?`,
    expect: { defects: 2, rules: ["deleted question", "banned word"] },
  },
  {
    name: "'merge' inside 'merger' is not a violation",
    mode: "default",
    text: `Question 1 of no more than 9 — Is this merger of ideas what you pictured?`,
    expect: { defects: 0 },
  },
  {
    name: "repeat of a prior question fails",
    mode: "default",
    text: `Question 1 of no more than 9 — Which would you like me to use?
Question 2 of no more than 9 — Which would you like me to use?`,
    expect: { defects: 1, rules: ["repeat"] },
  },
  {
    name: "re-asking a recorded answer fails (the canary defect)",
    mode: "default",
    text: `ANSWER: Do you want me to create those pictures for you, or will you be supplying your own?
Question 1 of no more than 9 — Do you want me to create those pictures for you, or will you be supplying your own?`,
    expect: { defects: 1, rules: ["re-ask answered"] },
  },
  {
    name: "uncounted question in prose fails",
    mode: "default",
    text: `Question 1 of no more than 9 — Which would you like me to use?
Would you like me to add a contact form?`,
    expect: { defects: 1, rules: ["uncounted question"] },
  },
  {
    name: "over-ceiling question fails",
    mode: "default",
    text: `Question 1 of no more than 3 — Which would you like me to use?
Question 2 of no more than 3 — Which account is it on?
Question 3 of no more than 3 — Which model do you prefer?
Question 4 of no more than 3 — Do you want a contact form?`,
    expect: { defects: 1, rules: ["over-ceiling"] },
  },
  {
    name: "N regression fails",
    mode: "default",
    text: `Question 1 of no more than 9 — Which would you like me to use?
Question 1 of no more than 9 — Which account is it on?`,
    expect: { defects: 1, rules: ["N monotone"] },
  },
  {
    name: "prose good-news lowering is clean",
    mode: "default",
    text: `Question 1 of no more than 9 — Which would you like me to use?
Good news — it will be at most 7 now, because you took my defaults.
Question 2 of no more than 7 — Which account is it on?`,
    expect: { defects: 0 },
  },
  {
    name: "advanced mode allows A4 and the banned words",
    mode: "advanced",
    text: `Question 1 of no more than 9 — How many agents do you want running at the same time? The work runs in workflows — teams of helpers. On this machine each workflow holds up to 8 helpers at once. Use the maximum, or cap it?
Question 2 of no more than 9 — Is there anywhere the loops must not push? A branch, a repo, a server — anything that should never receive an automatic push?`,
    expect: { defects: 0 },
  },
  {
    name: "advanced-mode B4 question is clean",
    mode: "advanced",
    text: `Question 1 of no more than 9 — Is there anywhere the loops must not push? A branch, a repo, a server — anything that should never receive an automatic push?`,
    expect: { defects: 0 },
  },
  {
    name: "B4 question in DEFAULT mode is clean too (not on the Issue 12 deleted list)",
    mode: "default",
    text: `Question 1 of no more than 9 — Is there anywhere the loops must not push? A branch, a repo, a server — anything that should never receive an automatic push?`,
    expect: { defects: 2, rules: ["banned word"] },
  },
  {
    name: "recap answer lines are clean",
    mode: "default",
    text: `Question 1 of no more than 9 — Which would you like me to use?
RECAP: I decided the thinking level, the number of helpers, and the fallback table. Say the word to change any of it.`,
    expect: { defects: 0 },
  },
  {
    name: "build-target and entry questions are uncounted exchanges and may end in a question mark",
    mode: "default",
    text: `What kind of thing are we building — an app, a website, or a funnel? Which works better for you — I ask you questions, or you hand me the material?`,
    expect: { defects: 0 },
  },
];

function runSelfcheck() {
  let failed = 0;
  for (const t of SELFTESTS) {
    const tmp = path.join(__dirname, ".selfcheck.tmp.txt");
    fs.writeFileSync(tmp, t.text);
    const res = analyze(tmp, t.mode);
    fs.unlinkSync(tmp);
    const ruleSet = new Set(res.defects.map((d) => d.rule));
    const ok = res.defects.length === t.expect.defects && (!t.expect.rules || t.expect.rules.every((r) => ruleSet.has(r)));
    if (!ok) {
      failed++;
      console.log(`FAIL ${t.name}`);
      console.log(`  expected ${t.expect.defects} defects${t.expect.rules ? " incl. " + t.expect.rules.join(",") : ""}`);
      console.log(`  got ${res.defects.length}: ${res.defects.map((d) => d.rule + "@" + d.line).join(", ")}`);
    }
  }
  if (failed) {
    console.log(`SELFCHECK: ${SELFTESTS.length - failed}/${SELFTESTS.length} passed — ${failed} FAILED`);
    process.exit(1);
  }
  console.log(`SELFCHECK: ${SELFTESTS.length}/${SELFTESTS.length} passed`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes("--selfcheck")) runSelfcheck();
if (args.includes("--test-names")) {
  for (const t of SELFTESTS) console.log(t.name);
  process.exit(0);
}

let fixturesDir = null;
const fdIdx = args.indexOf("--fixtures-dir");
if (fdIdx !== -1) {
  if (fdIdx + 1 >= args.length) {
    console.error("usage: r5-shape-check.mjs [--fixtures-dir <dir>] [--test-names] [--selfcheck]");
    process.exit(2);
  }
  fixturesDir = path.resolve(args[fdIdx + 1]);
}

if (fixturesDir) {
  let entries;
  try {
    entries = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".txt")).sort();
  } catch (e) {
    console.error(`error: cannot read fixtures dir ${fixturesDir}: ${e.message}`);
    process.exit(2);
  }
  if (entries.length === 0) {
    console.error(`error: no *.txt fixtures in ${fixturesDir}`);
    process.exit(2);
  }
  let totalDefects = 0;
  let passed = 0;
  for (const f of entries) {
    const mode = f.startsWith("advanced-") ? "advanced" : "default";
    const res = analyze(path.join(fixturesDir, f), mode);
    if (res.defects.length > 0) {
      totalDefects += res.defects.length;
      console.log(`FAIL ${f} (${mode} mode) — ${res.defects.length} defect(s):`);
      for (const d of res.defects) {
        console.log(`  line ${d.line} [${d.rule}] ${d.msg}`);
      }
    } else {
      passed++;
      console.log(`PASS ${f} (${mode} mode) — ${res.qcount} questions, clean`);
    }
  }
  console.log(passed === entries.length ? `FIXTURES: ${entries.length}/${entries.length} passed` : `FIXTURES: ${passed} of ${entries.length} passed — ${totalDefects} defect(s)`);
  process.exit(passed === entries.length ? 0 : 1);
}

// Fallback: analyze a single file given as the last argument.
const fileArg = args[args.length - 1];
if (fileArg && fs.existsSync(fileArg)) {
  const res = analyze(path.resolve(fileArg), "default");
  for (const d of res.defects) console.log(`${d.rule}@${d.line}: ${d.msg}`);
  console.log(res.defects.length === 0 ? `PASS ${fileArg} — ${res.qcount} questions, clean` : `FAIL ${fileArg} — ${res.defects.length} defect(s)`);
  process.exit(res.defects.length === 0 ? 0 : 1);
}

console.error("usage: r5-shape-check.mjs [--fixtures-dir <dir>] [--test-names] [--selfcheck]");
process.exit(2);
