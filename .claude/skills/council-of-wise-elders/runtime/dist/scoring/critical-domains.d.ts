/**
 * Frozen critical-domain classification (directive Section 12.7, CWE-026).
 *
 * classifyCriticalDomains is a deterministic rule service over structured
 * intake facts and constraint tags. It runs BEFORE Round 1 and its output
 * is frozen inside the reviewed brief (the brief's critical_domains), so
 * scoring later reads a fixed classification, never a re-derived one.
 *
 * Rules held here:
 * - The required reviewer for each domain is a fixed table from Section
 *   12.7, never a model choice. No celebrity seat substitutes for a
 *   qualified professional review.
 * - A model may PROPOSE a domain tag, and a proposal triggers the domain.
 *   A model removal request can never silently remove a triggered
 *   domain: removals of triggered domains are reported as rejected, and
 *   the domain stays.
 * - Trigger facts and field paths are recorded on every requirement, so
 *   the freeze is traceable (test contract T143).
 * - Classification can be per-option: a signal that names option IDs
 *   restricts the domain to those options; no option list means the
 *   domain applies to every option.
 *
 * This module is a pure service: no host, network, filesystem, clock, or
 * random dependency. It consumes the CWE-003 contracts read-only.
 */
import { type CriticalDomain, type CriticalDomainRequirement, type DecisionBrief, type SeatId } from '../contracts/index.js';
/** Fixed reviewer table from Section 12.7. */
export declare const CRITICAL_DOMAIN_REVIEWERS: Readonly<Record<CriticalDomain, {
    required_seat_id: SeatId | null;
    required_checker: 'seat' | 'qualified_professional';
    reviewer_note: string;
}>>;
/** One structured signal that a critical domain may be triggered. */
export interface CriticalDomainSignal {
    domain: CriticalDomain;
    /**
     * Where the signal came from. Intake facts and constraint tags are the
     * authoritative triggers; a model proposal also triggers, but a model
     * can never remove (see model_removal_requests on the input).
     */
    origin: 'intake_fact' | 'constraint_tag' | 'model_proposal';
    /** Structured intake fact IDs that triggered the domain. */
    trigger_fact_ids: string[];
    /** Field paths that triggered the domain, for example constraints.con-1. */
    trigger_field_paths: string[];
    /** Options the domain applies to; empty means every option. */
    applies_to_option_ids: string[];
    /** Questions already known to be open at freeze time. */
    open_questions: string[];
}
export interface CriticalDomainClassificationInput {
    signals: CriticalDomainSignal[];
    /** The frozen policy version recorded on every requirement. */
    policy_version: string;
    /**
     * Domains a model asked to remove. A removal never takes effect on a
     * triggered domain; each such request is returned in rejected_removals.
     */
    model_removal_requests?: CriticalDomain[];
}
/** Per-option applicability of a domain; absence of pairs means global. */
export interface CriticalDomainApplicability {
    domain: CriticalDomain;
    option_id: string;
}
export interface CriticalDomainClassification {
    /** Schema-valid frozen requirements, in canonical domain order. */
    requirements: CriticalDomainRequirement[];
    /** Option restrictions; a domain with no pairs applies to all options. */
    applicability: CriticalDomainApplicability[];
    /** One deterministic explanation per triggered domain. */
    explanations: string[];
    /** Model removal requests that targeted a triggered domain. */
    rejected_removals: CriticalDomain[];
    /** Canonical hash of the frozen requirements (traceability, T143). */
    classification_sha256: string;
}
/**
 * Classify critical domains from structured signals. Pure and
 * deterministic: the same input always yields the same frozen output.
 */
export declare function classifyCriticalDomains(input: CriticalDomainClassificationInput): CriticalDomainClassification;
/**
 * Per-option critical-domain applicability derived from a frozen brief
 * (CWE-050 consolidation: this is the ONE implementation; the copies
 * that lived in protocol/verdict.ts and protocol/ratification.ts were
 * byte-identical and now import this). A requirement whose trigger
 * paths name brief constraints (the canonical `constraints.<id>`
 * dialect) applies to the options those constraints apply to; a
 * requirement with no such restriction contributes no pairs and is
 * global (absence of pairs means global).
 */
export declare function deriveCriticalDomainApplicability(brief: DecisionBrief): CriticalDomainApplicability[];
