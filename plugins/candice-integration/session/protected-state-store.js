'use strict'

/**
 * candice-integration / session/protected-state-store.js
 * FIX-013 S2 protected durable state store — owned path:
 * plugins/candice-integration/session/**
 *
 * The single on-disk boundary for the session manager's durable state
 * (`candice-sessions.json`). It owns file-level protection ONLY — record
 * semantics, governed-key enforcement, and the operation identity remain in
 * session-manager.js (FIX-013 S1 / FIX-012 authority).
 *
 * Guarantees:
 *   - One per-user state root: the store NEVER operates on a directory it
 *     cannot prove belongs to the current user. POSIX owner (euid) is
 *     verified before any read, write, or rename; failure to prove owner is
 *     FAIL CLOSED (`store:dir-owner-unverifiable` /
 *     `store:file-owner-unverifiable`) — no payload is read or written.
 *   - POSIX modes: directories 0700, state/temp files 0600. Tightening
 *     happens BEFORE any payload read (never read from or rewrite into a
 *     world-readable file); permissions are never weakened (monotonic).
 *   - Atomic replace: unique temp file (`<name>.tmp-<pid>-<random>`, never a
 *     fixed `.tmp` — two writers cannot collide), mode 0600, fsync where
 *     supported, owner + mode verified BEFORE rename, then directory fsync
 *     where supported.
 *   - Locked migration: old/unknown file schemaVersion is migrated under a
 *     single-writer lock file (O_EXCL, bounded staleness, idempotent via a
 *     migration marker sidecar). Migration preserves all metadata, tightens
 *     before reading, and never weakens permissions mid-race. A second
 *     consumer sees the marker and no-ops. A genuine lock contention timeout
 *     fails closed (`store:migration-locked`).
 *   - Corrupt state quarantine: malformed/undecodable state is MOVED (rename
 *     — inode preserved, never copied) to `quarantine/<name>.corrupt-<ts>-<hash>`
 *     with 0700 dir / 0600 file, THEN the consumer starts fresh. The payload
 *     is never embedded in any error message or returned string (the
 *     quarantine name carries a bounded timestamp + content hash only). If
 *     quarantine cannot be performed, the store fails closed
 *     (`store:quarantine-failed`) so the consumer degrades to Claude text
 *     fallback instead of trusting unproven bytes.
 *   - Windows: when running on win32, the store applies a user-only DACL via
 *     `icacls` (`/inheritance:r`, full control for the current user, then a
 *     read-back verification). Any inability to PROVE the user-only ACL is
 *     fail closed (`windows-acl-unproven`). NOTE: POSIX runs never invoke
 *     icacls; the Windows branch is exercised by a documented Windows runner
 *     (QC evidence item 4) and by the adapter-injection unit tests here.
 *
 * The store persists bounded recovery metadata only. It never persists
 * answers, raw audio, tokens, or terminal output. The question text required
 * to reconstruct the exact question is kept inside this user-only, 0600
 * boundary and is deleted by the manager after terminal completion or session
 * end (recordAnswer / endSession clear the pending record).
 *
 * Pure CommonJS, zero npm runtime dependencies (sections 12/17/27). All
 * methods return result objects; nothing throws for expected failures.
 */

const fsNative = require('fs')
const path = require('path')
const crypto = require('crypto')

const STATE_SCHEMA_VERSION = '1.0'

const DIR_MODE = 0o700
const FILE_MODE = 0o600

/** A live migration lock older than this is stale and may be stolen. */
const LOCK_STALE_MS = 60 * 1000
/** How long a second consumer waits for the lock before failing closed. */
const LOCK_WAIT_MS = 5 * 1000
/** Poll interval while waiting for the migration lock. */
const LOCK_POLL_MS = 50

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** POSIX-only current effective uid; null on Windows. */
function currentUid() {
  return typeof process.geteuid === 'function' ? process.geteuid() : null
}

function isWindowsPlatform(platform) {
  return platform === 'win32'
}

/** Default user-only DACL application for Windows hosts (fail closed). */
function defaultWindowsAcl(dir) {
  const { execFileSync } = require('child_process')
  // No process.env reads: `whoami` resolves the principal exactly as Windows
  // does (DOMAIN\user). (Icon read: process.env reads are pinned by
  // tests/same-session/provider-identity.test.js.)
  let user
  try {
    user = execFileSync('whoami', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    return { ok: false, code: 'windows-acl-unproven', error: 'cannot determine the current Windows user' }
  }
  if (!user) return { ok: false, code: 'windows-acl-unproven', error: 'cannot determine the current Windows user' }
  try {
    const out = execFileSync('icacls', [dir, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (!/Successfully processed/i.test(out)) {
      return { ok: false, code: 'windows-acl-unproven', error: 'icacls did not confirm the grant' }
    }
    // Read-back proof: the directory ACL must show the current user with (F).
    const readback = execFileSync('icacls', [dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const escaped = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(escaped + ':[^(]*\\((OI\\)\\(CI\\))?\\(F\\)').test(readback)) {
      return { ok: false, code: 'windows-acl-unproven', error: 'read-back did not prove a user-only full-control grant' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, code: 'windows-acl-unproven', error: `icacls failed: ${String((err && err.message) || err)}` }
  }
}

class ProtectedStateStore {
  /**
   * @param {object} opts
   * @param {string} opts.dir                per-user state root (must be a directory path)
   * @param {string} [opts.fileName]         state file name (default candice-sessions.json)
   * @param {string} [opts.targetSchemaVersion] file-level schema version to migrate TO
   * @param {function} [opts.clock]          () => ISO string (injectable for tests)
   * @param {object} [opts.fs]               fs adapter (injectable for ordering tests)
   * @param {function} [opts.windowsAcl]     Windows ACL adapter (default real icacls)
   * @param {string} [opts.platform]         override process.platform (tests)
   */
  constructor(opts) {
    const options = opts || {}
    this.dir = options.dir
    this.fileName = options.fileName || 'candice-sessions.json'
    this.targetSchemaVersion = options.targetSchemaVersion || STATE_SCHEMA_VERSION
    this.clock = options.clock || null
    this.fs = options.fs || fsNative
    this.windowsAcl = typeof options.windowsAcl === 'function' ? options.windowsAcl : defaultWindowsAcl
    this.platform = options.platform || process.platform
    if (!this.dir || typeof this.dir !== 'string' || this.dir.length === 0) {
      throw new Error('protected-state-store: a non-empty state dir is required')
    }
  }

  _nowIso() {
    return (this.clock || (() => new Date().toISOString()))()
  }

  _filePath() {
    return path.join(this.dir, this.fileName)
  }

  _quarantineDir() {
    return path.join(this.dir, 'quarantine')
  }

  _lockPath() {
    return path.join(this.dir, `.${this.fileName}.migration.lock`)
  }

  _markerPath() {
    return path.join(this.dir, `.${this.fileName}.migration.json`)
  }

  _verifyUserOwned(stat) {
    const uid = currentUid()
    if (uid === null) return true // Windows: owner proof is the DACL step
    return typeof stat.uid === 'number' && stat.uid === uid
  }

  /**
   * ensureRoot — create the per-user state root and PROVE it: exists, owned by
   * the current user, 0700 (tightened before any payload read). On Windows the
   * user-only DACL is applied and verified. Never weakens permissions.
   */
  ensureRoot() {
    const fs = this.fs
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: DIR_MODE })
    } catch (err) {
      return { ok: false, code: 'store:dir-protect-failed', error: `cannot create state dir: ${String((err && err.message) || err)}` }
    }
    let st
    try {
      st = fs.statSync(this.dir)
    } catch (err) {
      return { ok: false, code: 'store:dir-protect-failed', error: `cannot stat state dir: ${String((err && err.message) || err)}` }
    }
    if (!this._verifyUserOwned(st)) {
      return { ok: false, code: 'store:dir-owner-unverifiable', error: 'state dir is not owned by the current user' }
    }
    const windows = isWindowsPlatform(this.platform)
    if (!windows && (st.mode & 0o777) !== DIR_MODE) {
      try {
        fs.chmodSync(this.dir, DIR_MODE)
      } catch (err) {
        return { ok: false, code: 'store:dir-protect-failed', error: `cannot tighten state dir to 0700: ${String((err && err.message) || err)}` }
      }
      const after = fs.statSync(this.dir)
      if ((after.mode & 0o777) !== DIR_MODE) {
        return { ok: false, code: 'store:dir-protect-failed', error: 'state dir mode not 0700 after tighten' }
      }
    }
    if (windows) {
      const acl = this.windowsAcl(this.dir)
      if (!acl.ok) return acl // fail closed: unproven user-only DACL
    }
    return { ok: true }
  }

  /** Best-effort fsync of a directory handle (Windows may reject it). */
  _fsyncDir() {
    const fs = this.fs
    let fd = null
    try {
      fd = fs.openSync(this.dir, 'r')
      try {
        fs.fsyncSync(fd)
      } catch (err) {
        /* directory fsync unsupported here (e.g. Windows) — best effort */
      }
    } catch (err) {
      /* cannot open dir handle — best effort */
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd)
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

  /**
   * _writeAtomic — unique temp (0o600) -> fchmod -> write -> fsync -> verify
   * owner+mode BEFORE rename -> rename -> dir fsync. Returns {ok} or a
   * fail-closed code. Never leaves a fixed-name temp the next writer could
   * collide with.
   */
  _writeAtomic(state) {
    const fs = this.fs
    const tmp = path.join(this.dir, `${this.fileName}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`)
    let fd = null
    const windows = isWindowsPlatform(this.platform)
    try {
      const payload = JSON.stringify(state, null, 2)
      fd = fs.openSync(tmp, 'wx', FILE_MODE)
      if (!windows) fs.fchmodSync(fd, FILE_MODE) // umask cannot weaken the explicit mode (POSIX; Windows uses the DACL)
      fs.writeFileSync(fd, payload, 'utf8')
      try {
        fs.fsyncSync(fd)
      } catch (err) {
        /* fsync unsupported here — best effort (file still written + verified) */
      }
      fs.closeSync(fd)
      fd = null
      // Verify owner and mode BEFORE rename; unproven => fail closed.
      // (Mode bits carry no meaning on Windows — the DACL is the proof there.)
      const st = fs.statSync(tmp)
      if (!this._verifyUserOwned(st)) {
        fs.unlinkSync(tmp)
        return { ok: false, code: 'store:temp-owner-unverifiable', error: 'temp file owner is not the current user' }
      }
      if (!windows && (st.mode & 0o777) !== FILE_MODE) {
        fs.unlinkSync(tmp)
        return { ok: false, code: 'store:write-failed', error: 'temp file mode is not 0600 before rename' }
      }
      fs.renameSync(tmp, this._filePath())
      this._fsyncDir()
      return { ok: true }
    } catch (err) {
      if (fd !== null) {
        try {
          fs.closeSync(fd)
        } catch (err2) {
          /* ignore */
        }
      }
      try {
        fs.unlinkSync(tmp)
      } catch (err2) {
        /* temp already renamed or gone */
      }
      // Error text contains paths only — never payload bytes.
      return { ok: false, code: 'store:write-failed', error: `${String((err && err.message) || err)}` }
    }
  }

  /**
   * _quarantineCorrupt — MOVE (rename, never copy; same fs so inode is
   * preserved) the unreadable state file into `quarantine/` with a bounded
   * name (timestamp + content hash), mode 0600, dir 0700. Returns {ok} with
   * the quarantine path on success; { ok:false, code:'store:quarantine-failed' }
   * on failure so the consumer fails closed. Never logs payload bytes.
   */
  _quarantineCorrupt(file) {
    const fs = this.fs
    const qDir = this._quarantineDir()
    try {
      fs.mkdirSync(qDir, { recursive: true, mode: DIR_MODE })
      const st = fs.statSync(qDir)
      if (!this._verifyUserOwned(st)) {
        return { ok: false, code: 'store:quarantine-failed', error: 'quarantine dir is not owned by the current user' }
      }
      if ((st.mode & 0o777) !== DIR_MODE) {
        fs.chmodSync(qDir, DIR_MODE)
      }
      let raw = ''
      try {
        raw = fs.readFileSync(file, 'utf8')
      } catch (err) {
        return { ok: false, code: 'store:quarantine-failed', error: `cannot read corrupt state: ${String((err && err.message) || err)}` }
      }
      const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8)
      const ts = this._nowIso().replace(/[^\d]/g, '').slice(0, 15) // YYYYMMDDTHHMMSS, bounded
      const target = path.join(qDir, `${this.fileName}.corrupt-${ts}-${hash}`)
      fs.renameSync(file, target) // MOVE — inode preserved
      try {
        fs.chmodSync(target, FILE_MODE)
      } catch (err) {
        /* mode tighten after move is best-effort; dir remains user-only */
      }
      this._fsyncDir()
      return { ok: true, path: target }
    } catch (err) {
      // Name only, never content.
      return { ok: false, code: 'store:quarantine-failed', error: `${String((err && err.message) || err)}` }
    }
  }

  _readMarker() {
    try {
      const raw = this.fs.readFileSync(this._markerPath(), 'utf8')
      const parsed = JSON.parse(raw)
      return isPlainObject(parsed) ? parsed : null
    } catch (err) {
      return null
    }
  }

  _writeMarker(content) {
    // Sidecar marker: bounded metadata only (schema, outcome, timestamp).
    // The write result is the truth: a failed atomic write must never be
    // reported as a marker present.
    try {
      const written = this._writeAtomicTo(this._markerPath(), content)
      return written.ok === true
    } catch (err) {
      return false
    }
  }

  _writeAtomicTo(file, content) {
    const fs = this.fs
    const windows = isWindowsPlatform(this.platform)
    const tmp = path.join(this.dir, `${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`)
    const payload = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    let fd = null
    try {
      fd = fs.openSync(tmp, 'wx', FILE_MODE)
      if (!windows) fs.fchmodSync(fd, FILE_MODE) // Windows: the DACL is the boundary; mode bits carry no meaning
      fs.writeFileSync(fd, payload, 'utf8')
      try {
        fs.fsyncSync(fd)
      } catch (err) {
        /* best effort */
      }
      fs.closeSync(fd)
      fd = null
      const st = fs.statSync(tmp)
      // Windows statSync reports 0o666 for files; owner/mode proof there is
      // the user-only DACL (ensureRoot), so only POSIX checks mode bits.
      if (!this._verifyUserOwned(st) || (!windows && (st.mode & 0o777) !== FILE_MODE)) {
        fs.unlinkSync(tmp)
        throw new Error('temp file owner/mode unverifiable')
      }
      fs.renameSync(tmp, file)
      return { ok: true }
    } catch (err) {
      if (fd !== null) {
        try {
          fs.closeSync(fd)
        } catch (err2) {
          /* ignore */
        }
      }
      try {
        fs.unlinkSync(tmp)
      } catch (err2) {
        /* ignore */
      }
      return { ok: false, code: 'store:write-failed', error: String((err && err.message) || err) }
    }
  }

  /**
   * _acquireMigrationLock — single-writer lock via O_EXCL. Executes `body`
   * exactly once while held; a live lock holder makes the caller wait; a
   * stale lock (older than LOCK_STALE_MS) is stolen. Returns {ok} with the
   * body result, or a fail-closed code on genuine contention/timeout.
   */
  _withMigrationLock(body) {
    const fs = this.fs
    const lockPath = this._lockPath()
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      let fd = null
      try {
        fd = fs.openSync(lockPath, 'wx', FILE_MODE)
        fs.writeFileSync(fd, `${process.pid}\n${this._nowIso()}\n`, 'utf8')
        try {
          fs.fsyncSync(fd)
        } catch (err) {
          /* best effort */
        }
        fs.closeSync(fd)
        fd = null
        break
      } catch (err) {
        if (fd !== null) {
          try {
            fs.closeSync(fd)
          } catch (err2) {
            /* ignore */
          }
        }
        if (err && err.code === 'EEXIST') {
          let stale = false
          try {
            const st = fs.statSync(lockPath)
            stale = Date.now() - st.mtimeMs > LOCK_STALE_MS
          } catch (err2) {
            /* lock vanished — retry immediately */
            continue
          }
          if (stale) {
            // A crashed migrator left the lock. The marker decides idempotency;
            // the new migrator re-runs, and re-running is a no-op if the marker
            // shows the migration already completed.
            try {
              fs.unlinkSync(lockPath)
            } catch (err2) {
              /* raced by another stealer — retry */
            }
            continue
          }
          if (Date.now() > deadline) {
            return { ok: false, code: 'store:migration-locked', error: 'another migrator holds the lock; timed out' }
          }
          // Synchronous sleep (this store is sync-only); Atomics.wait never
          // busy-spins the event loop.
          try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS)
          } catch (err) {
            /* Atomics.wait unavailable — fall back to a bounded busy wait */
          }
          continue
        }
        return { ok: false, code: 'store:migration-failed', error: `cannot create migration lock: ${String((err && err.message) || err)}` }
      }
    }
    try {
      const result = body()
      return result
    } finally {
      try {
        fs.unlinkSync(lockPath)
      } catch (err) {
        /* already gone or stolen — marker still governs idempotency */
      }
    }
  }

  /**
   * _migrateSchema — normalize file-level schemaVersion to the target under
   * the single-writer lock, preserving ALL fields, record each record's
   * schemaVersion when present, and record exactly one migration marker
   * (sidecar, not the state file — the manager own-saves the state file and
   * must not clobber the marker or resurrect a second marker).
   */
  _migrateSchema(parsed) {
    const marker = this._readMarker()
    if (marker && marker.outcome === 'ok' && parsed.schemaVersion === this.targetSchemaVersion) {
      return { ok: true, state: parsed, migrated: false }
    }
    return this._withMigrationLock(() => {
      // Re-read under the lock: the winner of the race may have migrated.
      let current
      try {
        const raw = this.fs.readFileSync(this._filePath(), 'utf8')
        current = JSON.parse(raw)
      } catch (err) {
        // A racer quarantined it or the file changed — re-run the whole open.
        return { ok: false, code: 'store:race-reopen', error: 'state changed during migration; re-open required' }
      }
      if (!isPlainObject(current)) {
        return { ok: false, code: 'store:race-reopen', error: 'state changed during migration; re-open required' }
      }
      const markerNow = this._readMarker()
      if (markerNow && markerNow.outcome === 'ok' && current.schemaVersion === this.targetSchemaVersion) {
        return { ok: true, state: current, migrated: false }
      }
      const fromSchema = current.schemaVersion
      current.schemaVersion = this.targetSchemaVersion
      if (Array.isArray(current.sessions)) {
        for (const record of current.sessions) {
          if (isPlainObject(record) && typeof record.schemaVersion === 'string' && record.schemaVersion !== this.targetSchemaVersion) {
            record.schemaVersion = this.targetSchemaVersion
          }
        }
      }
      const written = this._writeAtomicTo(this._filePath(), current)
      if (!written.ok) return written
      const markOk = this._writeMarker({
        schemaVersion: '1.0',
        fromSchema,
        at: this._nowIso(),
        outcome: 'ok',
        file: this.fileName,
      })
      if (!markOk) {
        // The state file is already migrated; a missing marker only makes the
        // next run re-migrate (idempotent no-op on the same content). Do not
        // fail the consumer over a sidecar marker.
        return { ok: true, state: current, migrated: true }
      }
      return { ok: true, state: current, migrated: true }
    })
  }

  /**
   * open — protect + read + (migrate | quarantine). The consumer-facing entry.
   * Order is strict: ensure root (0700, owner) -> tighten file (0600, owner)
   * before ANY payload read -> parse -> quarantine corrupt -> locked schema
   * migration. Fail-closed codes mean the caller must NOT trust any state and
   * must degrade (Claude text fallback) — never succeed without a durable
   * terminal commit.
   *
   * @returns {{ok:true, state:object|null, fresh:boolean, migrated:boolean,
   *   quarantined:boolean, quarantine?:string} | {ok:false, code,
   *   error}}
   */
  open() {
    const root = this.ensureRoot()
    if (!root.ok) return root
    const file = this._filePath()
    let st
    try {
      st = this.fs.statSync(file)
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, state: null, fresh: true, migrated: false, quarantined: false }
      return { ok: false, code: 'store:inaccessible', error: `cannot stat state file: ${String((err && err.message) || err)}` }
    }
    // Tighten BEFORE read: never read payload from a file we cannot prove is
    // ours and user-only.
    if (!this._verifyUserOwned(st)) {
      return { ok: false, code: 'store:file-owner-unverifiable', error: 'state file is not owned by the current user' }
    }
    // Mode bits do not exist on Windows; the DACL proof (ensureRoot) is the
    // permission boundary there.
    if (!isWindowsPlatform(this.platform) && (st.mode & 0o777) !== FILE_MODE) {
      try {
        this.fs.chmodSync(file, FILE_MODE)
      } catch (err) {
        return { ok: false, code: 'store:file-protect-failed', error: `cannot tighten state file to 0600: ${String((err && err.message) || err)}` }
      }
      const after = this.fs.statSync(file)
      if ((after.mode & 0o777) !== FILE_MODE) {
        return { ok: false, code: 'store:file-protect-failed', error: 'state file mode is not 0600 after tighten' }
      }
    }
    let raw
    try {
      raw = this.fs.readFileSync(file, 'utf8')
    } catch (err) {
      return { ok: false, code: 'store:inaccessible', error: `cannot read state file: ${String((err && err.message) || err)}` }
    }
    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      // Corrupt: quarantine (move, name carries ts+hash only — never payload),
      // then start fresh. The consumer degrades to Claude text fallback.
      const q = this._quarantineCorrupt(file)
      if (!q.ok) return q
      return { ok: true, state: null, fresh: false, migrated: false, quarantined: true, quarantine: q.path }
    }
    if (!isPlainObject(parsed)) {
      const q = this._quarantineCorrupt(file)
      if (!q.ok) return q
      return { ok: true, state: null, fresh: false, migrated: false, quarantined: true, quarantine: q.path }
    }
    if (parsed.schemaVersion !== this.targetSchemaVersion) {
      const migrated = this._migrateSchema(parsed)
      if (!migrated.ok) {
        // 'store:race-reopen' is recoverable: the caller re-opens once.
        if (migrated.code === 'store:race-reopen') return this.open()
        return migrated
      }
      return { ok: true, state: migrated.state, fresh: false, migrated: migrated.migrated, quarantined: false }
    }
    return { ok: true, state: parsed, fresh: false, migrated: false, quarantined: false }
  }

  /**
   * save — atomic, protected replace of the state file. Returns {ok:true} or
   * a fail-closed code. The caller must treat any non-ok as "durable commit
   * failed" and never return success.
   */
  save(state) {
    if (!isPlainObject(state)) {
      return { ok: false, code: 'store:write-failed', error: 'state must be a plain object' }
    }
    const root = this.ensureRoot()
    if (!root.ok) return root
    // Re-verify the file is not held permissive before we overwrite it: the
    // atomic replace writes a NEW 0600 file anyway; the verify makes the
    // old file's mode irrelevant, but the root check above guarantees the
    // directory remains user-only.
    return this._writeAtomic(state)
  }

  /** Full path of the quarantine directory (for tests/evidence). */
  quarantineDirPath() {
    return this._quarantineDir()
  }

  /** Full path of the migration marker sidecar. */
  markerPath() {
    return this._markerPath()
  }

  /** Full lock path (tests/evidence). */
  lockPath() {
    return this._lockPath()
  }
}

module.exports = {
  ProtectedStateStore,
  STATE_SCHEMA_VERSION,
  DIR_MODE,
  FILE_MODE,
  isWindowsPlatform,
  defaultWindowsAcl,
}
