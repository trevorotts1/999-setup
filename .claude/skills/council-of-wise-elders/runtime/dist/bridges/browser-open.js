/**
 * Browser-open helper (WER-005).
 *
 * Opening a URL is best effort: a missing browser, a locked session, or a
 * nonzero opener exit must NOT discard the URL the caller needs. Every
 * result carries `url` unchanged, and every failure's recovery text repeats
 * it so the client can open it manually. Nothing here throws.
 */
import { spawnSync } from 'node:child_process';
function defaultSpawn(command, args) {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    return { status: result.status, error: result.error ?? undefined };
}
export function browserOpenCommand(url, platform = process.platform) {
    if (platform === 'darwin')
        return { command: 'open', args: [url] };
    if (platform === 'win32') {
        // `start` is a cmd builtin; the empty title argument keeps a URL with
        // its own quotes from being read as a window title.
        return { command: 'cmd', args: ['/c', 'start', '', url] };
    }
    return { command: 'xdg-open', args: [url] };
}
/**
 * Attempt to open `url`. Returns a result in every case; the URL is never
 * lost, and a failure always includes a manual-open recovery line.
 */
export function openCouncilUrl(url, options = {}) {
    const manual = `Open this URL manually: ${url}`;
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return {
            url,
            opened: false,
            command: null,
            error: `"${url}" is not an absolute URL.`,
            recovery: `Provide an absolute URL. ${manual}`,
        };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
            url,
            opened: false,
            command: null,
            error: `Refusing to open non-HTTP(S) URL ${url}.`,
            recovery: manual,
        };
    }
    const { command, args } = browserOpenCommand(url, options.platform);
    const spawn = options.spawn ?? defaultSpawn;
    try {
        const result = spawn(command, args);
        if (result.error) {
            return {
                url,
                opened: false,
                command: `${command} ${args.join(' ')}`,
                error: `Could not launch the opener: ${result.error.message}`,
                recovery: manual,
            };
        }
        if (result.status !== 0) {
            return {
                url,
                opened: false,
                command: `${command} ${args.join(' ')}`,
                error: `The opener exited with status ${String(result.status)}.`,
                recovery: manual,
            };
        }
    }
    catch (error) {
        return {
            url,
            opened: false,
            command: `${command} ${args.join(' ')}`,
            error: `Could not launch the opener: ${error instanceof Error ? error.message : String(error)}`,
            recovery: manual,
        };
    }
    return {
        url,
        opened: true,
        command: `${command} ${args.join(' ')}`,
        error: null,
        recovery: null,
    };
}
