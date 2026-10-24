/**
 * Structured executable resolver for subprocess routes (WER-008 slice).
 *
 * The resolver turns ONE logical command name (or path) plus an argument
 * vector into a concrete launch plan. It is a pure function of the
 * platform, the environment and the filesystem lookup it is handed, so a
 * Windows shape can be proven in a simulated test without claiming a
 * native Windows run.
 *
 * Laws:
 * - No shell string is ever built for the prompt. The argument vector
 *   carries only the executable path and caller-supplied CLI arguments;
 *   prompt content travels on stdin (see subprocess-transport.ts).
 * - No WSL, no bash, no shebang, no symlink assumption. A `.ps1` file is
 *   invoked through PowerShell with `-File` and a real argv, never
 *   through a shell. A `.cmd`/`.bat` shim on Windows is the ONE place a
 *   command string exists (cmd.exe `/c`), and it is built from
 *   individually quoted, validated arguments that can never contain the
 *   prompt.
 * - Paths with spaces and non-ASCII characters are preserved byte for
 *   byte in the argv / quoted payload; nothing is re-encoded or
 *   normalized.
 * - A command that cannot be resolved fails with a typed error rather
 *   than falling back to a shell, PATH guess, or WSL bridge.
 */
export type ResolverPlatform = 'win32' | 'darwin' | 'linux' | (string & {});
export type InvocationKind = 'native' | 'windows-cmd-shim' | 'windows-batch-shim' | 'powershell-script';
/** A launch plan: exactly what `spawn(file, args)` receives. */
export interface ResolvedInvocation {
    kind: InvocationKind;
    /** Executable handed to spawn (a shell only by name, never by string). */
    file: string;
    /** Argument vector. Never contains prompt content. */
    args: string[];
    /** The resolved native binary or shim script path. */
    target: string;
}
export type ResolverErrorCode = 'EXECUTABLE_NOT_FOUND' | 'EXECUTABLE_ARGUMENT_UNSAFE' | 'EXECUTABLE_UNSUPPORTED_SCRIPT';
export declare class ExecutableResolutionError extends Error {
    readonly code: ResolverErrorCode;
    readonly retryable = false;
    constructor(code: ResolverErrorCode, message: string);
}
export interface ResolveCommandInput {
    /** A command name looked up on PATH, or an explicit path. */
    command: string;
    /** CLI arguments, never prompt content. */
    args?: string[];
    /** Default: the host platform. Tests pass 'win32' explicitly. */
    platform?: ResolverPlatform;
    /** Default: process.env. */
    env?: NodeJS.ProcessEnv;
    /** Injectable file probe so resolution is testable without the real FS. */
    isFile?: (path: string) => boolean;
}
export declare const WINDOWS_PATH_EXTENSIONS: readonly [".com", ".exe", ".bat", ".cmd", ".ps1"];
/** True when the command already names a location rather than a PATH name. */
export declare function looksLikePath(command: string): boolean;
/**
 * Quote one argument for the cmd.exe command line.
 *
 * The payload is only ever built from the resolved executable path and
 * caller CLI arguments. Control characters, quotes and `%` are refused:
 * cmd.exe performs environment expansion even inside quotes, and there is
 * no escaping form that is unconditionally safe. Refusing is honest and
 * cannot silently change an argument.
 */
export declare function quoteForCmdExe(argument: string): string;
/**
 * Build the cmd.exe `/c` payload for a shim.
 *
 * `/d` disables AutoRun, `/s` plus one outer quote pair gives the
 * documented "strip exactly the outer quotes" form, so a shim path with
 * spaces and non-ASCII characters survives intact.
 */
export declare function windowsShimPayload(target: string, args: string[]): string;
/**
 * Resolve a command to a structured launch plan. Pure and total: it
 * either returns a plan or throws a typed resolution error.
 */
export declare function resolveCommand(input: ResolveCommandInput): ResolvedInvocation;
/** Test/diagnostic helper: list the candidates a resolution would try. */
export declare function resolutionCandidates(command: string, platform: ResolverPlatform, env: NodeJS.ProcessEnv): string[];
