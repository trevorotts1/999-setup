#!/bin/bash
# fix09-windows-notes.sh — structural checks for the Windows Task Scheduler
# suite. Runs on macOS: does NOT execute PowerShell.
#
# NOTE: PowerShell execution requires a Windows runner — these are structural checks only.

set -u

BASE="$(cd "$(dirname "$0")/.." && pwd -P)"
WINDIR="$BASE/scripts/windows"

pass=0
fail=0

check() {
  local label="$1"
  local condition="$2"
  if [ "$condition" = "0" ]; then
    pass=$((pass + 1))
    echo "PASS: $label"
  else
    fail=$((fail + 1))
    echo "FAIL: $label"
  fi
}

echo "NOTE: PowerShell execution requires a Windows runner — these are structural checks only."

for f in Install-KaizenTask.ps1 Remove-KaizenTask.ps1 Get-KaizenTaskStatus.ps1 Invoke-KaizenCycle.ps1 kaizen-task-self-test.ps1; do
  if [ -f "$WINDIR/$f" ]; then
    check "file exists: $f" 0
  else
    check "file exists: $f" 1
  fi
done

# Each task-suite script declares a param( block.
for f in Install-KaizenTask.ps1 Remove-KaizenTask.ps1 Get-KaizenTaskStatus.ps1 Invoke-KaizenCycle.ps1; do
  if grep -q '^param(' "$WINDIR/$f" 2>/dev/null; then
    check "param( block present: $f" 0
  else
    check "param( block present: $f" 1
  fi
done

# Function names present where the contract requires them.
check "Install-KaizenTask declares Get-SanitizedTaskName" \
  "$(grep -c 'function Get-SanitizedTaskName' "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null | grep -q '^[1-9]' && echo 0 || echo 1)"
check "Install-KaizenTask declares Write-LocalStateAtomic" \
  "$(grep -c 'function Write-LocalStateAtomic' "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null | grep -q '^[1-9]' && echo 0 || echo 1)"
check "Remove-KaizenTask declares Get-SanitizedTaskName" \
  "$(grep -c 'function Get-SanitizedTaskName' "$WINDIR/Remove-KaizenTask.ps1" 2>/dev/null | grep -q '^[1-9]' && echo 0 || echo 1)"
check "Get-KaizenTaskStatus declares Get-SanitizedTaskName" \
  "$(grep -c 'function Get-SanitizedTaskName' "$WINDIR/Get-KaizenTaskStatus.ps1" 2>/dev/null | grep -q '^[1-9]' && echo 0 || echo 1)"
check "Invoke-KaizenCycle declares Write-LocalStateAtomic" \
  "$(grep -c 'function Write-LocalStateAtomic' "$WINDIR/Invoke-KaizenCycle.ps1" 2>/dev/null | grep -q '^[1-9]' && echo 0 || echo 1)"

# Dry-run seam: the KAIZEN_TASK_DRY_RUN literal is present everywhere that mutates.
for f in Install-KaizenTask.ps1 Remove-KaizenTask.ps1; do
  if grep -q 'KAIZEN_TASK_DRY_RUN' "$WINDIR/$f" 2>/dev/null; then
    check "KAIZEN_TASK_DRY_RUN seam present: $f" 0
  else
    check "KAIZEN_TASK_DRY_RUN seam present: $f" 1
  fi
done

# Interval coverage in the installer.
check "daily interval handled" \
  "$(grep -q "'^daily\$'" "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null && echo 0 || echo 1)"
check "weekly interval handled" \
  "$(grep -q "'^weekly\$'" "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null && echo 0 || echo 1)"
check "monthly interval handled" \
  "$(grep -q "'^monthly\$'" "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null && echo 0 || echo 1)"
check "quarterly interval handled" \
  "$(grep -q "'^quarterly\$'" "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null && echo 0 || echo 1)"
check "90days interval handled" \
  "$(grep -q "'^90days\$'" "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null && echo 0 || echo 1)"
check "minutes interval handled" \
  "$(grep -q -F '"/SC", "MINUTE"' "$WINDIR/Install-KaizenTask.ps1" 2>/dev/null && echo 0 || echo 1)"

# Natural-language prompt (macOS parity), never a slash command.
check "cycle runner uses natural-language prompt" \
  "$(grep -q 'Use the kaizen skill' "$WINDIR/Invoke-KaizenCycle.ps1" 2>/dev/null && echo 0 || echo 1)"
check "cycle runner has no slash-command prompt" \
  "$(grep -q '/kaizen run' "$WINDIR/Invoke-KaizenCycle.ps1" 2>/dev/null && echo 1 || echo 0)"

# Truthful exit: the cycle runner mirrors the launcher exit code.
check "cycle runner exits with launcher code" \
  "$(grep -q 'exit \$exitCode' "$WINDIR/Invoke-KaizenCycle.ps1" 2>/dev/null && echo 0 || echo 1)"

# No literal secrets anywhere in the suite.
SECRET_HITS="$(grep -l -E 'AKIA|AIza|ghp_|sk_live_' "$WINDIR"/*.ps1 2>/dev/null || true)"
if [ -z "$SECRET_HITS" ]; then
  check "no literal secret patterns in any PS1" 0
else
  echo "  secret patterns found in: $SECRET_HITS"
  check "no literal secret patterns in any PS1" 1
fi

# Self-test script covers the full suite.
check "self-test references Install-KaizenTask.ps1" \
  "$(grep -q 'Install-KaizenTask.ps1' "$WINDIR/kaizen-task-self-test.ps1" 2>/dev/null && echo 0 || echo 1)"
check "self-test references Remove-KaizenTask.ps1" \
  "$(grep -q 'Remove-KaizenTask.ps1' "$WINDIR/kaizen-task-self-test.ps1" 2>/dev/null && echo 0 || echo 1)"
check "self-test references Get-KaizenTaskStatus.ps1" \
  "$(grep -q 'Get-KaizenTaskStatus.ps1' "$WINDIR/kaizen-task-self-test.ps1" 2>/dev/null && echo 0 || echo 1)"
check "self-test references Invoke-KaizenCycle.ps1" \
  "$(grep -q 'Invoke-KaizenCycle.ps1' "$WINDIR/kaizen-task-self-test.ps1" 2>/dev/null && echo 0 || echo 1)"

echo ""
echo "fix09-windows-notes: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
