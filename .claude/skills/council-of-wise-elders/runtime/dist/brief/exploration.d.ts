/**
 * CTR-133: the unresolved exploration candidate is not a decision option.
 *
 * Observed defect: the plugin synthesised `option-explore` ("Explore the
 * question with the Council; no option has been chosen yet.") when the
 * permitted context stated no alternatives. The nine seats then scored that
 * placeholder and the runtime exported a GO_WITH_CONDITIONS verdict
 * recommending it.
 *
 * This module names the placeholder in ONE place so brief preparation, the
 * proposal stage, decision eligibility, and publication validation all agree.
 * It never creates an option.
 */
export declare const EXPLORATION_OPTION_ID = "option-explore";
export declare const EXPLORATION_OPTION_LABEL = "Explore the question with the Council; no option has been chosen yet.";
export interface OptionLike {
    id: string;
    label: string;
}
/**
 * True only for the known placeholder id or its exact/legacy label. It does
 * not classify a genuine alternative that happens to mention exploration, and
 * it is never used to author an option.
 */
export declare function isUnresolvedExplorationOption(option: OptionLike): boolean;
