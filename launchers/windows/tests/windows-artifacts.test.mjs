// WER-027 (Windows half B): STATIC verification of the Windows launch and
// install artifacts in launchers/windows/ and
// scripts/council-runtime-install.ps1.
//
// These tests read bytes on this host. There is no Windows host and no
// PowerShell here, so NOTHING in this file proves that a script parses,
// starts, installs or runs on Windows. It proves only the properties that a
// byte reader can decide:
//
//   - encoding intent: pure ASCII, no UTF-8 BOM, and CRLF in .cmd files
//     (a BOM-less .ps1 is decoded as ANSI by Windows PowerShell 5.1, so a
//     non-ASCII byte silently corrupts; cmd.exe's label parser expects CRLF);
//   - no shebang, no POSIX path, no WSL/bash, no symlink call;
//   - every variable expansion passed to a native program is quoted, in both
//     the PowerShell launchers and the CMD shims;
//   - no machine-wide execution-policy change and no machine-wide registry
//     write; the only Path write targets the current user;
//   - the Node prerequisite is resolved and probed before any write, and the
//     failure path exits non-zero with a readable message;
//   - PowerShell lexical balance (quotes, here-strings absent, braces), which
//     is a lexical check, not a parser.
//
// Run: node --test launchers/windows/tests/windows-artifacts.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const windowsDir = path.join(repoRoot, 'launchers', 'windows');
const installScript = path.join(repoRoot, 'scripts', 'council-runtime-install.ps1');

const CMD_FILES = [
  'launchers/windows/blackceo-council.cmd',
  'launchers/windows/claude-nine.cmd',
  'launchers/windows/blackceo-council-desktop.cmd'
];
const PS1_FILES = [
  'launchers/windows/blackceo-council.ps1',
  'launchers/windows/claude-nine.ps1'
];
const WINDOWS_FILES = [
  ...CMD_FILES,
  ...PS1_FILES,
  'launchers/windows/blackceo-council-desktop.mjs'
];
const ALL_FILES = [...WINDOWS_FILES, 'scripts/council-runtime-install.ps1'];

function bytes(rel) {
  return fs.readFileSync(path.join(repoRoot, rel));
}
function text(rel) {
  return bytes(rel).toString('utf8');
}
function codeLines(source) {
  // Drop full-line comments so a comment that names a forbidden construct
  // (for example "no WSL here") does not read as that construct.
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) return false;
      if (/^REM\b/i.test(trimmed)) return false;
      return true;
    })
    .join('\n');
}
function logicalLines(source) {
  const out = [];
  let pending = '';
  for (const raw of source.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.endsWith('`')) {
      pending += line.slice(0, -1) + ' ';
      continue;
    }
    out.push(pending + line);
    pending = '';
  }
  if (pending) out.push(pending);
  return out;
}
function tokensOf(body) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

// --- encoding -------------------------------------------------------------

test('every Windows artifact is pure ASCII with no UTF-8 BOM', () => {
  for (const rel of ALL_FILES) {
    const buf = bytes(rel);
    assert.ok(
      !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf),
      `${rel} must not start with a UTF-8 BOM (documented intent: no BOM)`
    );
    for (let i = 0; i < buf.length; i += 1) {
      assert.ok(buf[i] < 0x80, `${rel} has a non-ASCII byte 0x${buf[i].toString(16)} at offset ${i}`);
    }
  }
});

test('every .cmd file uses CRLF line endings and no lone LF', () => {
  for (const rel of CMD_FILES) {
    const buf = bytes(rel).toString('latin1');
    assert.ok(!/(^|[^\r])\n/.test(buf), `${rel} must use CRLF line endings (cmd.exe label parser)`);
    assert.ok(buf.includes('\r\n'), `${rel} must contain CRLF line endings`);
  }
});

test('documented PowerShell 5.1 encoding claim matches the bytes', () => {
  for (const rel of [...PS1_FILES, 'scripts/council-runtime-install.ps1']) {
    const source = text(rel);
    assert.match(
      source,
      /ENCODING: pure ASCII, no UTF-8 BOM/,
      `${rel} must document the pure-ASCII, no-BOM intent it is checked against`
    );
  }
});

// --- POSIX-only constructs -------------------------------------------------

test('no shebang line and no POSIX-only construct in the Windows path', () => {
  const forbidden = [
    [/^#!/, 'shebang line'],
    [/\/usr\//, '/usr/ path'],
    [/\/bin\/(?:sh|bash|zsh)/, '/bin shell path'],
    [/\bbash\b/i, 'bash'],
    [/\bzsh\b/i, 'zsh'],
    [/\bwsl(?:\.exe)?\b/i, 'WSL'],
    [/\bln\s+-s\b/, 'ln -s'],
    [/SymbolicLink/i, 'symlink API'],
    [/\bmkfifo\b/, 'mkfifo']
  ];
  for (const rel of ALL_FILES) {
    const source = codeLines(text(rel));
    for (const [pattern, name] of forbidden) {
      assert.ok(!pattern.test(source), `${rel} must not use ${name}`);
    }
  }
});

test('the router swap uses a native Windows junction, not a symlink', () => {
  const source = text('scripts/council-runtime-install.ps1');
  assert.match(source, /New-Item -ItemType Junction/, 'the native junction creation must stay');
  assert.ok(!/ItemType\s+SymbolicLink/.test(source), 'no symlink item type');
});

// --- quoting ---------------------------------------------------------------

test('every expansion passed to a native program in PowerShell is quoted', () => {
  for (const rel of [...PS1_FILES, 'scripts/council-runtime-install.ps1']) {
    for (const line of logicalLines(text(rel))) {
      const trimmed = line.trim();
      if (trimmed.startsWith('& ')) {
        const tokens = tokensOf(trimmed.slice(2));
        for (const token of tokens) {
          if (token.startsWith('@')) continue; // splat is not a string argument
          if (token.startsWith('"')) continue;
          assert.ok(
            !token.includes('$'),
            `${rel}: unquoted expansion "${token}" in native call: ${trimmed}`
          );
        }
      } else if (trimmed.startsWith('Start-Process ')) {
        const tokens = tokensOf(trimmed.slice('Start-Process '.length));
        const index = tokens.indexOf('-FilePath');
        if (index !== -1) {
          const value = tokens[index + 1] || '';
          assert.ok(
            !value.includes('$') || value.startsWith('"'),
            `${rel}: Start-Process -FilePath expansion must be quoted: ${trimmed}`
          );
        }
      }
    }
  }
});

test('the CMD shims quote every path expansion they pass to a program', () => {
  for (const rel of CMD_FILES) {
    const source = text(rel);
    for (const name of ['%NODE_EXE%', '%PS1%', '%SCRIPT_DIR%', '%~dp0']) {
      let from = 0;
      while (true) {
        const at = source.indexOf(name, from);
        if (at === -1) break;
        from = at + name.length;
        const lineStart = source.lastIndexOf('\n', at) + 1;
        const lineEnd = source.indexOf('\n', at);
        const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
        assert.ok(
          line.includes('"'),
          `${rel}: ${name} appears on a line with no quoting: ${line.trim()}`
        );
        const before = source.lastIndexOf('"', at);
        const after = source.indexOf('"', at + name.length);
        assert.ok(
          before >= lineStart && after !== -1,
          `${rel}: ${name} must sit inside double quotes: ${line.trim()}`
        );
      }
    }
  }
});

test('the CMD shims keep %* unquoted and forward it to the script', () => {
  for (const rel of CMD_FILES.filter((f) => f !== 'launchers/windows/blackceo-council-desktop.cmd')) {
    assert.match(text(rel), /-File "%PS1%" %\*/, `${rel} must forward arguments with an unquoted %*`);
  }
});

// --- execution policy and registry ----------------------------------------

test('the CMD shims bypass the execution policy for this process only', () => {
  for (const rel of CMD_FILES.filter((f) => f !== 'launchers/windows/blackceo-council-desktop.cmd')) {
    const source = text(rel);
    assert.match(
      source,
      /powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %\*/,
      `${rel} must invoke PowerShell with a per-process bypass and -File`
    );
    for (const line of source.split('\n')) {
      if (!/ExecutionPolicy/i.test(line)) continue;
      assert.match(line, /-ExecutionPolicy Bypass/, `${rel}: execution-policy scope must be the CLI flag`);
      assert.ok(!/-Scope\b/.test(line), `${rel}: no -Scope on the execution-policy flag`);
    }
  }
});

test('no machine-wide execution-policy or registry write exists anywhere', () => {
  for (const rel of ALL_FILES) {
    const source = codeLines(text(rel));
    assert.ok(!/Set-ExecutionPolicy/i.test(source), `${rel} must not call Set-ExecutionPolicy`);
    assert.ok(!/LocalMachine/i.test(source), `${rel} must not reference LocalMachine`);
    assert.ok(!/HKEY_LOCAL_MACHINE|\bHKLM\b/i.test(source), `${rel} must not write HKLM`);
    assert.ok(!/\breg(?:\.exe)?\s+add\b/i.test(source), `${rel} must not call reg add`);
    assert.ok(!/Set-ItemProperty|New-ItemProperty/i.test(source), `${rel} must not write registry properties`);
    assert.ok(!/['"]Machine['"]/.test(source), `${rel} must not target the Machine environment scope`);
  }
});

test('the only environment write targets the current user', () => {
  const source = text('scripts/council-runtime-install.ps1');
  const calls = source.match(/SetEnvironmentVariable\([^\n]*\)/g) || [];
  assert.ok(calls.length > 0, 'the installer must add its bin directory to PATH');
  for (const call of calls) {
    assert.match(call, /,\s*'User'\)/, `expected a current-user scope: ${call}`);
  }
});

// --- destructive operations ------------------------------------------------

test('no rm -rf and no delete of a filesystem root', () => {
  for (const rel of ALL_FILES) {
    const source = codeLines(text(rel));
    assert.ok(!/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i.test(source), `${rel} must not use rm -rf`);
    assert.ok(!/\brd\s+\/s\s+\/q\s+[A-Za-z]:\\?\s*$/m.test(source), `${rel} must not delete a drive root`);
    assert.ok(!/Remove-Item[^\n]*['"]C:\\?['"]/.test(source), `${rel} must not delete C:\\`);
  }
});

// --- prerequisite ordering and failure behaviour ---------------------------

test('Node is resolved and probed before the first write in the installer', () => {
  const source = text('scripts/council-runtime-install.ps1');
  const resolveAt = source.indexOf('$nodeExe = Resolve-NodeExe');
  assert.ok(resolveAt !== -1, 'the installer must resolve Node through the fixed search order');
  const firstWrite = source.search(
    /\b(?:New-Item|Copy-Item|Set-Content|Add-Content|Move-Item|Remove-Item|Out-File)\b|\[System\.IO\.File\]::WriteAllText/
  );
  assert.ok(firstWrite !== -1, 'the installer must eventually write something');
  assert.ok(
    resolveAt < firstWrite,
    'the Node prerequisite must be checked before anything is written or removed'
  );
  assert.match(source, /COUNCIL_NODE_MISSING/, 'the missing-Node failure must be named');
  assert.ok(!/Get-Command node\b/.test(source), 'Node must not be resolved by a bare PATH lookup');
});

test('the fixed Node search order is script directory, PATH, then install roots', () => {
  for (const rel of [...PS1_FILES, 'scripts/council-runtime-install.ps1']) {
    const source = text(rel);
    const ownDir = rel.startsWith('scripts/')
      ? source.indexOf("Join-Path $ScriptDir 'node.exe'")
      : source.indexOf("Join-Path $PSScriptRoot 'node.exe'");
    const pathEntries = source.indexOf("$env:PATH -split ';'");
    const programFiles = source.indexOf("'nodejs\\node.exe'");
    const localAppData = source.indexOf("'Programs\\nodejs\\node.exe'");
    assert.ok(ownDir !== -1, `${rel}: the script's own directory must be searched first`);
    assert.ok(pathEntries !== -1, `${rel}: PATH entries must be searched`);
    assert.ok(programFiles !== -1, `${rel}: per-machine install roots must be searched`);
    assert.ok(localAppData !== -1, `${rel}: per-user install roots must be searched`);
    assert.ok(ownDir < pathEntries, `${rel}: own directory must precede PATH`);
    assert.ok(pathEntries < programFiles, `${rel}: PATH must precede the install roots`);
    assert.ok(programFiles < localAppData, `${rel}: per-machine roots must precede per-user roots`);
  }
});

test('a failed launch is loud and non-zero, never a silent window close', () => {
  for (const rel of CMD_FILES) {
    const source = text(rel);
    assert.match(source, /set "RC=%ERRORLEVEL%"/, `${rel} must capture the child exit code`);
    assert.match(source, /exit \/b %RC%/, `${rel} must return the child exit code`);
    assert.match(source, /1>&2/, `${rel} must write its failure to stderr`);
    assert.match(source, /launch failed with exit code/, `${rel} must print a readable failure message`);
  }
  for (const rel of [...CMD_FILES.filter((f) => f !== 'launchers/windows/blackceo-council-desktop.cmd')]) {
    assert.match(text(rel), /pause/, `${rel} must pause for a double-click launch so the message stays visible`);
    assert.match(text(rel), /BLACKCEO_LAUNCHER_NO_PAUSE/, `${rel} must offer an opt-out for automated callers`);
  }
});

// --- PowerShell lexical balance -------------------------------------------

test('PowerShell artifacts have balanced braces and closed strings', () => {
  for (const rel of [...PS1_FILES, 'scripts/council-runtime-install.ps1']) {
    assertLexicallyBalanced(text(rel), rel);
  }
});

function assertLexicallyBalanced(source, rel) {
  let braces = 0;
  let single = false;
  let double = false;
  let blockComment = false;
  let line = 1;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '\n') line += 1;
    if (blockComment) {
      if (ch === '#' && next === '#') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (single) {
      if (ch === "'") {
        if (next === "'") i += 1;
        else single = false;
      }
      continue;
    }
    if (double) {
      if (ch === '`') i += 1;
      else if (ch === '"') {
        if (next === '"') i += 1;
        else double = false;
      }
      continue;
    }
    if (ch === '<' && next === '#') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') i += 1;
      line += 1;
      continue;
    }
    if (ch === '$' && next === '{') {
      // ${env:ProgramFiles(x86)} is a variable, not a code block.
      let depth = 0;
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      continue;
    }
    if (ch === "'") {
      single = true;
      continue;
    }
    if (ch === '"') {
      double = true;
      continue;
    }
    if (ch === '{') braces += 1;
    if (ch === '}') {
      braces -= 1;
      assert.ok(braces >= 0, `${rel}: unexpected } at line ${line}`);
    }
  }
  assert.equal(braces, 0, `${rel}: unbalanced braces (${braces})`);
  assert.ok(!single, `${rel}: unterminated single-quoted string`);
  assert.ok(!double, `${rel}: unterminated double-quoted string`);
}
