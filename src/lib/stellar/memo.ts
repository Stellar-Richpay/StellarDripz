/**
 * Client-safe memo validation for Stellar text memos.
 *
 * Stellar's protocol limit for a text memo is 28 *bytes*, not characters.
 * JS `.length` counts UTF-16 code units, so "é" (2 bytes) or an emoji
 * (4 bytes) would pass a character-count check and then be rejected by
 * Horizon after the user already signed. Measure the UTF-8 encoding so the
 * client agrees with the server (validateMemo in horizonService.ts) and the
 * ledger.
 */

/** Maximum byte length of a Stellar text memo (protocol limit). */
export const MAX_MEMO_BYTES = 28;

/** UTF-8 byte length of a string (0 for empty). */
export function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length;
}

/** Returns an error message for an invalid memo, or null when acceptable. */
export function getMemoError(memo?: string): string | null {
  if (!memo) return null;
  if (memoByteLength(memo) > MAX_MEMO_BYTES) {
    return `Memo must be ${MAX_MEMO_BYTES} bytes or fewer`;
  }
  return null;
}
