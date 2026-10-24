import { type SeatId } from '../contracts/enums.js';
export declare const BOOK_TO_PERSONA_FOLDER = "22-book-to-persona-coaching-leadership-system";
export interface BookToPersonaRoot {
    /** Directory holding persona-categories.json + personas/. */
    skill_root: string;
    personas_dir: string;
    categories_path: string;
    resolved_from: 'env:BOOK_TO_PERSONA_ROOT' | 'env:OPENCLAW_SKILLS_DIR' | 'host_layout_skill_dir' | 'openclaw_default';
}
export interface PersonaRootOptions {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}
export declare function resolveBookToPersonaRoot(opts?: PersonaRootOptions): BookToPersonaRoot | null;
export interface LivePersonaInventory {
    /**
     * `found` means a store was resolved. `unreadable` is set (with the error
     * class name, never a path) when it was resolved but could not be read, so
     * a broken store is never reported as a missing one.
     */
    root: {
        resolved_from: string;
        found: boolean;
        unreadable?: true;
        error?: string;
    };
    seats: Array<{
        seat_id: SeatId;
        layer: 'live_book_to_persona' | 'shipped_brief_fallback';
        personas: Array<{
            key: string;
            book: string;
            content_level: string;
        }>;
    }>;
}
/**
 * A seat is live only when at least one of its personas has a
 * persona-blueprint.md on disk; a registry entry with no files (or only
 * side notes) cannot brief an elder, so the shipped brief stays in force.
 */
export declare function inventoryLivePersonas(opts?: PersonaRootOptions): LivePersonaInventory;
