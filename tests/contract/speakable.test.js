'use strict'

/**
 * No question may ship an UNFILLED TEMPLATE in text a user reads or hears.
 *
 * The registry's `display` and `spoken` are consumed VERBATIM --
 * `question-registry.js:49` sets `text: e.display` and nothing anywhere in
 * this repo substitutes into either field (searched
 * packages/candice-protocol/src and plugins/candice-integration; the
 * control for that search is that it does find the two sites where
 * `display` is consumed). So anything that looks like a blank IS a blank
 * when it reaches the user.
 *
 * Five entries shipped one. `interview.md` is not at fault and was not
 * changed: it defines these as fill-ins for the ASKING AGENT --
 *
 *   line 397:  "**Question <N> of no more than <C> —** <the question...>"
 *   line 1391: "with the blanks filled in from what they told you before"
 *
 * -- and the registry baked the instruction itself into the payload. So
 * Candice would have SAID, out loud:
 *
 *   "Question less-than N greater-than of no more than less-than C"
 *   "Last time we worked together, on bracket date bracket"
 *   "Usually backtick tilde slash Downloads slash projects slash backtick"
 *   "...unless you say otherwise: bracket the block's defaults..."
 *
 * Run: node tests/contract/speakable.test.js
 */

const assert = require('assert')
const path = require('path')
const registry = require('../../packages/candice-protocol/question-registry')

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${name}: ${err.message}`)
  }
}

/** Things that are a blank for someone else to fill, not words to say. */
const TEMPLATE_PATTERNS = [
  { re: /<[A-Za-z][A-Za-z0-9_ -]*>/, what: 'an angle-bracket placeholder' },
  { re: /\[[^\]]+\]/, what: 'a square-bracket placeholder' },
  { re: /\{\{?[A-Za-z_][A-Za-z0-9_.]*\}?\}/, what: 'a brace placeholder' },
  { re: /%[sd]\b/, what: 'a printf placeholder' },
]

/** Punctuation a speech engine reads out as words. */
const SPOKEN_HAZARDS = [
  { re: /`/, what: 'a backtick' },
  { re: /(^|\s)[~/][A-Za-z0-9_.-]*\//, what: 'a filesystem path' },
  { re: /[A-Za-z0-9]_[A-Za-z0-9]/, what: 'an underscore_identifier' },
]

const entries = registry.activeEntries()

check('the registry is non-empty (control: this file read real data)', () => {
  assert.ok(entries.length > 20, `expected many entries, got ${entries.length}`)
})

check('no DISPLAYED question contains an unfilled template', () => {
  const bad = []
  for (const e of entries) {
    for (const { re, what } of TEMPLATE_PATTERNS) {
      if (re.test(e.display || '')) bad.push(`${e.key}: display carries ${what}`)
    }
  }
  assert.deepStrictEqual(bad, [], `\n  ${bad.join('\n  ')}`)
})

check('no SPOKEN question contains an unfilled template', () => {
  const bad = []
  for (const e of entries) {
    for (const { re, what } of TEMPLATE_PATTERNS) {
      if (re.test(e.spoken || '')) bad.push(`${e.key}: spoken carries ${what}`)
    }
  }
  assert.deepStrictEqual(bad, [], `\n  ${bad.join('\n  ')}`)
})

check('no SPOKEN question contains punctuation a voice reads aloud as words', () => {
  const bad = []
  for (const e of entries) {
    for (const { re, what } of SPOKEN_HAZARDS) {
      if (re.test(e.spoken || '')) bad.push(`${e.key}: spoken carries ${what}`)
    }
  }
  assert.deepStrictEqual(bad, [], `\n  ${bad.join('\n  ')}`)
})

check('CONTROL: every pattern fires on text that really contains its target', () => {
  // Without this, a regex that silently stopped matching would report a
  // clean sweep forever. Each pattern is proved against a sample built to
  // trip that pattern specifically -- a single combined sample was the
  // first version of this check and it was WRONG, because the path
  // pattern requires the path to follow whitespace and the sample had it
  // inside backticks. The control caught that, which is the point of it.
  const samples = [
    ['an angle-bracket placeholder', 'Question <N> of no more than <C>'],
    ['a square-bracket placeholder', 'we spoke on [date] about it'],
    ['a brace placeholder', 'your plan is {{plan}} today'],
    ['a printf placeholder', 'you picked %s last time'],
    ['a backtick', 'put it in `that folder`'],
    ['a filesystem path', 'usually ~/Downloads/projects/ is fine'],
    ['an underscore_identifier', 'the BUILD_TARGET question'],
  ]
  const all = [...TEMPLATE_PATTERNS, ...SPOKEN_HAZARDS]
  for (const [what, sample] of samples) {
    const pattern = all.find((p) => p.what === what)
    assert.ok(pattern, `no pattern is registered for ${what}`)
    assert.ok(pattern.re.test(sample), `${what} failed to match: ${JSON.stringify(sample)}`)
  }
  // And the reverse: a clean sentence must trip nothing, or every entry
  // would fail and the sweep above would be noise rather than a result.
  const clean = 'Where should I put the project folder? Usually a folder called projects, inside your Downloads folder.'
  for (const p of all) {
    assert.ok(!p.re.test(clean), `${p.what} false-positives on clean prose`)
  }
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
