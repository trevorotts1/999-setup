#!/bin/bash
# NHL001: locked Keychain -> file token fallback; guards find a Homebrew-prefix install. Fake HOME + fake `security`/`npm`.
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME" "$T/bin"
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

# locked keychain: every `security` call fails like SSH (rc 36)
printf '#!/bin/sh\necho "User interaction is not allowed." >&2\nexit 36\n' >"$T/bin/security"; chmod +x "$T/bin/security"
P="$S/scripts/macos/protect-local-state.sh"
out="$(PATH="$T/bin:$PATH" bash "$P" set-token SECRET123 2>&1)"; rc=$?
[ $rc -eq 0 ] && ok "set-token exits 0 with locked Keychain" || bad "set-token rc=$rc"
[ "$(cat "$HOME/.9router/gateway-key")" = "SECRET123" ] && ok "file token written" || bad "file token"
[ "$(stat -f %Lp "$HOME/.9router/gateway-key" 2>/dev/null || stat -c %a "$HOME/.9router/gateway-key")" = "600" ] && ok "file mode 600" || bad "file mode"
case "$out" in *SECRET123*) bad "token printed" ;; *) ok "token never printed" ;; esac
[ "$(printf '%s' "$out" | grep -c 'Keychain unavailable')" = 1 ] && ok "one clear log line" || bad "log line"
[ "$(PATH="$T/bin:$PATH" bash "$P" get-token 2>/dev/null)" = "SECRET123" ] && ok "get-token falls back to file" || bad "get-token"
PATH="$T/bin:$PATH" bash "$P" ensure-600 >/dev/null 2>&1 && ok "ensure-600 continues" || bad "ensure-600"

# guards: Homebrew-style prefix found with no ~/.npm-global install and no arg
mkdir -p "$T/brew/lib/node_modules/9router/app/.next-cli-build"; echo '{}' >"$T/brew/lib/node_modules/9router/package.json"
printf '#!/bin/sh\n[ "$1 $2" = "root -g" ] && echo "%s"\n' "$T/brew/lib/node_modules" >"$T/bin/npm"; chmod +x "$T/bin/npm"
for g in 9router-glm53-thinking-guard.sh 9router-opencode-poll-guard.sh; do
  o="$(PATH="$T/bin:$PATH" NINE_KNOWN_PREFIXES="$T/none" bash "$S/assets/guards/$g" --check 2>&1)"
  case "$o" in *"build dir not found at $HOME/.npm-global"*) bad "$g used npm-global default" ;; *) ok "$g resolved via npm root -g" ;; esac
done
# known-prefix fallback (npm absent from list)
rm "$T/bin/npm"
o="$(PATH="/usr/bin:/bin" NINE_KNOWN_PREFIXES="$T/nope $T/brew/lib/node_modules" bash "$S/assets/guards/9router-glm53-thinking-guard.sh" --check 2>&1)"
case "$o" in *"$HOME/.npm-global"*) bad "known-prefix fallback" ;; *) ok "known-prefix list finds install" ;; esac
exit $fail
