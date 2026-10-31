/**
 * Subprocess host-call delegate for harness routes (RP-046-1 repair
 * for DEFECT-046-A; directive Section 13.4 adapter 3).
 *
 * Adapter 3 integrates through the host harness's OWN supported
 * surface: the skill invokes the harness executable the client's
 * configuration names (the Claude Code / Claude-Nine launcher found
 * by route discovery) as a subprocess, in print mode, and reads its
 * structured JSON result envelope. The harness keeps its own routing,
 * and its own credentials. It passes NO model flag unless the pinned
 * route snapshot names a model (options.model, the client's explicit
 * choice or the harness default the route choice pinned); otherwise the
 * harness's own configured model applies. It scrapes no OAuth token or cookie, and manufactures no API
 * access from a subscription. What the harness resolves is reported
 * back to the CWE-010 guard by the bridge resolver, never invented
 * here.
 *
 * Failure honesty: a harness that exits non-zero or reports an error
 * envelope fails the operation through the normal transport error
 * path. A delegate killed by the deadline AFTER the harness announced
 * it started (stream-json init line) may or may not have completed
 * provider-side, so that failure carries unknownCompletion = true and
 * the engine never replays it (Section 15.5). A delegate that never
 * announced it started sent nothing to the provider: that failure is
 * retryable, and the runner admits exactly one bounded retry. Response bodies are not persisted by this delegate;
 * only the parsed text and structured identity/usage fields leave it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalStringify } from '../contracts/index.js';
export const DEFAULT_HOST_CALL_TIMEOUT_MS = 600_000;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
// A launcher that runs its own guard scripts before handing off needs ~16 s
// for --help (measured on claude-nine), so 10 s would miss every flag.
const HELP_PROBE_TIMEOUT_MS = 45_000;
/**
 * Spawn-to-init budget for a stream-json harness. A harness that has not
 * announced it started by then sent nothing to the provider, so it is
 * killed and retried instead of waiting out the whole call deadline.
 */
export const DEFAULT_STARTUP_TIMEOUT_MS = 300_000;
/** Backoff before retry 1 and retry 2 (at most 2 extra attempts). */
const RETRY_BACKOFF_MS = [5_000, 15_000];
const TRANSIENT_PATTERN = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|Connection error|fetch failed|overloaded|\b(429|502|503|529)\b/i;
const SECRET_PATTERN = /sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/g;
/**
 * Flags that stop a harness print call from loading the user's hooks,
 * MCP servers, skills and session history. When the harness's own --help
 * (a real "Usage: claude" text) is read, only the flags it lists are
 * added. When the probe fails, times out or prints something else, ALL
 * are added: running without isolation is the worse failure, and a build
 * lacking one fails at once with "unknown option". Never --bare (skips Keychain reads),
 * never --setting-sources (claude-nine routes through user settings).
 */
const ISOLATION_FLAGS = [
    { flag: '--no-session-persistence', args: ['--no-session-persistence'] },
    { flag: '--disable-slash-commands', args: ['--disable-slash-commands'] },
    { flag: '--strict-mcp-config', args: ['--strict-mcp-config'] },
    { flag: '--tools', args: ['--tools', ''] },
    { flag: '--settings', args: ['--settings', '{"disableAllHooks":true}'] },
];
/** `<exe> --help` output, once per executable path for the process lifetime. */
const helpCache = new Map();
/** Kill a harness and everything it spawned (guards, hooks, MCP servers). */
function killTree(child) {
    try {
        if (child.pid && process.platform !== 'win32')
            process.kill(-child.pid, 'SIGKILL');
        else
            child.kill('SIGKILL');
    }
    catch {
        try {
            child.kill('SIGKILL');
        }
        catch {
            // already gone
        }
    }
}
const SPAWN_GROUP = process.platform !== 'win32';
export class HostCallTransportError extends Error {
    retryable;
    unknownCompletion;
    /** Raw stdout+stderr, set only for a non-zero exit or an error envelope. */
    rawOutput;
    constructor(message, options = {}) {
        super(message);
        this.name = 'HostCallTransportError';
        this.retryable = options.retryable ?? false;
        this.unknownCompletion = options.unknownCompletion ?? false;
        this.rawOutput = options.rawOutput;
    }
}
function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function redactedTail(text) {
    return text.trim().slice(-300).replace(SECRET_PATTERN, '[redacted]');
}
function asObject(text) {
    try {
        const parsed = JSON.parse(text);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        // not JSON
    }
    return null;
}
/**
 * The whole stdout first; otherwise the last stdout line that is a JSON
 * object shaped like a result envelope (a launcher may print its own
 * lines before it hands off to the harness).
 */
function parseEnvelope(trimmed) {
    const whole = asObject(trimmed);
    if (whole)
        return whole;
    const lines = trimmed.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line.startsWith('{'))
            continue;
        const obj = asObject(line);
        if (obj && (obj.type === 'result' || 'result' in obj || 'is_error' in obj))
            return obj;
    }
    return null;
}
function probeHelp(spawnImpl, executable, env, cwd, timeoutMs) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawnImpl(executable, ['--help'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: SPAWN_GROUP });
        }
        catch {
            resolve('');
            return;
        }
        let out = '';
        let done = false;
        const finish = () => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            resolve(out);
        };
        const timer = setTimeout(() => {
            killTree(child);
            finish();
        }, timeoutMs);
        child.stdout?.on('data', (chunk) => {
            if (out.length < MAX_STDOUT_BYTES)
                out += chunk.toString('utf8');
        });
        child.stderr?.on('data', () => { });
        child.on('error', finish);
        child.on('close', finish);
        child.stdin?.on('error', () => { });
        child.stdin?.end();
    });
}
async function isolationArgs(spawnImpl, executable, env, cwd, helpTimeoutMs) {
    let help = helpCache.get(executable);
    if (!help) {
        help = probeHelp(spawnImpl, executable, env, cwd, helpTimeoutMs);
        helpCache.set(executable, help);
    }
    const text = await help;
    // Only a real help text is trusted (and cached); anything else is
    // re-probed on the next call and meanwhile runs with every flag.
    const trusted = /Usage: claude/.test(text);
    if (!trusted)
        helpCache.delete(executable);
    const out = [];
    for (const { flag, args } of ISOLATION_FLAGS) {
        if (!trusted || new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(text))
            out.push(...args);
    }
    return { args: out, streaming: !trusted || /stream-json/.test(text) };
}
/** True once a stream-json stdout holds the harness's own init line. */
function sawInit(stdout) {
    for (const line of stdout.split('\n')) {
        if (!line.startsWith('{') || !line.includes('"init"'))
            continue;
        const obj = asObject(line.trim());
        if (obj && obj.type === 'system' && obj.subtype === 'init')
            return true;
    }
    return false;
}
export class SubprocessHostCallTransport {
    options;
    constructor(options) {
        this.options = options;
    }
    get executable() {
        return this.options.executable;
    }
    /** Wire model passed as --model, or null when the harness default applies. */
    get model() {
        return this.options.model ?? null;
    }
    async generate(request) {
        const spawnImpl = this.options.spawnImpl ?? spawn;
        const env = { ...process.env, ...(this.options.env ?? {}) };
        if (this.options.configDir) {
            env.CLAUDE_CONFIG_DIR = this.options.configDir;
        }
        // A dedicated empty directory so no project CLAUDE.md or hooks load.
        const cwd = join(tmpdir(), 'council-harness-cwd');
        mkdirSync(cwd, { recursive: true });
        const iso = await isolationArgs(spawnImpl, this.options.executable, env, cwd, this.options.helpTimeoutMs ?? HELP_PROBE_TIMEOUT_MS);
        const args = [
            '--print',
            '--output-format',
            iso.streaming ? 'stream-json' : 'json',
            ...(iso.streaming ? ['--verbose'] : []),
            ...(this.options.model ? ['--model', this.options.model] : []),
            ...iso.args,
        ];
        const sleep = this.options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
        const maxAttempts = Math.max(1, this.options.maxAttempts ?? RETRY_BACKOFF_MS.length + 1);
        for (let attempt = 1;; attempt += 1) {
            try {
                return await this.runOnce(spawnImpl, args, env, cwd, request, iso.streaming);
            }
            catch (err) {
                if (!(err instanceof HostCallTransportError) ||
                    err.unknownCompletion ||
                    err.rawOutput === undefined ||
                    !TRANSIENT_PATTERN.test(err.rawOutput) ||
                    request.signal?.aborted) {
                    throw err;
                }
                if (attempt >= maxAttempts) {
                    throw new HostCallTransportError(`${err.message} (gave up after ${attempt} attempts)`);
                }
                await sleep(RETRY_BACKOFF_MS[attempt - 1]);
            }
        }
    }
    runOnce(spawnImpl, args, env, cwd, request, streaming) {
        const timeoutMs = this.options.timeoutMs ?? DEFAULT_HOST_CALL_TIMEOUT_MS;
        const startupMs = this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
        const prompt = `${request.system}\n\n${canonicalStringify(request.input)}`;
        return new Promise((resolve, reject) => {
            let child;
            try {
                child = spawnImpl(this.options.executable, args, {
                    env,
                    cwd,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    detached: SPAWN_GROUP,
                });
            }
            catch (err) {
                reject(new HostCallTransportError(`The configured harness executable could not be started: ${err instanceof Error ? err.message : String(err)}`));
                return;
            }
            let stdout = '';
            let stderr = '';
            let settled = false;
            let timedOut = false;
            let started = !streaming; // a plain-json harness cannot announce a start
            let notStarted = false;
            const timer = setTimeout(() => {
                timedOut = true;
                killTree(child);
            }, timeoutMs);
            const startupTimer = streaming
                ? setTimeout(() => {
                    if (started)
                        return;
                    notStarted = true;
                    killTree(child);
                }, startupMs)
                : null;
            const onAbort = () => {
                killTree(child);
            };
            if (request.signal) {
                if (request.signal.aborted)
                    onAbort();
                else
                    request.signal.addEventListener('abort', onAbort, { once: true });
            }
            child.stdout?.on('data', (chunk) => {
                if (stdout.length < MAX_STDOUT_BYTES)
                    stdout += chunk.toString('utf8');
                if (!started && sawInit(stdout)) {
                    started = true;
                    if (startupTimer)
                        clearTimeout(startupTimer);
                }
            });
            child.stderr?.on('data', (chunk) => {
                if (stderr.length < MAX_STDERR_BYTES)
                    stderr += chunk.toString('utf8');
            });
            child.on('error', (err) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (startupTimer)
                    clearTimeout(startupTimer);
                reject(new HostCallTransportError(`The configured harness executable failed to run: ${err.message}`));
            });
            child.on('close', (code) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (startupTimer)
                    clearTimeout(startupTimer);
                if (!started && (notStarted || timedOut)) {
                    reject(new HostCallTransportError(`The harness did not start within ${Math.round((timedOut ? timeoutMs : startupMs) / 1000)} s (no request was sent to the provider); it was killed and one retry is allowed.`, { retryable: true }));
                    return;
                }
                if (timedOut) {
                    reject(new HostCallTransportError(`The harness call exceeded the ${timeoutMs} ms operation deadline and was killed; whether the provider completed is unknown, so the operation is never replayed.`, { unknownCompletion: true }));
                    return;
                }
                if (request.signal?.aborted) {
                    reject(new HostCallTransportError('The harness call was aborted by cancellation.', {
                        unknownCompletion: true,
                    }));
                    return;
                }
                const trimmed = stdout.trim();
                const envelope = parseEnvelope(trimmed);
                const rawOutput = `${stdout}\n${stderr}`;
                if (envelope && envelope.is_error === true) {
                    const detail = typeof envelope.result === 'string'
                        ? envelope.result
                        : typeof envelope.subtype === 'string'
                            ? envelope.subtype
                            : 'the harness reported an error';
                    reject(new HostCallTransportError(`The harness reported an error: ${redactedTail(detail)}`, { rawOutput }));
                    return;
                }
                if (code !== 0 && code !== null) {
                    const tail = redactedTail(stderr);
                    reject(new HostCallTransportError(`The configured harness executable exited with code ${code}${tail ? `: ${tail}` : ''}`, { rawOutput }));
                    return;
                }
                if (envelope && typeof envelope.result === 'string') {
                    let reportedModelId = typeof envelope.model === 'string' ? envelope.model : null;
                    if (reportedModelId === null && envelope.modelUsage !== null && typeof envelope.modelUsage === 'object') {
                        const keys = Object.keys(envelope.modelUsage);
                        if (keys.length === 1)
                            reportedModelId = keys[0];
                    }
                    const usage = (envelope.usage ?? {});
                    resolve({
                        text: envelope.result,
                        provider_request_id: typeof envelope.session_id === 'string' ? envelope.session_id : null,
                        reported_model_id: reportedModelId,
                        usage: {
                            input_tokens: numberOrNull(usage.input_tokens),
                            output_tokens: numberOrNull(usage.output_tokens),
                        },
                    });
                    return;
                }
                if (trimmed.length > 0) {
                    // A harness build that answers in plain text instead of the
                    // JSON envelope: the text is the response, identity stays
                    // unreported, and nothing is inferred from prose.
                    resolve({
                        text: trimmed,
                        provider_request_id: null,
                        reported_model_id: null,
                        usage: { input_tokens: null, output_tokens: null },
                    });
                    return;
                }
                reject(new HostCallTransportError('The configured harness executable produced no output.'));
            });
            child.stdin?.on('error', () => {
                // A child that exits before reading its input reports through
                // the close handler; a broken stdin pipe adds no information.
            });
            child.stdin?.end(prompt);
        });
    }
}
