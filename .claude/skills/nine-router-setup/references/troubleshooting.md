# Troubleshooting

## Principles

- Self-repair ordinary failures and retry before escalating.
- Report exactly one precise blocker with the user action required only when automation
  cannot safely continue.
- Never print keys. Name providers and HTTP status codes only.
- An exit code of 127 is a shell abort (unresolvable command/interpreter), **not** a fact
  about the system. `grep` rc≥2 is an error (missing file), not zero matches. Capture
  stderr and check `$?` with `set -o pipefail`.

## Common failures

| Symptom | Likely cause | Repair |
|---|---|---|
| 9Router not ready | still starting | wait/retry health with bounded backoff |
| `claude-nine` missing from PATH | launcher not installed / PATH not refreshed | reinstall launcher; refresh PATH in current process/shell |
| `claude-nine` starts but routes absent | protected routed-session state stale | rebuild session state from validated 9Router/provider configuration |
| Duplicate provider on rerun | non-idempotent create | reuse/update existing record |
| Model ID changed | catalog drift | refresh live model catalog; resolve exact current ID |
| Max reasoning rejected | provider doesn't support it | downgrade only that route to highest verified effort; report |
| Port 20128 occupied | another 9Router or app | verify an existing healthy 9Router owns it before acting |
| `API docs.md` missing | not created yet | tell the user the exact OS-resolved Documents path and required template |
| Credential invalid | bad key | name only the failing provider; never print the key |
| Plain `claude` shows router errors | routing leaked globally | verify no `ANTHROPIC_BASE_URL` persisted; this repo never writes it globally |
| Ollama concurrency rejections | budget overrun | honor the plan budget (free→1, pro→2, max→8); no third Ollama panel on Pro |

## Windows-specific

| Symptom | Likely cause | Repair |
|---|---|---|
| Tool not found after WinGet | PATH not refreshed | refresh Machine + User PATH in the current process and retry |
| `git` missing | not installed | `winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements`, refresh PATH, retry clone |
| DPAPI/local state unreadable | state material missing/corrupt | rebuild current-user protected state from the authenticated local 9Router configuration |
| `claude-nine` not callable from CMD | PATH entry missing | reinstall launcher; verify PATH |

## macOS-specific

| Symptom | Likely cause | Repair |
|---|---|---|
| `claude` not on PATH after install | installed to `~/.local/bin` | check `~/.local/bin/claude`; update current shell PATH or managed profile block; retry |
| Git/Xcode tools absent | no CLI tools | use the public GitHub branch archive with `curl` + `tar`; do not force Xcode/Homebrew |
| Documents access `Operation not permitted` | TCC denied | grant the current Terminal/Claude Code process access to Documents in Privacy & Security, then retry |
| Node download checksum mismatch | corrupted/incomplete download | delete the download and stop; never extract it |
| Keychain item missing | removed/never created | recreate only the local 9Router token item from validated local 9Router state; never store provider keys there |
| Keychain access denied by user | user declined | stop with the exact Keychain permission blocker; do not fall back to plaintext token storage |
| Shell profile read-only/managed externally | MDM or manual management | do not overwrite; install the launcher and tell the user the one PATH line to add manually |

## Guardrail honesty

`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` limits Claude Code's read-only tools/subagents; it is
**not** a complete provider-level semaphore for every request generated internally by
9Router. Do not claim it is a full Ollama concurrency limiter.

## Verification gotchas (from live operation)

- Probe with `max_tokens` ≥ 1500 when testing a thinking model; a low value is consumed by
  thinking tokens and a healthy model returns zero text.
- 9Router can emit two response shapes: SSE, and plain JSON followed by a trailing
  `data: [DONE]` (DeepSeek Direct). Handle both when parsing.
- A per-connection backoff can keep returning an old error for a few minutes after a correct
  fix. Wait it out and re-probe.
- "Alive but not listening": the router process survives but the HTTP listener dies. Diagnose
  by socket, not process.
- Check `api/status` before assuming login is needed; a healthy existing install with a
  changed password must not be reset destructively.
