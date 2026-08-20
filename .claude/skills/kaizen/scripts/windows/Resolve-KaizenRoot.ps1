# Print the Kaizen memory root using the OpenClaw Master Files decision rule.
#
# Rule: search the Downloads folder only, depth <= 3, case-insensitive.
#   Exactly one "OpenClaw Master Files" folder containing "Kaizen" -> print it.
#   Zero or more than one -> "$Downloads\Kaizen".
#
# Read-only. Does not create folders.

param()

$ErrorActionPreference = "Stop"

$downloads = if ($env:KAIZEN_DOWNLOADS) { $env:KAIZEN_DOWNLOADS }
             else { Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads" }

if (-not (Test-Path -PathType Container $downloads)) {
  Write-Output (Join-Path $downloads "Kaizen")
  exit 0
}

$candidates = New-Object System.Collections.Generic.List[string]

function Walk-Dirs {
  param([string]$Dir, [int]$Depth)
  if ($Depth -gt 3) { return }
  $entries = @(Get-ChildItem -LiteralPath $Dir -Directory -ErrorAction SilentlyContinue)
  foreach ($e in $entries) {
    if ($e.Name.ToLowerInvariant() -eq "openclaw master files") {
      $kaizenInside = Join-Path $e.FullName "Kaizen"
      if (Test-Path -PathType Container $kaizenInside) {
        if (-not $candidates.Contains($kaizenInside)) {
          $candidates.Add($kaizenInside) | Out-Null
        }
      }
      continue
    }
    Walk-Dirs $e.FullName ($Depth + 1)
  }
}

Walk-Dirs $downloads 1

if ($candidates.Count -eq 1) {
  Write-Output $candidates[0]
} else {
  Write-Output (Join-Path $downloads "Kaizen")
}
