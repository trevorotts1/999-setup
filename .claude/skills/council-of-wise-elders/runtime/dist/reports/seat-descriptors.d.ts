import { type SeatId } from '../contracts/index.js';
export interface SeatDescriptor {
    seat_id: SeatId;
    /** Plain-language lane, e.g. "purpose and strategic alignment". */
    lane: string | null;
    /** The one question this seat exists to answer. */
    owned_question: string | null;
}
/**
 * Load the shipped seat descriptors once. Returns an empty map when the
 * packs are not beside the runtime; the report then omits the focus line
 * instead of inventing one.
 */
export declare function loadSeatDescriptors(): Partial<Record<SeatId, SeatDescriptor>>;
