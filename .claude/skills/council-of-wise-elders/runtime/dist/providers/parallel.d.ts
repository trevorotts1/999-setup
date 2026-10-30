/**
 * Parallel dispatch limits (W77S-MODES).
 *
 * One table, read straight off what the client actually pays for:
 *
 * | route                       | agents in parallel              |
 * | --------------------------- | ------------------------------- |
 * | Ollama, $20/month plan      | 3                               |
 * | Ollama, $100+/month plan    | 10                              |
 * | Ollama, plan unknown        | OLLAMA_PLAN_REQUIRED (ask once) |
 * | Agnes 3.0 Flash             | unlimited                       |
 * | OpenRouter                  | unlimited                       |
 * | DeepSeek Direct             | unlimited                       |
 * | any other direct paid route | unlimited                       |
 *
 * OpenRouter stays the recommended route and runs every advisor at once.
 * Agnes 3.0 Flash, when selected, has no parallel limit either. A client's
 * own Ollama does have one, fixed by the plan they pay for; $100 and above
 * is one tier, so "100+" is 10. An unknown plan is a typed refusal, never a
 * guess: ask the client once (OLLAMA_PLAN_QUESTION), then convene again.
 *
 * DeepSeek Direct is a paying provider in its own right. It is recognised
 * explicitly so it can never be mistaken for an Ollama slug and never
 * raises the Ollama plan question.
 *
 * This module is pure: the caller supplies the panel size and the plan.
 */
export type OllamaPlan = '20' | '100';
/**
 * A client-supplied plan as it really arrives from config, a form, or JSON:
 * `'20'`, `20`, `'$100/mo'`, `'100+'`, or absent. Normalised, never trusted.
 */
export type OllamaPlanInput = OllamaPlan | number | string | null | undefined;
/** The plan tiers this intelligence knows, in dollars per month. */
export declare const OLLAMA_MONTHLY_TIERS: {
    readonly basic: 20;
    readonly premium: 100;
};
/** The one question a client is asked, once, when their plan is unknown. */
export declare const OLLAMA_PLAN_QUESTION = "Which Ollama plan do you pay for: the $20/month plan (3 advisors run at a time) or the $100+/month plan (10 run at a time)?";
/** How a route slug is classified for parallel dispatch. */
export type ProviderParallelKind = 'ollama' | 'openrouter' | 'agnes' | 'deepseek-direct' | 'uncapped';
/**
 * Classify a route slug. Only `ollama` and its variants (`ollama-cloud`,
 * the client's own signed-in daemon) carry a plan cap; every other
 * recognised provider is uncapped, and an unrecognised provider is
 * uncapped by default rather than guessed at.
 */
export declare function providerKindFor(providerSlug: string): ProviderParallelKind;
/** True for the `ollama` slug and every `ollama-*` variant (e.g. ollama-cloud). */
export declare function isOllamaProvider(providerSlug: string): boolean;
export type ParallelLimitResult = {
    ok: true;
    limit: number;
} | {
    ok: false;
    code: 'OLLAMA_PLAN_REQUIRED';
};
export declare function parallelLimitFor(input: {
    providerSlug: string;
    ollamaPlan: OllamaPlanInput;
    panelSize: number;
    /**
     * The mode's own wave width. Omitted means the mode adds no cap (the
     * whole panel runs at once, subject to the provider limit).
     */
    waveWidth?: number;
}): ParallelLimitResult;
