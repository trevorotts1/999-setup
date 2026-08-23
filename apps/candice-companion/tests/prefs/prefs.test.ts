/**
 * WS-40 acceptance tests — user name / preferences / local profile
 * (CHECKLIST E.1 WS-40 + E.2 first-run name + WS-34 migration criteria).
 *
 * Binary criteria proven here:
 * 1. Preferred name asked at most once per local user.
 * 2. Name never inferred from the OS username (no code path reads it).
 * 3. Name stored in the local profile (persists across loads).
 * 4. Changeable later.
 * 5. Used naturally ("Welcome back, <name>").
 * 6. Local profile is never project/conversation memory (content isolation:
 *    only known preference fields are read or written).
 * 7. Versioned JSON schema; migrations run; schema bumps migrate without data
 *    loss (WS-34). The persisted document is the WS-34 v3 contract: integer
 *    schemaVersion 3, lastUsedAnswerMethod, textSize, companionScreenPosition
 *    {x,y,anchor}, nameAsked {askedAt}, reducedMotion nullable (null = follow
 *    the OS).
 * 8. Voice-output ON/OFF is a separate persistent preference, independent of
 *    the answer method (spec 5.2).
 * 9. Spec-9 fields persist: volume, speech rate, text size, reduced motion,
 *    position, last-used method (never a lock), optional last-used skill.
 * 10. Store failure degrades to defaults; never throws, never blocks (spec 20).
 *
 * Runner: plain Node >= 22.6 with --experimental-strip-types (Node 26 strips
 * types by default). `node --test tests/prefs/prefs.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadProfile,
  saveProfile,
  mergeProfile,
  migrateProfile,
  normalizeProfile,
  prefsDirPath,
  defaultProfile,
  needsNameAsk,
  markNameAsked,
  setPreferredName,
  changePreferredName,
  welcomeBackPhrase,
  normalizeName,
  isUsableName,
  PROFILE_DEFAULTS,
  LATEST_SCHEMA_VERSION,
} from '../../src/prefs/index.ts';
import {
  FIXTURE_PROFILE_FULL_V1,
  FIXTURE_PROFILE_PARTIAL_V1,
  FIXTURE_PROFILE_DIRTY_V1,
} from './fixtures/profiles.ts';

const HERE = import.meta.dirname;

/** Per-test temp dir so tests never touch a real user profile. */
function tmpEnv(): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-prefs-test-'));
  return { env: { ...process.env, CANDICE_PREFS_DIR: dir }, dir };
}

function readFile(env: NodeJS.ProcessEnv): Record<string, unknown> | null {
  const dir = env.CANDICE_PREFS_DIR as string;
  const file = path.join(dir, 'profile.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

test('profile store — persistence and atomicity', async (t) => {
  await t.test('missing file loads defaults, ok=true', () => {
    const { env, dir } = tmpEnv();
    const r = loadProfile(env);
    assert.equal(r.ok, true);
    assert.equal(r.recoveredFromCorruption, false);
    assert.deepEqual(r.profile, { ...PROFILE_DEFAULTS });
    assert.equal(r.profile.schemaVersion, LATEST_SCHEMA_VERSION);
    // a read must never create the profile document (the temp dir itself is
    // created by mkdtemp, but the store must not write anything)
    assert.equal(fs.existsSync(path.join(dir, 'profile.json')), false);
  });

  await t.test('save then load round-trips the full profile', () => {
    const { env } = tmpEnv();
    const p = mergeProfile(defaultProfile(), {
      preferredName: 'Trevor',
      voiceOutputEnabled: false,
      volume: 0.7,
      speechRate: 1.2,
      lastUsedAnswerMethod: 'voice',
      textSize: 'large',
      reducedMotion: true,
      companionScreenPosition: { x: 12, y: 34, anchor: 'floating' },
      lastUsedSkill: 'kaizen',
    });
    assert.equal(saveProfile(p, env), true);
    const r = loadProfile(env);
    assert.equal(r.ok, true);
    assert.equal(r.profile.preferredName, 'Trevor');
    assert.equal(r.profile.voiceOutputEnabled, false);
    assert.equal(r.profile.volume, 0.7);
    assert.equal(r.profile.speechRate, 1.2);
    assert.equal(r.profile.lastUsedAnswerMethod, 'voice');
    assert.equal(r.profile.textSize, 'large');
    assert.equal(r.profile.reducedMotion, true);
    assert.deepEqual(r.profile.companionScreenPosition, { x: 12, y: 34, anchor: 'floating' });
    assert.equal(r.profile.lastUsedSkill, 'kaizen');
  });

  await t.test('voice toggle persists independently of answer method (spec 5.2)', () => {
    const { env } = tmpEnv();
    let p = defaultProfile();
    // all four voice/type combinations remain valid and independently storable
    for (const voice of [true, false]) {
      for (const method of ['voice', 'typed', 'terminal'] as const) {
        p = mergeProfile(p, { voiceOutputEnabled: voice, lastUsedAnswerMethod: method });
        assert.equal(saveProfile(p, env), true);
        const r = loadProfile(env);
        assert.equal(r.profile.voiceOutputEnabled, voice);
        assert.equal(r.profile.lastUsedAnswerMethod, method);
      }
    }
  });

  await t.test('corrupt file is backed up and reset to defaults without throwing', () => {
    const { env, dir } = tmpEnv();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'profile.json'), '{ not json');
    const r = loadProfile(env);
    assert.equal(r.ok, true);
    assert.equal(r.recoveredFromCorruption, true);
    assert.deepEqual(r.profile, { ...PROFILE_DEFAULTS });
    const leftover = fs.readdirSync(dir);
    assert.ok(leftover.some((f) => f.startsWith('profile.json.corrupt-')), 'corrupt backup exists');
  });

  await t.test('write is atomic — no .tmp file remains after save', () => {
    const { env, dir } = tmpEnv();
    assert.equal(saveProfile(defaultProfile(), env), true);
    const files = fs.readdirSync(dir);
    assert.ok(files.includes('profile.json'));
    assert.equal(files.some((f) => f.endsWith('.tmp')), false);
  });

  await t.test('profile file permissions are restrictive (0o600)', () => {
    const { env, dir } = tmpEnv();
    assert.equal(saveProfile(defaultProfile(), env), true);
    const mode = fs.statSync(path.join(dir, 'profile.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

test('profile store — failure degradation (spec 20)', async (t) => {
  await t.test('unwritable directory degrades to ok=false, never throws', () => {
    const { env } = tmpEnv();
    const p = mergeProfile(defaultProfile(), { preferredName: 'Trevor' });
    // point the store at a path that cannot be created (a FILE in the way)
    const blocker = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-prefs-block-'));
    fs.writeFileSync(path.join(blocker, 'Candice'), 'not a dir');
    const badEnv = { ...env, CANDICE_PREFS_DIR: path.join(blocker, 'Candice') };
    // save degrades to false (never throws, never blocks the session)
    assert.equal(saveProfile(p, badEnv), false);
    // a read of the same unusable path ALSO degrades: ok=false with defaults,
    // never a throw
    const r = loadProfile(badEnv);
    assert.equal(r.ok, false);
    assert.deepEqual(r.profile, { ...PROFILE_DEFAULTS });
  });
});

test('name flow (spec 4)', async (t) => {
  await t.test('needsNameAsk is true only before the ask, at most once per user', () => {
    let p = defaultProfile();
    assert.equal(needsNameAsk(p), true);
    // asked once
    p = markNameAsked(p, '2026-08-21T00:00:00.000Z');
    assert.equal(needsNameAsk(p), false);
    // answered
    p = setPreferredName(p, '  Trevor  ');
    assert.equal(needsNameAsk(p), false);
    // even if the name is later cleared, the ask is NOT re-armed automatically
    p = setPreferredName(p, '');
    assert.equal(needsNameAsk(p), false);
  });

  await t.test('name is stored in the local profile and persists across loads', () => {
    const { env } = tmpEnv();
    let p = defaultProfile();
    p = markNameAsked(p, '2026-08-21T00:00:00.000Z');
    p = setPreferredName(p, 'Trevor');
    assert.equal(saveProfile(p, env), true);
    const r = loadProfile(env);
    assert.equal(r.profile.preferredName, 'Trevor');
    assert.deepEqual(r.profile.nameAsked, { askedAt: '2026-08-21T00:00:00.000Z' });
  });

  await t.test('name is changeable later (spec 4 item 9)', () => {
    const { env } = tmpEnv();
    let p = defaultProfile();
    p = setPreferredName(p, 'Trevor');
    assert.equal(saveProfile(p, env), true);
    p = changePreferredName(p, 'T.');
    assert.equal(saveProfile(p, env), true);
    assert.equal(loadProfile(env).profile.preferredName, 'T.');
  });

  await t.test('greeting uses the stored name naturally', () => {
    let p = defaultProfile();
    assert.equal(welcomeBackPhrase(p), null);
    p = setPreferredName(p, 'Trevor');
    assert.equal(welcomeBackPhrase(p), 'Welcome back, Trevor');
  });

  await t.test('name is never inferred from the OS username', () => {
    const { env } = tmpEnv();
    // Simulate hostile OS usernames that differ from any stored name:
    const hostile = { ...env, USER: 'admin', USERNAME: 'admin', LOGNAME: 'admin' };
    const r = loadProfile(hostile);
    assert.equal(r.profile.preferredName, null);
    // The lane source must not contain a code path that reads the OS username:
    const srcDir = path.join(HERE, '..', '..', 'src', 'prefs');
    const srcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    assert.ok(srcFiles.length > 0, 'prefs sources exist to scan');
    for (const f of srcFiles) {
      const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
      assert.ok(
        !/(os\.userInfo|getpwuid|\$USER\b|env\.USER\b|USERNAME)/.test(text),
        `${f} must not read the OS username`
      );
    }
  });

  await t.test('name normalization: collapsed whitespace, trimmed, bounded length', () => {
    assert.equal(normalizeName('   Trevor    Otts  '), 'Trevor Otts');
    assert.equal(normalizeName('   '), '');
    assert.ok(normalizeName('x'.repeat(200)).length <= 60);
    assert.equal(isUsableName('Trevor'), true);
    assert.equal(isUsableName(''), false);
    assert.equal(isUsableName('   '), false);
    assert.equal(isUsableName(undefined), false);
    assert.equal(isUsableName(null), false);
  });
});

test('versioned schema and migrations (CHECKLIST WS-34)', async (t) => {
  await t.test('v1 documents migrate to the v3 contract through the WS-34 chain', () => {
    const { profile, migrated, startVersion, endVersion, violations } = migrateProfile({
      schemaVersion: 1,
      preferredName: 'Trevor',
      volume: 99, // out of range -> v1 default
      extra: 'not-a-field',
    } as unknown as Record<string, unknown>);
    assert.equal(migrated, true);
    assert.equal(startVersion, 1);
    assert.equal(endVersion, LATEST_SCHEMA_VERSION);
    assert.deepEqual(violations, []);
    assert.equal(profile.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(profile.preferredName, 'Trevor');
    assert.equal(profile.volume, PROFILE_DEFAULTS.volume);
    // unknown fields never enter the typed profile
    assert.ok(!('extra' in profile));
  });

  await t.test('v1 field renames land on the protocol contract names (WS-34 v2)', () => {
    const { profile } = migrateProfile(FIXTURE_PROFILE_FULL_V1 as unknown as Record<string, unknown>);
    assert.equal(profile.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(profile.preferredName, 'Trevor');
    assert.equal(profile.lastUsedAnswerMethod, 'voice');
    assert.equal(profile.textSize, 'large'); // textScale 1.1 > 1
    assert.deepEqual(profile.companionScreenPosition, { x: 12, y: 34, anchor: 'floating' });
    assert.deepEqual(profile.nameAsked, { askedAt: '2026-08-20T10:00:00.000Z' });
    assert.equal(profile.lastUsedSkill, 'kaizen');
    assert.equal(profile.reducedMotion, true);
  });

  await t.test('a real v1 document on disk loads at v3 with zero data loss', () => {
    const { env, dir } = tmpEnv();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'profile.json'),
      JSON.stringify(FIXTURE_PROFILE_FULL_V1)
    );
    const r = loadProfile(env);
    assert.equal(r.ok, true);
    assert.equal(r.profile.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(r.profile.preferredName, 'Trevor');
    assert.equal(r.profile.lastUsedAnswerMethod, 'voice');
    assert.equal(r.profile.textSize, 'large');
    assert.deepEqual(r.profile.companionScreenPosition, { x: 12, y: 34, anchor: 'floating' });
    assert.deepEqual(r.profile.nameAsked, { askedAt: '2026-08-20T10:00:00.000Z' });
  });

  await t.test('future schema version is preserved at its own version, not downgraded', () => {
    const doc = {
      schemaVersion: 99,
      preferredName: 'Future',
      newV2Field: 'keep-me',
    } as unknown as Record<string, unknown>;
    const { profile, migrated } = migrateProfile(doc);
    assert.equal(migrated, false);
    assert.equal(profile.schemaVersion, 99);
    assert.equal(profile.preferredName, 'Future');
    // unknown fields of a future version survive the loader untouched
    assert.equal((profile as unknown as Record<string, unknown>).newV2Field, 'keep-me');
  });

  await t.test('an older lane refuses to persist a future-version document (spec 20: never destroy newer data)', () => {
    const { env, dir } = tmpEnv();
    fs.mkdirSync(dir, { recursive: true });
    const onDisk = {
      schemaVersion: 99,
      preferredName: 'Future',
      newV2Field: 'keep-me',
    } as unknown as Record<string, unknown>;
    fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(onDisk));
    const r = loadProfile(env);
    assert.equal(r.ok, true);
    assert.equal(r.profile.schemaVersion, 99);
    // persisting is refused: the file on disk must be byte-identical
    assert.equal(saveProfile(r.profile, env), false);
    const after = fs.readFileSync(path.join(dir, 'profile.json'), 'utf8');
    assert.equal(after, JSON.stringify(onDisk));
  });

  await t.test('mergeProfile does not downgrade or strip a future-version document (WS-40 data-destruction regression)', () => {
    const { env, dir } = tmpEnv();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'profile.json');
    const onDisk = {
      schemaVersion: 99,
      preferredName: 'Future',
      newV2Field: 'keep-me',
      volume: 0.9,
    };
    fs.writeFileSync(file, JSON.stringify(onDisk));
    const r = loadProfile(env);
    assert.equal(r.ok, true);
    assert.equal(r.profile.schemaVersion, 99);

    // empty patch: merge must not stamp the version down or drop v99 fields
    const mergedEmpty = mergeProfile(r.profile, {});
    assert.equal(mergedEmpty.schemaVersion, 99);
    assert.equal((mergedEmpty as unknown as Record<string, unknown>).newV2Field, 'keep-me');
    assert.equal(mergedEmpty.preferredName, 'Future');
    assert.equal(saveProfile(mergedEmpty, env), false);
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(onDisk));

    // name flow patch: setPreferredName goes through mergeProfile; the v99
    // document must survive in memory with the patch applied, and the save
    // must still be refused so the newer lane's file stays byte-identical
    const renamed = setPreferredName(r.profile, 'Trevor');
    assert.equal(renamed.schemaVersion, 99);
    assert.equal(renamed.preferredName, 'Trevor');
    assert.equal((renamed as unknown as Record<string, unknown>).newV2Field, 'keep-me');
    assert.equal(renamed.volume, 0.9);
    assert.equal(saveProfile(renamed, env), false);
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(onDisk));
  });

  await t.test('a nonsense version cannot spin the migration loop', () => {
    const { profile, migrated, startVersion } = migrateProfile({ schemaVersion: -5 } as unknown as Record<string, unknown>);
    assert.equal(startVersion, 1); // garbage resolves to the pre-versioned baseline
    assert.equal(migrated, true);
    assert.equal(profile.schemaVersion, LATEST_SCHEMA_VERSION);
  });

  await t.test('fixtures: v1 documents migrate without data loss', () => {
    const full = migrateProfile(FIXTURE_PROFILE_FULL_V1 as unknown as Record<string, unknown>).profile;
    assert.equal(full.preferredName, 'Trevor');
    assert.equal(full.lastUsedAnswerMethod, 'voice');
    assert.deepEqual(full.companionScreenPosition, { x: 12, y: 34, anchor: 'floating' });
    const partial = migrateProfile(FIXTURE_PROFILE_PARTIAL_V1 as unknown as Record<string, unknown>).profile;
    assert.deepEqual(partial.nameAsked, { askedAt: '2026-08-20T10:00:00.000Z' });
    assert.equal(partial.preferredName, null);
    const dirty = migrateProfile(FIXTURE_PROFILE_DIRTY_V1 as unknown as Record<string, unknown>).profile;
    assert.equal(dirty.preferredName, 'Trevor'); // valid field survives
    assert.equal(dirty.volume, PROFILE_DEFAULTS.volume); // invalid value repaired
    assert.equal(dirty.textSize, 'medium'); // textScale -3 repaired to v1 default 1 -> medium
  });

  await t.test('normalizeProfile repairs dirty v3 values without inventing choices', () => {
    const p = normalizeProfile({
      schemaVersion: 3,
      preferredName: 'Trevor',
      volume: 99,
      textSize: 'huge', // bad enum -> null (unknown choice)
      reducedMotion: 'yes', // wrong type -> null (follow the OS)
      companionScreenPosition: 'sideways', // wrong type -> null
      extra: 'not-a-field',
    } as unknown as Record<string, unknown>);
    assert.equal(p.preferredName, 'Trevor');
    assert.equal(p.volume, PROFILE_DEFAULTS.volume);
    assert.equal(p.textSize, null);
    assert.equal(p.reducedMotion, null);
    assert.equal(p.companionScreenPosition, null);
    assert.ok(!('extra' in p));
  });
});

test('platform paths (spec 9 recommended locations)', async (t) => {
  await t.test('CANDICE_PREFS_DIR override wins', () => {
    const env = {
      CANDICE_PREFS_DIR: '/tmp/candice-x',
      HOME: '/home/u',
      LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
    } as NodeJS.ProcessEnv;
    assert.equal(prefsDirPath(env), '/tmp/candice-x');
  });

  await t.test('macOS path uses ~/Library/Application Support/BlackCEO/999/Candice', () => {
    const env = { HOME: '/Users/trevor' } as NodeJS.ProcessEnv;
    const p = prefsDirPath(env);
    assert.ok(p.endsWith('/Library/Application Support/BlackCEO/999/Candice'));
  });

  await t.test('Windows path uses %LOCALAPPDATA%\\BlackCEO\\999\\Candice (no hardcoded C:\\Users)', () => {
    // platform is passed literally so both branches are proven on any host OS
    const env = { LOCALAPPDATA: 'C:\\Users\\trevor\\AppData\\Local' } as NodeJS.ProcessEnv;
    assert.equal(prefsDirPath(env, 'win32'), 'C:\\Users\\trevor\\AppData\\Local\\BlackCEO\\999\\Candice');
    // Known-Folders fallback via USERPROFILE, never a hardcoded username
    const env2 = { USERPROFILE: 'D:\\Users\\trevor' } as NodeJS.ProcessEnv;
    assert.equal(prefsDirPath(env2, 'win32'), 'D:\\Users\\trevor\\AppData\\Local\\BlackCEO\\999\\Candice');
  });
});

test('no project/conversation memory (spec 9)', async (t) => {
  await t.test('store only writes known preference fields, never conversation content', () => {
    const { env } = tmpEnv();
    const p = defaultProfile();
    assert.equal(saveProfile(p, env), true);
    const doc = readFile(env);
    assert.notEqual(doc, null);
    // defaults-only doc contains the always-present v3 fields, nothing else
    const docKeys = Object.keys(doc as Record<string, unknown>);
    assert.deepEqual(
      docKeys.sort(),
      [
        'schemaVersion',
        'preferredName',
        'voiceOutputEnabled',
        'volume',
        'speechRate',
        'lastUsedAnswerMethod',
        'textSize',
        'reducedMotion',
        'companionScreenPosition',
        'lastUsedSkill',
        'nameAsked',
      ].sort()
    );
    // A doc with every field set still contains only preference fields:
    const full = mergeProfile(p, {
      preferredName: 'Trevor',
      voiceOutputEnabled: false,
      volume: 0.8,
      speechRate: 1.1,
      lastUsedAnswerMethod: 'typed',
      textSize: 'small',
      reducedMotion: true,
      companionScreenPosition: { x: 1, y: 2, anchor: 'left' },
      lastUsedSkill: 'bro',
      nameAsked: { askedAt: '2026-08-21T00:00:00.000Z' },
    });
    assert.equal(saveProfile(full, env), true);
    const fullDoc = readFile(env) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(fullDoc).sort(),
      [
        'schemaVersion',
        'preferredName',
        'voiceOutputEnabled',
        'volume',
        'speechRate',
        'lastUsedAnswerMethod',
        'textSize',
        'reducedMotion',
        'companionScreenPosition',
        'lastUsedSkill',
        'nameAsked',
      ].sort()
    );
  });
});
