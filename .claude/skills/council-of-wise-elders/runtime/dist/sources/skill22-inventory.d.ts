import { type SeatId } from '../contracts/enums.js';
export declare const SKILL22_PERSONA_FILES: readonly ["persona-blueprint.md", "analysis-notes.md", "extraction-notes.md", "PLAYBOOK-APPENDIX.md", "source.json"];
export interface PersonaFileReceipt {
    file: string;
    bytes: number;
    sha256: string;
}
export interface ExistingBookPersona {
    key: string;
    author: string;
    book: string;
    files: PersonaFileReceipt[];
    content_level: 'extraction_and_blueprint' | 'blueprint_only' | 'other_derived' | 'missing';
    source_quality_certified: false;
    limitation: string;
}
export interface Skill22CouncilSeatInventory {
    seat_id: SeatId;
    display_name: string;
    existing_personas: ExistingBookPersona[];
    registered_persona_count: number;
}
export interface Skill22CouncilInventory {
    schema: 'wise-elders.skill22-preservation-inventory/v1';
    source: string;
    source_kind: 'Skill 22 registered derivative files, NOT original book ingestion receipts';
    approved_seat_count: 9;
    existing_registered_personas: number;
    personas_with_extraction_notes: number;
    personas_blueprint_only: number;
    seats: Skill22CouncilSeatInventory[];
    unrecognized_registry_entries: number;
}
export declare function inventoryCouncilSkill22Personas(skill22Root: string, categoriesPath?: string): Skill22CouncilInventory;
