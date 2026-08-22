'use strict'

/**
 * WS-44 privacy/security/secrets audit — shared helpers.
 *
 * Owned lane (manifest 9.2 WR-021 / WS-44):
 *   `tests/privacy-audit/**` + `docs/privacy-audit/**` (READ-ONLY audit lane:
 *   findings recorded as CROSS-LANE-FINDING + fix tickets; no other path is
 *   ever written by this lane).
 *
 * Zero dependencies, plain node (repo test convention, sections 12/17/27).
 * All helpers are side-effect free.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

/** Repo root: tests/privacy-audit/../.. */
const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** Read a file relative to the repo root; null when missing/unreadable. */
function readRel(rel) {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
  } catch {
    return null
  }
}

/** Alias kept for readability at call sites. */
const readRelFile = readRel

/** List tracked files (git ls-files) relative to the repo root. */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' })
    return out.split('\n').filter((l) => l.length > 0)
  } catch {
    return []
  }
}

/** Recursively list files under rel (source code only; skip node_modules,
 * cargo target, .git, backups, __tests__, *.test.*, docs, checkpoints). */
function sourceFilesUnder(rel, opts = {}) {
  const skipDirs = new Set(
    (opts.skipDirs || []).concat(['node_modules', 'target', '.qc-backup', '.git', '__tests__'])
  )
  const out = []
  const dir = path.join(REPO_ROOT, rel)
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (skipDirs.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && /\.(rs|ts|js|mjs|cjs)$/.test(e.name)) out.push(full)
    }
  }
  walk(dir)
  return out
}

/** True when a file content matches every regex (source evidence lines). */
function contentMatches(fileAbs, regexes, opts = {}) {
  let text
  try {
    text = fs.readFileSync(fileAbs, 'utf8')
  } catch {
    return false
  }
  if (opts.ignoreLines) {
    text = text
      .split('\n')
      .filter((l) => !opts.ignoreLines.some((re) => re.test(l)))
      .join('\n')
  }
  return regexes.every((re) => re.test(text))
}

/** Collect evidence lines (file + line + text) for one regex. */
function evidenceFor(fileAbs, regex, { limit = 4, ignoreLines = [] } = {}) {
  let lines
  try {
    lines = fs.readFileSync(fileAbs, 'utf8').split('\n')
  } catch {
    return []
  }
  const hits = []
  for (let i = 0; i < lines.length && hits.length < limit; i += 1) {
    const l = lines[i]
    if (ignoreLines.some((re) => re.test(l))) continue
    if (regex.test(l)) {
      hits.push({ file: path.relative(REPO_ROOT, fileAbs), line: i + 1, text: l.trim().slice(0, 140) })
    }
  }
  return hits
}

function result(check, ok, evidence, notes) {
  return { check, ok, evidence: evidence || [], notes: notes || '' }
}

function printResult(r) {
  const mark = r.ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${r.check}`)
  if (r.notes) console.log(`      note: ${r.notes}`)
  for (const e of r.evidence) {
    console.log(`      ${e.file}:${e.line}  ${e.text}`)
  }
}

module.exports = {
  REPO_ROOT,
  readRel,
  readRelFile,
  trackedFiles,
  sourceFilesUnder,
  contentMatches,
  evidenceFor,
  result,
  printResult,
}
