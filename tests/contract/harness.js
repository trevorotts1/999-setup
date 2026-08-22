'use strict'

/**
 * candice contract suite — shared harness — owned path: tests/contract/**
 *
 * WS-41 contract/schema test suite (Master Spec 27, Checklist E.1 WS-41).
 *
 * Every schema in packages/candice-protocol/schemas/** is validated with the
 * AUTHORITATIVE full draft 2020-12 validator (ajv, per the WS-01 checkpoint:
 * "The authoritative full 2020-12 validation lives in the WS-41 contract suite
 * (ajv)"). Ajv is vendored under tests/contract/vendor/** so the suite runs on
 * a fresh checkout with ZERO package-manager step and ZERO network: the repo's
 * test convention (sections 12/17/27: no package-manager step on the customer
 * machine; every other lane's suite is plain `node`).
 *
 * Vendored packages (all MIT):
 *   ajv 8.20.0                 -> draft 2020-12 schema compiler
 *   ajv-formats 3.0.1          -> date-time / uri formats (status-event.timestamp)
 *   fast-deep-equal 3.1.3, fast-uri 3.1.5 (BSD-3-Clause), json-schema-traverse 1.0.0
 *                                -> ajv runtime dependencies
 * Root THIRD_PARTY_NOTICES.md is a 9.4 shared file (integration/release owner
 * only) — this lane records the vendoring here and in CHECKPOINT-WS-41.md.
 */

const path = require('path')

/**
 * Bootstrap the vendored ajv BEFORE anything requires it. NODE_PATH is the
 * documented Node mechanism (module resolution search path); _initPaths()
 * re-reads it. Idempotent: each test process runs this once, first.
 */
function bootstrapVendor() {
  const vendor = path.join(__dirname, 'vendor')
  const parts = [vendor]
  if (process.env.NODE_PATH) parts.push(process.env.NODE_PATH)
  process.env.NODE_PATH = parts.join(path.delimiter)
  require('module').Module._initPaths()
}

bootstrapVendor()

const fs = require('fs')
const Ajv2020 = require('ajv/dist/2020.js').default
const addFormats = require('ajv-formats')

// The schema root the suite validates against — the WS-01 owned glob.
const SCHEMAS_DIR = path.join(__dirname, '..', '..', 'packages', 'candice-protocol', 'schemas')
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'packages', 'candice-protocol', 'tests', 'fixtures')

/** New validator: draft 2020-12, all errors, formats, union types allowed
 * (the event schemas use type arrays like ["string","null"]), strict off
 * (mirrors the WS-01 ephemeral venv options). */
function newValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true })
  addFormats(ajv)
  return ajv
}

/** Every .schema.json under the schema root, as absolute paths. */
function schemaFiles(dir = SCHEMAS_DIR) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...schemaFiles(p))
    else if (entry.name.endsWith('.schema.json')) out.push(p)
  }
  return out.sort()
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** The four E.1-named contract schemas by bare name (without .schema.json). */
const E1_SCHEMAS = ['question-event', 'answer-event', 'status-event', 'preferences']

module.exports = {
  SCHEMAS_DIR,
  FIXTURES_DIR,
  bootstrapVendor,
  newValidator,
  schemaFiles,
  readJson,
  E1_SCHEMAS,
  vendor: require('path').join(__dirname, 'vendor'),
}
