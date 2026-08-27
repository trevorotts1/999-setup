/**
 * WS-35 update startup disposition (FIX-013 S5, audit F13-06).
 *
 * The WS-33 updater OWNS rollback execution (spec 21: rollback runs before
 * a failed update starts, never at companion startup). This lane receives
 * ONLY the updater's own journaled outcome — the `install-journal.jsonl`
 * line the atomic install engine commits after a verified rename — and
 * validates it. A disposition is valid only when:
 *
 *   - the newest journal line is an `install` op;
 *   - its `result` is exactly `ok`;
 *   - the target path is bounded, absolute, and carries no traversal.
 *
 * A missing journal, an unreadable journal, a malformed line, a non-ok
 * result, or an unvalidated target yields an INVALID disposition with a
 * machine-readable reason — never a guess, never a fabricated rollback
 * state. Rollback itself is never invoked from this lane.
 *
 * No secrets, no payloads: only the journal facts above are parsed.
 */

import { readFileSync } from "node:fs";

import type { UpdaterDisposition, UpdaterJournal } from "./types.ts";

const PATH_MAX = 1024;
const TS_MAX = 64;

/** Bounded, non-empty string; null when absent/overlong. */
function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Absolute POSIX or Windows drive/UNC path with no traversal segments. */
function isPlausibleTarget(target: string): boolean {
  if (target.length === 0 || target.length > PATH_MAX) return false;
  const absolute = target.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(target)
    || target.startsWith("\\\\");
  if (!absolute) return false;
  return !target.split(/[\\/]/).includes("..");
}

function basenameOf(target: string): string {
  const segments = target.split(/[\\/]/).filter((part) => part.length > 0);
  const last = segments[segments.length - 1];
  return last && last.length <= 128 ? last : "component";
}

/**
 * Validate one raw journal line against the disposition contract. Pure —
 * no IO, deterministic. A malformed line NEVER yields a valid disposition.
 */
export function validateUpdaterDisposition(
  line: Record<string, unknown> | null | undefined,
): UpdaterDisposition {
  if (!line || typeof line !== "object") {
    return { valid: false, detail: null, invalidReason: "updater-journal:empty" };
  }
  if (line.op !== "install") {
    return {
      valid: false,
      detail: null,
      invalidReason: `updater-journal:unexpected-op:${String(line.op ?? "missing")}`,
    };
  }
  if (line.result !== "ok") {
    return {
      valid: false,
      detail: null,
      invalidReason: `updater-journal:non-ok:${String(line.result ?? "missing")}`,
    };
  }
  const target = cleanString(line.to, PATH_MAX);
  if (!target) {
    return { valid: false, detail: null, invalidReason: "updater-journal:target-missing" };
  }
  if (!isPlausibleTarget(target)) {
    return { valid: false, detail: null, invalidReason: "updater-journal:target-not-absolute" };
  }
  const installedAt = cleanString(line.ts, TS_MAX) ?? "";
  const backup = cleanString(line.backup, PATH_MAX);
  return {
    valid: true,
    detail: {
      component: basenameOf(target),
      targetDir: target,
      backupDir: backup,
      installedAt,
    },
    invalidReason: null,
  };
}

/**
 * File-backed journal reader: reads the LAST line of the updater's
 * `install-journal.jsonl` (the newest terminal record). Unreadable or
 * empty journal = a failed read, reported as such — never a fabricated
 * valid disposition.
 */
export class FileUpdaterJournal implements UpdaterJournal {
  #readNewest: (component: string) => { ok: boolean; line?: Record<string, unknown> | null; error?: string };

  constructor(readNewest: (component: string) => { ok: boolean; line?: Record<string, unknown> | null; error?: string }) {
    this.#readNewest = readNewest;
  }

  readNewest(component: string): { ok: boolean; line?: Record<string, unknown> | null; error?: string } {
    return this.#readNewest(component);
  }
}

/** Read the newest journal line for a component (the real FS adapter
 * default; callers may supply their own readNewest). */
export function readUpdaterJournal(journalFile: string, _component: string): { ok: boolean; line?: Record<string, unknown> | null; error?: string } {
  let text: string;
  try {
    text = readFileSync(journalFile, "utf8");
  } catch (err) {
    const code = (err as { code?: string }).code ?? "unknown";
    // A never-run updater has no journal: that is "no update to report",
    // a neutral fact, not a failed disposition.
    if (code === "ENOENT") return { ok: false, error: "journal-missing" };
    return { ok: false, error: `journal-unreadable:${code}` };
  }
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, error: "journal-empty" };
  const newest = lines[lines.length - 1];
  try {
    const parsed = JSON.parse(newest);
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "journal-malformed" };
    return { ok: true, line: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "journal-malformed" };
  }
}

/** The recovery lane's public seam: validate a component's updater journal. */
export function readUpdaterDisposition(
  journal: UpdaterJournal,
  component: string,
): UpdaterDisposition {
  const read = journal.readNewest(component);
  if (!read.ok) {
    // A never-run updater (no journal yet) is a neutral, non-degraded fact:
    // there is nothing to validate. Any other read failure is a named
    // invalid disposition.
    if (read.error === "journal-missing") {
      return { valid: false, detail: null, invalidReason: "updater-journal:missing" };
    }
    return {
      valid: false,
      detail: null,
      invalidReason: `updater-journal:${read.error ?? "read-failed"}`,
    };
  }
  return validateUpdaterDisposition(read.line);
}
