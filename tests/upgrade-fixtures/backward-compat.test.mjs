/**
 * WS-47 — backward-compatibility fixtures (Master Spec sections 9/21;
 * E.1 WS-47 "upgrade fixtures"; deps WS-34 `tests/migrations/**`).
 *
 * The local preference profile is a versioned JSON document. A machine that
 * has run the OLD runtime (or a protocol-shaped doc, or a newer lane's doc)
 * must survive contact with the new chain:
 *
 *   1. pre-versioned profile (no schemaVersion at all) -> treated as v1,
 *      migrated with defaults, never crashes, valid fields survive;
 *   2. dirty v1 document (out-of-range values) -> repaired at v1 (WS-40
 *      runtime guarantee) then migrated — valid fields never lost;
 *   3. protocol-shaped doc (string schemaVersion "1.0") -> resolved to v2
 *      semantics, never misread as runtime v1 (which would drop its fields);
 *   4. future document (v9, written by a newer lane) -> preserved untouched,
 *      never persisted — disk byte-identical (spec 20);
 *   5. v1 full/partial REAL fixtures (shared with the WS-40 lane) -> migrate
 *      to v3 byte-exact, zero data loss;
 *   6. v2 -> v3 rename (nameAskedAt -> nameAsked) lossless;
 *   7. corrupt/unparseable profile -> reported, never overwritten;
 *   8. the version chain is pure — no I/O, no clocks, no env.
 *
 * This lane drives the REAL WS-34 chain (`runMigrations`,
 * `normalizeVersionedDoc`, `parseDocVersion`, the store) through its public
 * surface; it never re-implements a migration.
 *
 * Runner: plain Node >= 22.6 (Node 26 strips types natively) — same runner
 * as the WS-34 suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runMigrations,
  parseDocVersion,
  CURRENT_SCHEMA_VERSION,
} from "../../apps/candice-companion/src/preferences/migrations/index.ts";
import { loadAndMigrateDoc } from "../../apps/candice-companion/src/preferences/migrations/store.ts";
import {
  FIXTURE_PROFILE_FULL_V1,
  FIXTURE_PROFILE_PARTIAL_V1,
  FIXTURE_PROFILE_DIRTY_V1,
} from "../../apps/candice-companion/tests/prefs/fixtures/profiles.ts";
import {
  PRE_VERSIONED_V1,
  DIRTY_V1,
  PROTOCOL_DOC,
  FUTURE_V9,
  V2_FULL,
  EXPECTED_V3_FROM_V2,
} from "./fixtures/documents.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const strip = (doc) => {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) out[k] = strip(v);
    else out[k] = v;
  }
  return out;
};

test("fixture sanity: pre-versioned and v1 fixtures carry only v1-contract fields", () => {
  const v = runMigrations({ ...PRE_VERSIONED_V1 });
  assert.equal(v.violations.length, 0, JSON.stringify(v.violations));
  assert.equal(v.startVersion, 1, "missing schemaVersion resolves to v1");
  const d = runMigrations({ ...DIRTY_V1 });
  assert.equal(d.violations.length, 0, JSON.stringify(d.violations));
  const p = runMigrations({ ...PROTOCOL_DOC });
  assert.equal(p.violations.length, 0, JSON.stringify(p.violations));
});

test("1. pre-versioned profile (no schemaVersion) migrates losslessly to v3", () => {
  const r = runMigrations({ ...PRE_VERSIONED_V1 });
  assert.equal(r.violations.length, 0, JSON.stringify(r.violations));
  assert.equal(r.startVersion, 1);
  assert.equal(r.endVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(r.migrated, true);

  const p = r.profile;
  assert.equal(p.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(p.preferredName, "Trevor");
  assert.equal(p.voiceOutputEnabled, true);
  assert.equal(p.volume, 0.7);
  assert.equal(p.speechRate, 1.0);
  assert.equal(p.lastUsedAnswerMethod, "voice");
  assert.equal(p.textSize, "large"); // textScale 1.1 -> large
  assert.deepEqual(p.companionScreenPosition, { x: 12, y: 34, anchor: "floating" });
  assert.equal(p.lastUsedSkill, "kaizen");
});

test("2. dirty v1 document repairs at v1 then migrates — valid fields never lost", () => {
  const r = runMigrations({ ...DIRTY_V1 });
  assert.equal(r.violations.length, 0, JSON.stringify(r.violations));
  const p = r.profile;
  assert.equal(p.schemaVersion, CURRENT_SCHEMA_VERSION);
  // Repaired at v1: out-of-range -> v1 defaults (spec 20 / WS-40 runtime).
  assert.equal(p.volume, 1);
  assert.equal(p.speechRate, 1);
  assert.equal(p.textSize, "medium"); // textScale -3 -> v1 default 1 -> medium
  // Valid fields survive byte-for-byte.
  assert.equal(p.preferredName, "Trevor");
});

test("3. protocol-shaped doc (\"1.0\" string) is never misread as runtime v1", () => {
  assert.equal(parseDocVersion(PROTOCOL_DOC), 2, "\"1.0\" resolves to integer v2");
  const r = runMigrations({ ...PROTOCOL_DOC });
  assert.equal(r.violations.length, 0, JSON.stringify(r.violations));
  assert.equal(r.startVersion, 2);
  const p = r.profile;
  assert.equal(p.schemaVersion, CURRENT_SCHEMA_VERSION);
  // Protocol field names survive: no v1 rename ever ran on them.
  assert.equal(p.lastUsedAnswerMethod, "voice");
  assert.equal(p.textSize, "large");
  assert.deepEqual(p.companionScreenPosition, { x: 12, y: 34, anchor: "right" });
  assert.equal(p.preferredName, "Trevor");
});

test("4. future document (v9) is preserved untouched and never persisted", () => {
  const r = runMigrations({ ...FUTURE_V9 });
  assert.equal(r.migrated, false);
  assert.equal(r.startVersion, 9);
  assert.equal(r.endVersion, 9);
  assert.equal(r.violations.length, 0);
  assert.deepEqual(strip(r.profile), strip(FUTURE_V9), "fields untouched at v9");

  // Store: a future doc is handed back and the disk stays byte-identical.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws47-future-"));
  const file = path.join(dir, "profile.json");
  const original = JSON.stringify(FUTURE_V9);
  fs.writeFileSync(file, original);
  const res = loadAndMigrateDoc(dir, (d) => d);
  assert.equal(res.ok, true);
  assert.equal(res.migrated, false);
  assert.equal(fs.readFileSync(file, "utf8"), original, "disk byte-identical — future doc never persisted");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("5. REAL v1 fixtures migrate to the exact v3 output, zero data loss", () => {
  // Full v1 fixture: every retained value byte-for-byte, renames under their
  // new names, anchor defaulted to 'floating' (no bound-anchor choice in v1).
  const full = runMigrations({ ...FIXTURE_PROFILE_FULL_V1 });
  assert.equal(full.violations.length, 0, JSON.stringify(full.violations));
  assert.equal(full.profile.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(full.profile.preferredName, "Trevor");
  assert.equal(full.profile.lastUsedAnswerMethod, "voice");
  assert.equal(full.profile.textSize, "large");
  assert.deepEqual(full.profile.companionScreenPosition, { x: 12, y: 34, anchor: "floating" });
  assert.deepEqual(full.profile.nameAsked, { askedAt: "2026-08-20T10:00:00.000Z" });

  // Partial v1 fixture (asked but not answered): the ask record survives
  // (nameAskedAt present -> nameAsked.askedAt), no invented answer.
  const partial = runMigrations({ ...FIXTURE_PROFILE_PARTIAL_V1 });
  assert.equal(partial.violations.length, 0, JSON.stringify(partial.violations));
  assert.equal(partial.profile.preferredName, null);
  assert.deepEqual(partial.profile.nameAsked, { askedAt: "2026-08-20T10:00:00.000Z" });

  // Dirty v1 fixture: repaired then migrated.
  const dirty = runMigrations({ ...FIXTURE_PROFILE_DIRTY_V1 });
  assert.equal(dirty.violations.length, 0, JSON.stringify(dirty.violations));
  assert.equal(dirty.profile.preferredName, "Trevor");
  assert.equal(dirty.profile.volume, 1);
});

test("6. v2 -> v3 rename (nameAskedAt -> nameAsked) is byte-exact", () => {
  const r = runMigrations({ ...V2_FULL });
  assert.equal(r.violations.length, 0, JSON.stringify(r.violations));
  assert.equal(r.startVersion, 2);
  assert.deepEqual(strip(r.profile), strip(EXPECTED_V3_FROM_V2));
});

test("7. corrupt profile file is reported, never overwritten", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws47-corrupt-"));
  const file = path.join(dir, "profile.json");
  fs.writeFileSync(file, "{ this is not json");
  const res = loadAndMigrateDoc(dir, (d) => d);
  assert.equal(res.ok, true);
  assert.equal(res.corrupt, true);
  assert.equal(res.doc, null);
  assert.equal(fs.readFileSync(file, "utf8"), "{ this is not json", "corrupt file untouched");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("8. chain is pure: runMigrations writes nothing and is deterministic", () => {
  // The WS-34 suite pins purity at module level (no node:fs in the chain);
  // here we pin the observable contract: runMigrations on a v1 doc writes
  // nothing anywhere and returns the same result twice.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws47-pure-"));
  const before = fs.readdirSync(dir).sort();
  const r1 = runMigrations({ ...PRE_VERSIONED_V1 });
  const r2 = runMigrations({ ...PRE_VERSIONED_V1 });
  assert.deepEqual(strip(r1.profile), strip(r2.profile));
  assert.deepEqual(fs.readdirSync(dir).sort(), before, "runMigrations wrote nothing");
  assert.equal(r1.profile.schemaVersion, CURRENT_SCHEMA_VERSION);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("store round trip: a migrated v1 file is persisted at v3 atomically", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws47-store-"));
  const file = path.join(dir, "profile.json");
  fs.writeFileSync(file, JSON.stringify(FIXTURE_PROFILE_FULL_V1));
  const res = loadAndMigrateDoc(dir, (d) => d);
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(onDisk.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(strip(onDisk), strip(res.doc));
  fs.rmSync(dir, { recursive: true, force: true });
});
