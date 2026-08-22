'use strict'

/**
 * candice failure matrix — temp unwritable — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "temp directory unwritable" leg (spec 8: audio lives only inside
 * a Candice-owned per-session temp dir; nothing may ever block or crash the
 * session when the temp surface fails). Drives the REAL WS-20 cleanup engine
 * (`sweepStaleTempAudio`) with a real tmpfs root plus a failing FS adapter:
 * an unreadable root reports a named failure and deletes nothing; a delete
 * that fails reports failed truthfully — never a blind sweep, never a
 * propagated throw.
 *
 * Invariants: unwritable temp -> named failure, zero blind deletions,
 * audio never kept silently.
 */

const assert = require('assert')
const path = require('path')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { check, checkAsync, finish } = require('./harness')

const { sweepStaleTempAudio, CANDICE_TEMP_ROOT } = require(
  path.join(__dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'audio', 'cleanup', 'index.ts')
)

function realFs() {
  return {
    mkdir: (p, m) => fsp.mkdir(p, m),
    readdir: (p) => fsp.readdir(p),
    stat: async (p) => {
      const s = await fsp.stat(p)
      return { isDirectory: s.isDirectory(), isFile: s.isFile(), mtimeMs: s.mtimeMs, mode: s.mode }
    },
    rm: (p, o) => fsp.rm(p, o),
    writeFile: (p, d) => fsp.writeFile(p, d),
    realpath: (p) => fsp.realpath(p),
    exists: (p) => fsp.access(p).then(() => true, () => false),
  }
}

async function main() {
  // ---- Unreadable/unwritable temp root: named failure, no blind deletion. ----
  await checkAsync('unreadable temp root: sweep reports failed truthfully, deletes nothing', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-temp-'))
    try {
      const owned = path.join(root, CANDICE_TEMP_ROOT)
      await fsp.mkdir(owned)
      await fsp.mkdir(path.join(owned, 'crash-orphan'))
      await fsp.writeFile(path.join(owned, 'crash-orphan', '.candice-session'), '')
      // Root that cannot even be readdir'ed.
      const brokenFs = {
        ...realFs(),
        readdir: () => Promise.reject(new Error('EACCES: permission denied')),
      }
      const result = await sweepStaleTempAudio({ fs: brokenFs, baseRoot: root })
      assert.equal(result.failed, 1, 'failure is named')
      assert.equal(result.removed, 0, 'nothing deleted on an unreadable root')
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  await checkAsync('failed delete: reported failed truthfully, never kept silently', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-temp-'))
    try {
      const owned = path.join(root, CANDICE_TEMP_ROOT)
      await fsp.mkdir(owned)
      const stale = path.join(owned, 'orphan')
      await fsp.mkdir(stale)
      await fsp.writeFile(path.join(stale, '.candice-session'), '')
      const old = new Date(Date.now() - 24 * 60 * 60 * 1000 - 60_000)
      await fsp.utimes(stale, old, old)
      const failingFs = {
        ...realFs(),
        rm: () => Promise.reject(new Error('EACCES: cannot remove')),
      }
      const result = await sweepStaleTempAudio({ fs: failingFs, baseRoot: root })
      assert.equal(result.failed, 1, 'failed removal is counted')
      assert.equal(result.removed, 0)
      const remains = await fsp.readdir(owned)
      assert.ok(remains.includes('orphan'), 'orphan still present, reported not deleted')
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  await checkAsync('a root that does not exist yet: fresh machine, zero noise', async () => {
    const missing = path.join(os.tmpdir(), 'candice-fm-temp-never-created-' + Date.now())
    const result = await sweepStaleTempAudio({ fs: realFs(), baseRoot: missing })
    assert.equal(result.scanned, 0)
    assert.equal(result.removed, 0)
    assert.equal(result.failed, 0)
  })

  finish('TEMP-UNWRITABLE')
}

main()
