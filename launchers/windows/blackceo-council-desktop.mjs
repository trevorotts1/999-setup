// blackceo-council-desktop.mjs (WER-021 companion, 999 side): native
// Windows desktop launcher for the standalone Council service.
//
// This file is plain Node.js on purpose: it runs on native Windows with no
// POSIX shell, no Linux compatibility layer, no script-header dependency
// and no link/junction assumption. Paths are composed with path.win32 and
// quoted for cmd.exe, so spaces and non-ASCII characters survive.
//
// Contract with the service (owned by WER-021 / runtime/src/service/):
//   GET http://127.0.0.1:<port>/api/health
//     -> 200 {"service":"council","sessionUrl":"<absolute http(s) URL>"}
//
// Behaviour:
//   - reuses a VERIFIED matching council service already listening;
//   - starts the service only when the port has no listener;
//   - REFUSES an unrelated listener on the port and NEVER kills it;
//   - prints the verified session URL, then opens the default browser;
//     when the browser cannot open, the URL stays printed and usable;
//   - --print-command emits the launch command and readiness check only.
// Registering a system service is OUT OF SCOPE. Nothing here installs one.

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 4179;
export const HEALTH_PATH = '/api/health';
export const DEFAULT_TIMEOUT_SECONDS = 20;

export function normalizePort(value) {
  const text = value === undefined || value === null || value === '' ? String(DEFAULT_PORT) : String(value);
  if (!/^[0-9]+$/.test(text)) throw new Error(`port must be a number: ${text}`);
  const port = Number(text);
  if (port < 1 || port > 65535) throw new Error(`port out of range: ${text}`);
  return port;
}

export function buildHealthUrl(port, host = '127.0.0.1') {
  return `http://${host}:${port}${HEALTH_PATH}`;
}

export function joinWindowsPath(...parts) {
  return path.win32.join(...parts);
}

// Windows command-line quoting: wrap in double quotes and double every
// backslash that precedes a quote or the closing quote, per the Windows
// argument-parsing rules. Non-ASCII is passed through unchanged.
export function quoteWindowsArg(arg) {
  const text = String(arg);
  if (text !== '' && !/[\s"]/.test(text)) return text;
  let out = '"';
  let backslashes = 0;
  for (const ch of text) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    out += '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  out += '\\'.repeat(backslashes * 2) + '"';
  return out;
}

// A native .exe is started directly. A .cmd/.bat shim cannot be started by
// CreateProcess, so it is run through the command interpreter with the whole
// command line quoted for /s /c.
export function resolveRunCommand(executablePath, args = [], env = process.env) {
  const ext = path.win32.extname(String(executablePath)).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    const inner = [executablePath, ...args].map(quoteWindowsArg).join(' ');
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    return { file: comspec, args: ['/d', '/s', '/c', `"${inner}"`], viaShim: true };
  }
  return { file: executablePath, args: [...args], viaShim: false };
}

export function windowsPathEntries(env = process.env) {
  return String(env.PATH || env.Path || '')
    .split(';')
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

// Resolve node from native executables and .cmd/.bat shims. .exe is preferred
// so a shim is used only when no native executable exists.
export function resolveNodeExecutable(options = {}) {
  const env = options.env || process.env;
  const exists = options.exists || ((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
  const override = env.BLACKCEO_NODE_EXE;
  if (override) return override;

  const exts = String(env.PATHEXT || '.EXE;.CMD;.BAT')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const ordered = ['.exe', ...exts.filter((e) => e !== '.exe'), '.cmd', '.bat'];
  const seen = new Set();

  for (const ext of ordered) {
    if (seen.has(ext)) continue;
    seen.add(ext);
    for (const dir of windowsPathEntries(env)) {
      const candidate = path.win32.join(dir, `node${ext}`);
      if (exists(candidate)) return candidate;
    }
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
      if (!env[key]) continue;
      const candidate = path.win32.join(env[key], 'nodejs', `node${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  return '';
}

export function classifyHealth(bodyText) {
  let payload;
  try {
    payload = JSON.parse(String(bodyText));
  } catch {
    return { action: 'unrelated' };
  }
  const sessionUrl = payload && payload.sessionUrl;
  if (!payload || payload.service !== 'council' || typeof sessionUrl !== 'string' ||
      !/^https?:\/\//.test(sessionUrl)) {
    return { action: 'unrelated' };
  }
  return { action: 'reuse', sessionUrl };
}

export function buildOpenBrowserCommand(url, options = {}) {
  const env = options.env || process.env;
  const exists = options.exists || ((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (exists(powershell)) {
    const escaped = String(url).replace(/'/g, "''");
    return {
      file: powershell,
      args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${escaped}'`]
    };
  }
  const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
  return { file: comspec, args: ['/d', '/s', '/c', 'start', '""', quoteWindowsArg(url)] };
}

export function profileRootFromEnv(env = process.env) {
  if (env.BLACKCEO_COUNCIL_PROFILE) return env.BLACKCEO_COUNCIL_PROFILE;
  if (env.LOCALAPPDATA) return path.win32.join(env.LOCALAPPDATA, 'BlackCEO', 'WiseElders');
  if (env.USERPROFILE) return path.win32.join(env.USERPROFILE, 'AppData', 'Local', 'BlackCEO', 'WiseElders');
  return 'C:\\BlackCEO\\WiseElders';
}

export function parseArgs(argv) {
  const options = { port: normalizePort(process.env.BLACKCEO_COUNCIL_PORT), noOpen: false, printOnly: false, timeout: Number(process.env.BLACKCEO_COUNCIL_READY_TIMEOUT || DEFAULT_TIMEOUT_SECONDS) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      if (i + 1 >= argv.length) throw new Error('--port needs a value');
      options.port = normalizePort(argv[++i]);
    } else if (arg === '--timeout') {
      if (i + 1 >= argv.length) throw new Error('--timeout needs a value');
      options.timeout = Number(argv[++i]);
      if (!Number.isFinite(options.timeout) || options.timeout < 0) throw new Error('--timeout must be a number');
    } else if (arg === '--no-open') {
      options.noOpen = true;
    } else if (arg === '--print-command') {
      options.printOnly = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 0) throw new Error('--timeout must be a number');
  return options;
}

function say(message) {
  process.stderr.write(`blackceo-council-desktop: ${message}\n`);
}

export function probeHealth(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: HEALTH_PATH, timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve({ state: 'unrelated' });
          return;
        }
        const classified = classifyHealth(Buffer.concat(chunks).toString('utf8'));
        resolve(classified.action === 'reuse' ? { state: 'matching', sessionUrl: classified.sessionUrl } : { state: 'unrelated' });
      });
    });
    request.on('timeout', () => { request.destroy(new Error('timeout')); });
    request.on('error', (error) => {
      if (error && error.code === 'ECONNREFUSED') resolve({ state: 'down' });
      else resolve({ state: 'unreachable' });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    say(`ERROR USAGE: ${error.message}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write([
      'blackceo-council-desktop [--port N] [--no-open] [--print-command] [--timeout SECONDS]',
      `  default port: ${DEFAULT_PORT} (override with BLACKCEO_COUNCIL_PORT)`,
      `  readiness check: GET ${HEALTH_PATH}`,
      '  registering a system service is out of scope; --print-command emits the command only.'
    ].join('\n') + '\n');
    return 0;
  }

  const profileRoot = profileRootFromEnv(env);
  const entry = joinWindowsPath(profileRoot, 'runtime', 'current', 'run-council.mjs');
  const nodePath = resolveNodeExecutable({ env });

  if (options.printOnly) {
    const launch = resolveRunCommand(nodePath || 'node.exe', [entry, 'serve', '--host', '127.0.0.1', '--port', String(options.port)], env);
    process.stdout.write(`COUNCIL_LAUNCH_COMMAND=${[launch.file, ...launch.args].join(' ')}\n`);
    process.stdout.write(`COUNCIL_READINESS_CHECK=Invoke-WebRequest -UseBasicParsing ${buildHealthUrl(options.port)}\n`);
    process.stdout.write('# Registration as a system service is out of scope: this launcher emits the command and readiness check only.\n');
    return 0;
  }

  let probe = await probeHealth(options.port);
  if (probe.state === 'unrelated' || probe.state === 'unreachable') {
    say(`REFUSING: port ${options.port} already has a listener that is not a council service.`);
    say('It was left untouched. Stop it yourself, or pass --port with a free port.');
    return 3;
  }

  let sessionUrl = probe.state === 'matching' ? probe.sessionUrl : '';
  if (!sessionUrl) {
    if (!nodePath) {
      say('ERROR COUNCIL_NODE_MISSING: Node.js is not runnable; the council runtime cannot start');
      return 4;
    }
    let entryExists = false;
    try { entryExists = fs.statSync(entry).isFile(); } catch { entryExists = false; }
    if (!entryExists) {
      say(`ERROR COUNCIL_RUNTIME_MISSING: the council runtime is not installed (no ${entry}). Install it with scripts\\council-runtime-install.ps1`);
      return 4;
    }
    const launch = resolveRunCommand(nodePath, [entry, 'serve', '--host', '127.0.0.1', '--port', String(options.port)], env);
    say(`starting council service on http://127.0.0.1:${options.port}`);
    const child = spawn(launch.file, launch.args, { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.unref();
    const deadline = Date.now() + options.timeout * 1000;
    while (Date.now() < deadline) {
      await delay(1000);
      probe = await probeHealth(options.port);
      if (probe.state === 'matching') { sessionUrl = probe.sessionUrl; break; }
      if (probe.state === 'unrelated' || probe.state === 'unreachable') {
        say(`REFUSING: port ${options.port} was taken by a listener that is not a council service.`);
        say('It was left untouched.');
        return 3;
      }
    }
    if (!sessionUrl) {
      say(`ERROR COUNCIL_NOT_READY: the service did not become ready within ${options.timeout}s (pid ${child.pid}).`);
      return 5;
    }
  }

  process.stdout.write(`COUNCIL_SESSION_URL=${sessionUrl}\n`);
  if (!options.noOpen) {
    const opener = buildOpenBrowserCommand(sessionUrl, { env });
    try {
      const openChild = spawn(opener.file, opener.args, { detached: true, stdio: 'ignore', windowsHide: true, env });
      openChild.on('error', () => {
        say('WARNING COUNCIL_BROWSER_OPEN_FAILED: could not open the browser.');
        say('The session URL above is still valid; open it manually.');
      });
      openChild.unref();
    } catch {
      say('WARNING COUNCIL_BROWSER_OPEN_FAILED: could not open the browser.');
      say('The session URL above is still valid; open it manually.');
    }
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath && invokedPath === selfPath) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    say(`ERROR: ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
