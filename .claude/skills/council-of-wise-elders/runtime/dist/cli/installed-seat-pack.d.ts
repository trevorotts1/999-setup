import { type SeatId } from '../contracts/index.js';
export interface InstalledSeatPack {
    pack_version: string;
    briefing_text: string;
}
export declare function loadInstalledSeatPack(skillRoot: string, seatId: SeatId): InstalledSeatPack;
