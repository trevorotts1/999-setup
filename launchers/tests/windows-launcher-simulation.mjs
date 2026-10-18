// WER-021 companion (999 side): simulated Windows launcher tests.
//
// This exercises the production Windows launcher module on this host. It is
// a simulation: no native Windows execution is claimed. Space and non-ASCII
// path handling, .cmd shim resolution, classification and the print-before-
// open ordering are asserted directly against the shipped code.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const launchersDir = path.resolve(here, '..');
const windowsDir = path.join(launchersDir, 'windows');
const modulePath = path.join(windowsDir, 'blackceo-council-desktop.mjs');

const core = await import(pathToFileURL(modulePath).href);

let failures = 0;
function check(ok, name, detail = '') {
  if (ok) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

// --- port and URL ----------------------------------------------------------
check(core.DEFAULT_PORT === 4179, 'default port is 4179');
check(core.normalizePort(undefined) === 4179, 'normalizePort falls back to the default');
check(core.normalizePort('5123') === 5123, 'normalizePort accepts a numeric string');
check(throws(() => core.normalizePort('abc')), 'normalizePort rejects a non-numeric port');
check(core.buildHealthUrl(4179) === 'http://127.0.0.1:4179/api/health', 'health URL is composed correctly');

// --- spaces and non-ASCII in Windows paths ---------------------------------
const unicodeLocal = 'C:\\Users\\José Example\\AppData\\Local';
check(
  core.joinWindowsPath(unicodeLocal, 'BlackCEO', 'WiseElders') === 'C:\\Users\\José Example\\AppData\\Local\\BlackCEO\\WiseElders',
  'Windows path join preserves spaces and non-ASCII'
);
check(
  core.quoteWindowsArg('C:\\Users\\José Example\\run council\\run-council.mjs') === '"C:\\Users\\José Example\\run council\\run-council.mjs"',
  'Windows quoting keeps spaces and non-ASCII inside one argument'
);
check(
  core.quoteWindowsArg('plain') === 'plain',
  'Windows quoting leaves a plain argument bare'
);
check(
  core.profileRootFromEnv({ LOCALAPPDATA: unicodeLocal }) === 'C:\\Users\\José Example\\AppData\\Local\\BlackCEO\\WiseElders',
  'profile root handles spaces and non-ASCII LOCALAPPDATA'
);

// --- native executable vs .cmd shim resolution -----------------------------
const programFilesEnv = {
  PATH: 'C:\\Program Files\\nodejs;C:\\Users\\Zoë Example\\bin',
  PATHEXT: '.COM;.EXE;.BAT;.CMD'
};
const nativeNode = core.resolveNodeExecutable({
  env: programFilesEnv,
  exists: (p) => p === 'C:\\Program Files\\nodejs\\node.exe'
});
check(nativeNode === 'C:\\Program Files\\nodejs\\node.exe', 'resolves a native node.exe from a path with a space', nativeNode);

const shimNode = core.resolveNodeExecutable({
  env: { PATH: 'C:\\Tools Ünïcode', PATHEXT: '.EXE;.CMD' },
  exists: (p) => p === 'C:\\Tools Ünïcode\\node.cmd'
});
check(shimNode === 'C:\\Tools Ünïcode\\node.cmd', 'resolves a node.cmd shim from a non-ASCII directory', shimNode);

const nativeCommand = core.resolveRunCommand('C:\\Program Files\\nodejs\\node.exe', ['C:\\Users\\José Example\\run council\\run-council.mjs', 'serve']);
check(nativeCommand.viaShim === false, 'a native executable is started directly, not through a shim');
check(nativeCommand.args[0] === 'C:\\Users\\José Example\\run council\\run-council.mjs', 'the native command keeps the spaced path as one argument');

const shimEnv = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
const shimCommand = core.resolveRunCommand('C:\\Tools Ünïcode\\node.cmd', ['C:\\Users\\José Example\\run council\\run-council.mjs', 'serve'], shimEnv);
check(shimCommand.viaShim === true, 'a .cmd shim runs through the command interpreter');
check(shimCommand.file === 'C:\\Windows\\System32\\cmd.exe', 'the shim uses ComSpec, not a POSIX shell');
check(shimCommand.args.slice(0, 3).join(' ') === '/d /s /c', 'the shim uses cmd.exe /d /s /c');
const shimLine = shimCommand.args[3];
check(
  shimLine.startsWith('"') && shimLine.endsWith('"') &&
    shimLine.includes('"C:\\Tools Ünïcode\\node.cmd"') &&
    shimLine.includes('"C:\\Users\\José Example\\run council\\run-council.mjs"'),
  'the shim command line quotes every spaced path',
  JSON.stringify(shimLine)
);

// --- verification of a matching service ------------------------------------
const matching = core.classifyHealth(JSON.stringify({
  service: 'council',
  sessionUrl: 'http://127.0.0.1:4179/session/abc'
}));
check(matching.action === 'reuse' && matching.sessionUrl === 'http://127.0.0.1:4179/session/abc',
  'a matching council service is classified as reusable with its URL');
check(core.classifyHealth(JSON.stringify({ service: 'other', sessionUrl: 'http://127.0.0.1:1/x' })).action === 'unrelated',
  'a different service name is an unrelated listener');
check(core.classifyHealth(JSON.stringify({ service: 'council' })).action === 'unrelated',
  'a council payload without a session URL is not verified');
check(core.classifyHealth('not json').action === 'unrelated',
  'a non-JSON listener is unrelated');
check(core.classifyHealth(JSON.stringify({ service: 'council', sessionUrl: 'file:///tmp/x' })).action === 'unrelated',
  'a non-http session URL is not accepted');

// --- browser open command and URL preservation -----------------------------
const opener = core.buildOpenBrowserCommand('http://127.0.0.1:4179/session/a b', {
  env: { SystemRoot: 'C:\\Windows' },
  exists: () => true
});
check(opener.file.endsWith('powershell.exe'), 'the browser is opened through Windows PowerShell');
check(opener.args.join(' ').includes("Start-Process -FilePath 'http://127.0.0.1:4179/session/a b'"),
  'the browser command carries the full URL');
const quotedUrl = core.buildOpenBrowserCommand("http://127.0.0.1:4179/session/o'brien", {
  env: { SystemRoot: 'C:\\Windows' },
  exists: () => true
});
check(quotedUrl.args.join(' ').includes("o''brien"), 'a single quote in the URL is escaped for PowerShell');

const source = fs.readFileSync(modulePath, 'utf8');
const printIndex = source.indexOf('COUNCIL_SESSION_URL=');
const openIndex = source.indexOf('buildOpenBrowserCommand(sessionUrl');
check(printIndex !== -1 && openIndex !== -1 && printIndex < openIndex,
  'the session URL is printed before any browser attempt');

// --- argument parsing -------------------------------------------------------
check(core.parseArgs(['--port', '5000', '--no-open']).port === 5000, '--port is parsed');
check(core.parseArgs(['--no-open']).noOpen === true, '--no-open is parsed');
check(core.parseArgs(['--print-command']).printOnly === true, '--print-command is parsed');
check(throws(() => core.parseArgs(['--bogus'])), 'an unknown argument is rejected');

// --- no POSIX assumptions in the Windows path ------------------------------
const windowsFiles = ['blackceo-council-desktop.cmd', 'blackceo-council-desktop.mjs']
  .map((name) => path.join(windowsDir, name));
const forbidden = [
  { re: /\bwsl\b/i, label: 'WSL' },
  { re: /^#!/m, label: 'shebang' },
  { re: /\bbash\b/i, label: 'bash' },
  { re: /\bln\s+-s\b/i, label: 'ln -s' },
  { re: /readlink/i, label: 'readlink' },
  { re: /\bsymlink\b/i, label: 'symlink' },
  { re: /vercel/i, label: 'Vercel' },
  { re: /command center/i, label: 'Command Center' }
];
for (const file of windowsFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const hits = forbidden.filter((entry) => entry.re.test(text)).map((entry) => entry.label);
  check(hits.length === 0, `no WSL/bash/shebang/symlink/external-web assumption in ${path.basename(file)}`, hits.join(', '));
}

// --- simulated end-to-end against stub listeners ---------------------------
const http = await import('node:http');
function listenStub(payload) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url !== '/api/health') { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const unrelatedServer = await listenStub({ service: 'other' });
const unrelatedPort = unrelatedServer.address().port;
check((await core.probeHealth(unrelatedPort)).state === 'unrelated', 'probe classifies an unrelated listener');
const refuseCode = await core.main(['--port', String(unrelatedPort), '--no-open'], { ...process.env, SystemRoot: 'C:\\Windows' });
check(refuseCode === 3, 'main refuses an unrelated listener with exit 3', String(refuseCode));
check(unrelatedServer.listening === true, 'main did NOT kill the unrelated listener');
unrelatedServer.close();

const matchingServer = await listenStub({ service: 'council', sessionUrl: 'http://127.0.0.1:4179/session/sim' });
const matchingPort = matchingServer.address().port;
const captured = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return true; };
const reuseCode = await core.main(['--port', String(matchingPort)], { ...process.env, SystemRoot: 'C:\\Windows' });
process.stdout.write = realWrite;
const reuseOutput = captured.join('');
check(reuseCode === 0, 'main reuses a matching service with exit 0', String(reuseCode));
check(reuseOutput.includes('COUNCIL_SESSION_URL=http://127.0.0.1:4179/session/sim'),
  'main prints the true session URL before opening the browser', reuseOutput);
matchingServer.close();

console.log(failures === 0 ? 'RESULT PASS (windows simulation)' : `RESULT FAIL (windows simulation): ${failures}`);
process.exit(failures === 0 ? 0 : 1);
