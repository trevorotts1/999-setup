# verify-macos.sh CI fixtures (FIX-021)

`verify-macos.sh --ci-root <dir>` provisions this fixture tree into the
scratch HOME/state root and then runs the same verification logic a
provisioned operator Mac runs. `ci-launcher.sh` is the check-4 probe the
verifier executes for `claude-nine`; `ci-router-session.json` is the
well-formed route-state file the verifier mode-checks in the scratch
`Library/Application Support/BlackCEO/999` directory.

Layout the verifier provisions under `<ci-root>`:

```
<ci-root>/.local/bin/claude-nine            # check 4 (executable probe)
<ci-root>/Library/Application Support/BlackCEO/999/router-session.json  # check 6 (mode 600)
```

Checks that cannot be verified in CI (Keychain token, login-shell PATH,
shell-startup-file scan of a real provisioned home) exit 0 as `BLOCKED` with
a machine-readable reason; they are required on a real provisioned Mac and
fail the job there. The release gate (`scripts/candice-release/status.mjs`)
refuses any release evidence that is missing this verifier's BLOCKED rows,
so a runner that cannot run a required check can never look like a runner
that verified it.
