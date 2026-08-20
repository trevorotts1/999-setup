# Print the Kaizen memory root using the OpenClaw Master Files decision rule.
#
# Rule: search the real Downloads folder only, depth <= 3, case-insensitive.
#   Count every folder whose name is "OpenClaw Master Files" (a Kaizen
#   subfolder is NOT required for the folder to count).
#   Exactly one match  -> "<match>\Kaizen"
#   Zero or more than one -> "$Downloads\Kaizen"
#
# KAIZEN_DOWNLOADS overrides the real Downloads location (checked first;
# used by the test fixtures). Read-only. Does not create folders.

param()

$ErrorActionPreference = "Stop"

if ($env:KAIZEN_DOWNLOADS) {
  $downloads = $env:KAIZEN_DOWNLOADS
} else {
  # Real Downloads via the shell namespace (respects moved folders and
  # OneDrive redirection). Fall back to the known-folder profile path only
  # when the COM object fails or returns nothing.
  $downloads = $null
  try {
    $downloads = (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path
  } catch {
    $downloads = $null
  }
  if (-not $downloads) {
    $downloads = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
  }
  $downloads = $downloads.TrimEnd('\')
}

if (-not (Test-Path -PathType Container $downloads)) {
  Write-Output (Join-Path $downloads "Kaizen")
  exit 0
}

$matches = New-Object System.Collections.Generic.List[string]

function Walk-Dirs {
  param([string]$Dir, [int]$Depth)
  if ($Depth -gt 3) { return }
  $entries = @(Get-ChildItem -LiteralPath $Dir -Directory -ErrorAction SilentlyContinue)
  foreach ($e in $entries) {
    if ($e.Name.ToLowerInvariant() -eq "openclaw master files") {
      # Count regardless of whether a Kaizen subfolder exists inside.
      if (-not $matches.Contains($e.FullName)) {
        $matches.Add($e.FullName) | Out-Null
      }
      continue
    }
    Walk-Dirs $e.FullName ($Depth + 1)
  }
}

Walk-Dirs $downloads 1

if ($matches.Count -eq 1) {
  Write-Output (Join-Path $matches[0] "Kaizen")
} else {
  Write-Output (Join-Path $downloads "Kaizen")
}
