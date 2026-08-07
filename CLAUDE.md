# Repository rules

This repository provisions a local **9Router** gateway on native **Windows** and **macOS
(Apple Silicon)**, and a `claude-nine` command that routes Claude Code through it while
leaving plain `claude` unchanged.

## Non-negotiable rules

1. **Detect the native OS before selecting any platform script.** Windows → native Windows;
   macOS → `uname -s` = `Darwin`; anything else → stop as unsupported. Never infer the OS
   only from the current shell (PowerShell exists on macOS; Bash exists on Windows).
2. **Use the bundled deterministic scripts** (`setup-windows.ps1` / `setup-macos.sh` and the
   helpers under `scripts/`) instead of improvising shell commands.
3. **Keep platform logic in the platform branch.** Windows-only work lives in the Windows
   branch; macOS-only work lives in the macOS branch. After Node.js is available, prefer the
   shared Node.js helpers under `scripts/common/` for provider/routing behavior.
4. **Never expose secrets.** Never print, log, or commit API keys, local router tokens, or
   passwords. Keep credentials in memory during setup only. Mask diagnostics to at most the
   first 3 and last 3 characters.
5. **Never commit `API docs.md` or any `.env`** containing real values. The template in
   `templates/` contains placeholders only.
6. **Never downgrade provider/model IDs silently.** If a required model is absent from the
   live provider catalog, stop that provider configuration with a precise error.
7. **Use live provider model discovery.** Query the live provider catalog
   (`https://ollama.com/api/tags`, DeepSeek `/models`, Agnes `/models` or a tiny probe) rather
   than trusting a static list.
8. **Use the 9Router management API**, not direct edits to 9Router's persistence database.
9. **Plain `claude` must remain non-routed.** Only `claude-nine` activates 9Router routing,
   and only in the routed child-process environment — never globally.
10. **`claude-nine` must reuse the same Claude config root and personal skills** as plain
    `claude`. Never set a separate `CLAUDE_CONFIG_DIR`.
11. **Do not make Homebrew a macOS prerequisite.** Use built-in POSIX tooling and official
    vendor downloads. Do not require Xcode Command Line Tools merely for the bootstrap.
12. **Do not bypass macOS privacy controls** (TCC). If Documents access is denied, stop with
    the precise grant instruction.
13. **Setup is not complete until the platform and shared smoke tests pass.**
14. **PDF and audio auto-routing must remain disabled** unless verified end-to-end.
15. **DeepSeek Direct Flash is the default Flash route.** The Ollama Cloud
    `deepseek-v4-flash:0731` variant is an explicit override (`DEEPSEEK_FLASH_VARIANT=ollama-0731`)
    only, and enabling it recalculates Ollama concurrency safety.
16. **Do not modify 9Router's persistence database directly.**
