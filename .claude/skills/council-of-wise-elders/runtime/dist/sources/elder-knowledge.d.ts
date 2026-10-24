/**
 * Elder knowledge: the three layers a seat reasons from (W28 Decision 4).
 *
 * (a) LIVE: the client's own Book-to-Persona (Skill 22) files, re-read on
 *     every call, so the Council improves when the personas improve.
 * (b) SAFETY NET: the shipped advisors/<seat>/briefing.md and
 *     sources.json, a frozen 2026-10-14 snapshot, used per seat only when
 *     that seat has no live persona on this box. A council never runs empty.
 * (c) FRESH FACTS: per-session web findings, stored as council_evidence
 *     rows (source_kind 'external_reference', summary.layer 'web_today').
 *     They reach a seat in their own labelled section and never mix with
 *     the elder's books.
 *
 * Nothing is fabricated or upgraded: live units are paraphrase /
 * unverified / reference_only, text comes from the files as read, and a
 * seat with neither layer reports 'none' and gets no invented text.
 */
import type { MaterialCatalog } from '../context/types.js';
import { type ScopeFields, type SeatId } from '../contracts/index.js';
import type { StoredSession } from '../cli/host-ports.js';
import type { EvidenceRecordInput } from '../persistence/repositories.js';
export declare const WEB_TODAY_LAYER = "web_today";
export declare const SHIPPED_SNAPSHOT_DATE = "2026-10-14";
export declare const BOOKS_SECTION_CAP = 20000;
/**
 * The one rule every round's system prompt carries so books and web facts
 * stay apart in a card. Shared here so the four rounds cannot drift.
 */
export declare const WEB_TODAY_SYSTEM_RULE: string;
export interface FreshFact {
    claim: string;
    url: string;
    title: string | null;
    /** ISO timestamp the finding was retrieved. */
    retrieved_at: string;
}
/** The council_evidence row for one web finding. Not the elder's principle. */
export declare function freshFactEvidenceRecord(fact: FreshFact, id: string): EvidenceRecordInput;
/** Only rows whose parsed summary_json.layer is 'web_today'; malformed ones are skipped, never repaired. */
export declare function freshFactsFromEvidenceRows(rows: Array<Record<string, unknown>>): FreshFact[];
export type SeatKnowledgeLayer = 'live_book_to_persona' | 'shipped_brief' | 'none';
/** Structural shape of sources/persona-root.ts BookToPersonaRoot (the fields used here). */
export interface BookToPersonaRootShape {
    skill_root: string;
    personas_dir: string;
    categories_path: string;
    resolved_from: string;
}
/** Which layers one seat's briefing was built from (journaled by the service). */
export interface SeatKnowledgeUse {
    seat_id: SeatId;
    layer: SeatKnowledgeLayer;
    /** Live Book-to-Persona keys read for this seat; empty for the other layers. */
    persona_keys: string[];
    /** Fresh web findings attached in their own labelled section. */
    web_fact_count: number;
}
export interface ElderKnowledge {
    loadSeatBriefing(seatId: SeatId, session?: StoredSession): Promise<{
        briefing_text: string;
    } | null>;
    catalog: MaterialCatalog;
    seatLayers(): Record<SeatId, SeatKnowledgeLayer>;
}
export declare function createElderKnowledge(opts: {
    skillRoot: string | null;
    personaRoot: BookToPersonaRootShape | null;
    scope: ScopeFields;
    listSessionEvidence?: (session: StoredSession) => Array<Record<string, unknown>>;
    /** Called after each session briefing load with the layer that load actually used. */
    onSeatBriefing?: (session: StoredSession, use: SeatKnowledgeUse) => void;
}): ElderKnowledge;
