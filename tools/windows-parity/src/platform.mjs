// tools/windows-parity/src/platform.mjs — native cross-platform probes
// WS-27: Windows-native parity for the Spec Protocol deterministic toolset.
// Same output semantics as the Bash instruments; Windows uses native APIs
// ([Environment]::ProcessorCount / CIM / Win32_LogicalDisk) instead of
// sysctl/nproc. Zero dependencies.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { statfsSync } from 'node:fs';

export const IS_WINDOWS = process.platform === 'win32';

export function probeCores() {
  // POSIX: mirrors capacity-resolver.sh measure_cores — sysctl first, nproc
  // second, instrument NAMES itself. Windows: native ProcessorCount API.
  if (IS_WINDOWS) {
    // Use PowerShell [Environment]::ProcessorCount — the documented native
    // replacement for sysctl -n hw.ncpu / nproc. Fall back to os.cpus() if
    // PowerShell itself is unavailable (defensive only; PowerShell is a
    // Windows platform component).
    try {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::ProcessorCount'],
        { encoding: 'utf8', timeout: 20000, windowsHide: true }
      ).trim();
      const n = Number(out);
      if (Number.isInteger(n) && n > 0) return { cores: n, instrument: 'powershell-Environment.ProcessorCount' };
      const c = os.cpus();
      if (c && c.length > 0) return { cores: c.length, instrument: 'node-os.cpus-fallback' };
      return { cores: null, instrument: '' };
    } catch {
      const c = os.cpus();
      if (c && c.length > 0) return { cores: c.length, instrument: 'node-os.cpus-fallback' };
      return { cores: null, instrument: '' };
    }
  }
  try {
    const n = Number(execFileSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' }).trim());
    if (Number.isInteger(n) && n > 0) return { cores: n, instrument: 'sysctl-hw.ncpu' };
  } catch { /* fall through */ }
  try {
    const n = Number(execFileSync('nproc', [], { encoding: 'utf8' }).trim());
    if (Number.isInteger(n) && n > 0) return { cores: n, instrument: 'nproc' };
  } catch { /* fall through */ }
  return { cores: null, instrument: '' };
}

export function probeRamBytes() {
  if (IS_WINDOWS) {
    try {
      // Get-CimInstance Win32_ComputerSystem TotalPhysicalMemory — the
      // spec-named native Windows RAM probe.
      const ps = [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory'
      ];
      const out = execFileSync('powershell.exe', ps, { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
      const n = Number(out);
      if (Number.isInteger(n) && n > 0) return { bytes: n, instrument: 'cim-Win32_ComputerSystem.TotalPhysicalMemory' };
    } catch { /* fall through to os.totalmem */ }
    const n = os.totalmem();
    if (n > 0) return { bytes: n, instrument: 'node-ostotalmem-fallback' };
    return { bytes: null, source: '' };
  }
  try {
    const n = Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim());
    if (Number.isInteger(n) && n > 0) return { bytes: n, instrument: 'sysctl-hw.memsize' };
  } catch { /* fall through */ }
  const n = os.totalmem();
  if (n > 0) return { bytes: n, instrument: 'node-ostotalmem-fallback' };
  return { bytes: null, instrument: '' };
}

// Free disk on the volume containing dir (bytes). Windows: Win32_LogicalDisk
// free space; POSIX: statvfs. Never throws — null on undetermined.
export function probeFreeDisk(dir) {
  if (IS_WINDOWS) {
    try {
      const drive = path.parse(dir).root || process.env.SystemDrive || 'C:';
      const ps = [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive.replace(/\\$/, '')}'" | Select-Object -ExpandProperty FreeSpace`
      ];
      const out = execFileSync('powershell.exe', ps, { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
      const n = Number(out);
      if (Number.isInteger(n) && n > 0) return { bytes: n, instrument: `cim-Win32_LogicalDisk.${drive}` };
    } catch { /* fall through */ }
    return null;
  }
  try {
    const st = statfsSync(dir);
    return { bytes: st.bavail * st.bsize, instrument: 'statvfs' };
  } catch {
    return null;
  }
}

export function tempDir() {
  return IS_WINDOWS ? (process.env.TEMP || process.env.TMP || os.tmpdir()) : (process.env.TMPDIR || '/tmp');
}

export function homeDir() {
  // Windows: USERPROFILE (Known-Folder equivalent); never hardcode C:\Users\*.
  return IS_WINDOWS ? (process.env.USERPROFILE || os.homedir()) : (process.env.HOME || os.homedir());
}

export function userPath(kind) {
  // Windows Known Folder resolution via the .NET API (spec 0.3: user paths via
  // Windows Known Folders / .NET folder APIs, not hardcoded paths).
  if (!IS_WINDOWS) {
    switch (kind) {
      case 'Documents': return path.join(homeDir(), 'Documents');
      case 'LocalApplicationData': return path.join(homeDir(), '.local', 'share');
      case 'Temp': return tempDir();
      default: return homeDir();
    }
  }
  const folder = ['Documents', 'LocalApplicationData', 'MyDocuments'].includes(kind) ? kind : 'LocalApplicationData';
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `[Environment]::GetFolderPath('${folder}')`],
      { encoding: 'utf8', timeout: 20000, windowsHide: true }
    ).trim();
    if (out && out !== '') return out;
  } catch { /* fall through */ }
  if (kind === 'Documents' || kind === 'MyDocuments') return path.join(homeDir(), 'Documents');
  if (kind === 'Temp') return tempDir();
  return homeDir();
}

export function shellForWindows() {
  // Probe the live Windows shell set. Returns a matrix with booleans:
  // powershell51 (Windows PowerShell 5.1 — always present on Windows 10/11),
  // powershell7 (pwsh), cmd (always present).
  if (!IS_WINDOWS) {
    return { powershell51: false, powershell7: false, cmd: false, live: false };
  }
  const res = { powershell51: false, powershell7: false, cmd: true, live: true };
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { timeout: 15000, windowsHide: true, stdio: 'ignore' });
    res.powershell51 = true;
  } catch { res.powershell51 = false; }
  try {
    execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { timeout: 15000, windowsHide: true, stdio: 'ignore' });
    res.powershell7 = true;
  } catch { res.powershell7 = false; }
  try {
    execFileSync('cmd.exe', ['/c', 'exit 0'], { timeout: 15000, windowsHide: true, stdio: 'ignore' });
    res.cmd = true;
  } catch { res.cmd = false; }
  return res;
}

export function commandOnPath(name) {
  // Command discovery parity: `where` on Windows, `command -v`/`which` on
  // POSIX. Returns first found path or null.
  if (IS_WINDOWS) {
    try {
      const out = execFileSync('where.exe', [name], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      const line = out.split(/\r?\n/).map(s => s.trim()).find(Boolean);
      return line || null;
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync('which', [name], { encoding: 'utf8', timeout: 5000 });
    const line = out.trim();
    return line || null;
  } catch {
    return null;
  }
}
