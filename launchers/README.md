# Desktop launchers for the standalone Council service (WER-021 companion)

Two native launchers, one behaviour contract. They start or reuse the
standalone Council service, print the **verified** session URL, and open the
system browser. They never require Command Center or Vercel, and they never
register a system service.

| Platform | Launcher |
|---|---|
| macOS | `launchers/macos/blackceo-council-desktop` |
| Windows | `launchers/windows/blackceo-council-desktop.cmd` → `blackceo-council-desktop.mjs` |

## Service contract (owned by the runtime, not by these launchers)

```
GET http://127.0.0.1:<port>/api/health
  -> 200 {"service":"council","sessionUrl":"<absolute http(s) URL>"}
```

Only a `200` payload with `service === "council"` and an absolute `http(s)`
`sessionUrl` counts as a **verified matching** service. Anything else that
answers on the port is an unrelated listener.

Default port: `4179` (`BLACKCEO_COUNCIL_PORT` overrides it).

## Behaviour (identical on both platforms)

1. **Reuse** — a verified matching service is reused; the launcher does not
   start a second one.
2. **Start** — when nothing is listening, the launcher runs
   `node <profile>/runtime/current/run-council.mjs serve --host 127.0.0.1 --port N`
   and waits for readiness.
3. **Refuse** — when the port has a listener that is not a council service,
   the launcher prints the port and, when available, the listener pid, then
   exits `3`. It **never signals or kills** that process.
4. **URL survives a failed browser open** — `COUNCIL_SESSION_URL=<url>` is
   printed *before* any browser attempt. If the browser cannot open, a
   warning is printed and the URL remains usable.
5. **`--print-command`** — emits `COUNCIL_LAUNCH_COMMAND` and
   `COUNCIL_READINESS_CHECK` and exits without launching. System-service
   registration (launchd, Windows service, Task Scheduler) is **out of
   scope**; only the command and the readiness check are emitted.

Exit codes: `0` URL delivered, `2` usage, `3` unrelated listener (not
killed), `4` runtime/Node missing, `5` service not ready, `6` no verified
session URL.

## Platform notes

- macOS uses `curl` for the probe and `open` for the browser. The launch
  command reuses the profile/`current` layout of
  `launchers/macos/blackceo-council` (merged WER-004 path), which is not
  modified by this slice.
- Windows resolves Node.js with the native `where` search (native executable
  or `.cmd`/`.bat` shim), starts native executables directly and runs shims
  through `cmd.exe /d /s /c`, opens the browser through Windows PowerShell
  (`Start-Process`) with `cmd.exe start` as fallback, and quotes every path.
  It assumes no POSIX shell, no WSL, no shebang and no link/junction.

## Tests

```
launchers/tests/test-council-desktop-macos.sh
launchers/tests/test-council-desktop-windows.sh
```

Both follow the repository's `test-*.sh` PASS/FAIL convention and exit
nonzero on failure. The Windows test is a **simulation**: it exercises the
production `.mjs` path/command/classification functions on this host. It is
not native Windows host execution.

## Deferred (never claimed as passed)

- Native Windows host execution of the `.cmd` shim — deferred to WER-027.
- A real browser window opening — deferred to WER-027 (tests use a failing
  opener and a dummy listener).
- A registered system service (launchd, Windows service, Task Scheduler) —
  explicitly out of scope.
- An end-to-end live Council session — the service lands in WER-021; these
  launchers are tested against stub listeners that speak its contract.
