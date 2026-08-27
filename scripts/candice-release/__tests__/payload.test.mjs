import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalSignedPayload } from "../status.mjs";

// Q-03 step 2: the canonical signed payload is byte-exact. The tests below
// pin every construction rule — field set, order, separators, absence of a
// trailing newline, undefined rendering, verbatim value passthrough — so any
// change to the serialization breaks here before a release can be signed
// with different bytes.

const RECORD = {
  candidateCommit: "a".repeat(40),
  tag: "v0.2.0",
  artifactName: "Candice-Companion-0.2.0-arm64.dmg",
  url: "https://releases.blackceo.com/candice/Candice-Companion-0.2.0-arm64.dmg",
  sha256: "b".repeat(64),
};

function expectedLine(field, value) {
  return `${field}=${value}`;
}

test("payload contains exactly the five fixed fields in fixed order, LF-separated, no trailing newline", () => {
  const payload = canonicalSignedPayload(RECORD);
  const lines = payload.split("\n");
  assert.equal(lines.length, 5);
  assert.deepEqual(lines, [
    expectedLine("candidateCommit", RECORD.candidateCommit),
    expectedLine("tag", RECORD.tag),
    expectedLine("artifactName", RECORD.artifactName),
    expectedLine("url", RECORD.url),
    expectedLine("sha256", RECORD.sha256),
  ]);
  assert.equal(payload.endsWith("\n"), false);
});

test("golden payload bytes are stable — pinned hex and SHA-256", () => {
  const goldenHex =
    "63616e646964617465436f6d6d69743d" + "61".repeat(40) + "0a" +
    "7461673d76302e322e300a" +
    "61727469666163744e616d653d43616e646963652d436f6d70616e696f6e2d302e322e302d61726d36342e646d670a" +
    "75726c3d68747470733a2f2f72656c65617365732e626c61636b63656f2e636f6d2f63616e646963652f43616e646963652d436f6d70616e696f6e2d302e322e302d61726d36342e646d670a" +
    "7368613235363d" + "62".repeat(64);
  const payload = canonicalSignedPayload(RECORD);
  assert.equal(Buffer.from(payload, "utf8").toString("hex"), goldenHex);
  assert.equal(
    createHash("sha256").update(payload, "utf8").digest("hex"),
    "8bc90403679368b3546451d61f5a375fc9f4b1a88b58a992f1dbcf1674de54a2",
  );
});

test("extra fields in the record never enter the payload", () => {
  const record = { ...RECORD, injected: "nope", signature: "AAAA" };
  assert.equal(canonicalSignedPayload(record), canonicalSignedPayload(RECORD));
});

test("a modified candidate commit changes the payload bytes", () => {
  assert.notEqual(
    canonicalSignedPayload(RECORD),
    canonicalSignedPayload({ ...RECORD, candidateCommit: "f".repeat(40) }),
  );
});

test("a modified tag changes the payload bytes", () => {
  assert.notEqual(canonicalSignedPayload(RECORD), canonicalSignedPayload({ ...RECORD, tag: "v0.2.1" }));
});

test("a modified artifact name changes the payload bytes", () => {
  assert.notEqual(
    canonicalSignedPayload(RECORD),
    canonicalSignedPayload({ ...RECORD, artifactName: "Candice-Companion-0.2.0-x64.dmg" }),
  );
});

test("a modified URL changes the payload bytes", () => {
  assert.notEqual(
    canonicalSignedPayload(RECORD),
    canonicalSignedPayload({ ...RECORD, url: "https://evil.test/candice/Candice-Companion-0.2.0-arm64.dmg" }),
  );
});

test("a modified artifact SHA-256 changes the payload bytes", () => {
  assert.notEqual(canonicalSignedPayload(RECORD), canonicalSignedPayload({ ...RECORD, sha256: "c".repeat(64) }));
});

test("values pass through verbatim — no trimming, no lowercasing", () => {
  const record = {
    candidateCommit: "A".repeat(40),
    tag: "  v9.9.9  ",
    artifactName: " Name With Spaces.dmg ",
    url: "https://EXAMPLE.test/Path/Name.DMG",
    sha256: "D".repeat(64),
  };
  const lines = canonicalSignedPayload(record).split("\n");
  assert.equal(lines[0], `candidateCommit=${"A".repeat(40)}`);
  assert.equal(lines[1], "tag=  v9.9.9  ");
  assert.equal(lines[2], "artifactName= Name With Spaces.dmg ");
  assert.equal(lines[3], "url=https://EXAMPLE.test/Path/Name.DMG");
  assert.equal(lines[4], `sha256=${"D".repeat(64)}`);
});

test("missing values render literally as undefined and never collapse to an empty field", () => {
  const payload = canonicalSignedPayload({ candidateCommit: "a".repeat(40), tag: "v0.2.0" });
  const lines = payload.split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[2], "artifactName=undefined");
  assert.equal(lines[3], "url=undefined");
  assert.equal(lines[4], "sha256=undefined");
});

test("UTF-8 values are encoded verbatim (no normalization), with U+000A as the only separator", () => {
  const name = "Candice-é-Å.dmg"; // e-acute and Angstrom sign, precomposed vs decomposed would differ
  const payload = canonicalSignedPayload({ ...RECORD, artifactName: name });
  assert.equal(payload.split("\n")[2], `artifactName=${name}`);
  assert.equal(payload.split("\n").length, 5);
});
