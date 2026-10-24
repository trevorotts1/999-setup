/**
 * Pure TypeScript SHA-256 (FIPS 180-4).
 *
 * The deterministic core hashes exactly the canonical bytes it accepts and
 * stores (directive Section 11.6). A pure implementation keeps the core free
 * of host crypto imports so the same code produces the same hashes in the
 * canonical core, Command Center, and the 999 bundle (test contract T148).
 * Correctness is pinned by published test vectors in the test suite and by a
 * cross-check against the host crypto implementation there.
 */
/** SHA-256 digest of the given bytes, as lowercase hex. */
export declare function sha256Hex(bytes: Uint8Array): string;
