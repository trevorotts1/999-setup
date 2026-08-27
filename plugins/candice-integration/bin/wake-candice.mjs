#!/usr/bin/env node
/**
 * Cross-platform, fail-soft Candice visual-wake dispatcher (FIX-010).
 *
 * The hook receives its command from the static plugin registration, reads at
 * most one small JSON event from stdin, and starts the companion without
 * invoking a shell.  It deliberately does not forward a raw session or host
 * value to the current native runtime: FIX-009 truthfully exposes no
 * authenticated binding, bridge, or single-instance capability.  Parsed
 * identifiers are therefore only a future wire-contract seam, never routing
 * authority in this dispatcher.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

// Shared with the MCP ask_user bridge so the two launch paths can never
// resolve the companion differently (see shared/launch-command.js).
import { resolveLaunchCommand, companionSpawnEnv } from '../shared/launch-command.js';

export { resolveLaunchCommand, companionSpawnEnv };

export const SUPPORTED_COMMANDS = Object.freeze([
  '/spec-protocol',
  '/kaizen',
  '/eli5',
  '/bro',
]);

const MAX_STDIN_BYTES = 64 * 1024;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

function opaqueValue(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER.test(value) ? value : null;
}

function firstOpaque(payload, names) {
  for (const name of names) {
    if (Object.hasOwn(payload, name)) return opaqueValue(payload[name]);
  }
  return null;
}

/** Parse only opaque metadata; prompt text, transcript paths, and secrets are ignored. */
export function parseHookPayload(raw) {
  if (raw === '') return { ok: true, sessionId: null, activationId: null, hostCorrelation: null };
  if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) {
    return { ok: false, code: 'payload-too-large' };
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid-json' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'invalid-payload' };
  }

  // Claude hook payload versions use snake_case; camelCase is accepted only
  // for compatible local fixtures. No field is invented when it is absent.
  return {
    ok: true,
    sessionId: firstOpaque(payload, ['session_id', 'sessionId']),
    activationId: firstOpaque(payload, ['event_id', 'eventId', 'activation_id', 'activationId']),
    hostCorrelation: firstOpaque(payload, ['terminal_id', 'terminalId', 'host_correlation', 'hostCorrelation']),
  };
}

export function buildWakeRequest(command, payload) {
  if (!SUPPORTED_COMMANDS.includes(command)) {
    return { ok: false, code: 'unsupported-command' };
  }
  if (!payload.ok) return payload;
  return {
    ok: true,
    version: '1.0',
    command,
    sessionId: payload.sessionId,
    activationId: payload.activationId,
    hostCorrelation: payload.hostCorrelation,
  };
}

/**
 * Ask the locally installed visual app to wake.  Arguments are never composed
 * through a shell.  The current runtime receives only a supported command;
 * adding raw `--session-id` or host arguments here would be an unverified
 * cross-session claim and is intentionally forbidden until FIX-011.
 */
export function dispatchWake(request, {
  launchCommand = resolveLaunchCommand(),
  spawn = nodeSpawn,
  // Injected so a test can assert what the child is told without reading
  // the real environment.
  spawnEnv = companionSpawnEnv(),
} = {}) {
  if (!request.ok) return { outcome: 'ignored', code: request.code };
  try {
    const child = spawn(launchCommand, ['--wake', request.command], {
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
      // Carries CANDICE_HARNESS so the app can name the window the user is
      // actually looking at. Passing the environment explicitly is not a
      // widening: with no `env` option Node inherits the parent's whole
      // environment anyway, which is what this did before.
      env: spawnEnv,
    });
    // A missing executable is reported asynchronously by Node. Consume that
    // event so it cannot turn an async Claude hook into an unhandled error.
    child.once?.('error', () => {});
    child.unref?.();
    return { outcome: 'visual-wake-requested', command: request.command };
  } catch {
    return { outcome: 'companion-unavailable' };
  }
}

export function commandFromArgs(args) {
  const index = args.indexOf('--command');
  return index >= 0 ? args[index + 1] ?? null : null;
}

/** Extract only a supported leading slash command; never retain prompt text. */
export function commandFromHookPayload(raw) {
  if (raw === '' || Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload.prompt !== 'string') return null;
    const prompt = payload.prompt.trimStart();
    const firstToken = prompt.split(/\s+/, 1)[0];
    if (SUPPORTED_COMMANDS.includes(firstToken)) return firstToken;

    // Claude expands a recognized slash command into this bounded envelope
    // before UserPromptSubmit hooks run. Read only command-name; never inspect
    // or forward command-args or the expanded skill body.
    const expanded = prompt.match(
      /^<command-message>[^<]*<\/command-message>\s*<command-name>(\/[a-z0-9-]+)<\/command-name>(?:\s|$)/,
    );
    return expanded && SUPPORTED_COMMANDS.includes(expanded[1]) ? expanded[1] : null;
  } catch {
    return null;
  }
}

export async function readStdin(stream = process.stdin) {
  const chunks = [];
  let bytes = 0;
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk, 'utf8');
    if (bytes <= MAX_STDIN_BYTES) chunks.push(chunk);
  });
  await once(stream, 'end');
  return bytes > MAX_STDIN_BYTES ? 'x'.repeat(MAX_STDIN_BYTES + 1) : chunks.join('');
}

export async function main({ args = process.argv.slice(2), stdin = process.stdin } = {}) {
  try {
    const raw = await readStdin(stdin);
    const command = commandFromArgs(args) || commandFromHookPayload(raw);
    const request = buildWakeRequest(command, parseHookPayload(raw));
    dispatchWake(request);
  } catch {
    // Hooks are asynchronous and must never stop the invoking skill. Intentionally
    // silent: no event data, terminal content, or environment secrets are logged.
  }
  return 0;
}

export function isMainModule(moduleUrl = import.meta.url, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

if (isMainModule()) {
  main().then((code) => { process.exitCode = code; });
}
