# Get-ApiDocs.ps1 - resolve the real Documents folder and locate API docs.md.
# Outputs the path on success, or a precise blocker. Never prints contents.
#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Resolve-DocumentsFolder {
    $docs = [Environment]::GetFolderPath('MyDocuments')
    if (-not $docs -or -not (Test-Path $docs)) {
        throw "Cannot resolve the Documents folder (MyDocuments)."
    }
    return $docs
}

try {
    $docs = Resolve-DocumentsFolder
    $cred = Join-Path $docs 'API docs.md'
    if (-not (Test-Path $cred)) {
        Write-Error @"
MISSING: $cred
Create a file named exactly 'API docs.md' in your Documents folder with this template:
  OLLAMA_API_KEY=replace_with_real_key
  DEEPSEEK_API_KEY=replace_with_real_key
  AGNES_API_KEY=replace_with_real_key
  OLLAMA_PLAN=pro
  AGNES_PLAN=starter
"@
        exit 1
    }
    # Tighten ACLs so only the current user can read it (best-effort, current-user only).
    try {
        $acl = Get-Acl -Path $cred
        $acl.SetAccessRuleProtection($true, $true)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "$env:USERDOMAIN\$env:USERNAME", 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -Path $cred -AclObject $acl
    } catch {
        # Best-effort; never fail setup over ACL tightening.
    }
    Write-Output $cred
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
