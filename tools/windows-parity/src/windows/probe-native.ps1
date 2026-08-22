# tools/windows-parity/src/windows/probe-native.ps1 — WS-27 native Windows probe
#
# Spec 0.3 P0 requirement: Windows capacity/state probes must use native
# Windows APIs/tools, never sysctl/nproc. This script is the native probe
# surface consumed by the node parity tools on Windows; it is also
# independently runnable (and is exercised by the shell-compat suite).
#
# REQUIRES: Windows PowerShell 5.1 or PowerShell 7.
# READS ONLY. Prints one KEY=VALUE block per probe; VALUES ARE NUMBERS AND
# PATH STRINGS ONLY — never secrets.
#
# Probes:
#   CORES    = [Environment]::ProcessorCount     (native logical processors)
#   RAM      = Get-CimInstance Win32_ComputerSystem TotalPhysicalMemory
#   DISK     = Get-CimInstance Win32_LogicalDisk free space (SystemDrive)
#   DOCS     = [Environment]::GetFolderPath('MyDocuments')
#   LOCALAPP = [Environment]::GetFolderPath('LocalApplicationData')
#   TEMP     = [System.IO.Path]::GetTempPath()
#   PSMAJOR  = $PSVersionTable.PSVersion.Major   (5 or 7 — native PS version)
#
# Exit: 0 all probes answered; 1 any probe failed (nothing is assumed).

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
function Probe([string]$key, [scriptblock]$block) {
    try {
        $v = & $block
        if ($null -eq $v) { throw "$key probe returned null" }
        Write-Output "$key=$v"
    } catch {
        Write-Error "PROBE FAILED $key : $($_.Exception.Message)"
        exit 1
    }
}

Probe 'CORES'      { [Environment]::ProcessorCount }
Probe 'RAM'        { (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory }
Probe 'DISK'       { (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'").FreeSpace }
Probe 'DOCS'       { [Environment]::GetFolderPath('MyDocuments') }
Probe 'LOCALAPP'   { [Environment]::GetFolderPath('LocalApplicationData') }
Probe 'TEMP'       { [System.IO.Path]::GetTempPath() }
Probe 'WMAJOR'     { $PSVersionTable.PSVersion.Major }

exit 0
