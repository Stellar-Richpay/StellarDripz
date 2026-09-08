/**
 * Tests for the client-side memo byte-length validation.
 *
 * The Stellar text-memo limit is 28 *bytes* (validateMemo on the server
 * agrees); a character-count check would let multi-byte memos through to the
 * signing prompt only to be rejected by Horizon afterwards.
 */
import { MAX_MEMO_BYTES, memoByteLength, getMemoError } from "@/lib/stellar/memo";

describe("memoByteLength", () => {
  it("counts ASCII as one byte per character", () => {
    expect(memoByteLength("")).toBe(0);
    expect(memoByteLength("hello")).toBe(5);
    expect(memoByteLength("x".repeat(28))).toBe(28);
  });

  it("counts multi-byte UTF-8 characters by their encoded size", () => {
    // é is 2 bytes in UTF-8.
    expect(memoByteLength("é")).toBe(2);
    // An emoji is 4 bytes in UTF-8.
    expect(memoByteLength("💧")).toBe(4);
    // 28 emoji = 112 bytes, not 28 "characters".
    expect(memoByteLength("💧".repeat(28))).toBe(112);
  });
});

describe("getMemoError", () => {
  it("accepts empty and undefined memos", () => {
    expect(getMemoError()).toBeNull();
    expect(getMemoError("")).toBeNull();
  });

  it("accepts memos up to exactly 28 bytes", () => {
    expect(getMemoError("a".repeat(28))).toBeNull();
    // 14 é = 28 bytes exactly.
    expect(getMemoError("é".repeat(14))).toBeNull();
  });

  it("rejects memos over 28 bytes", () => {
    expect(getMemoError("a".repeat(29))).toMatch(/28 bytes/i);
    // 8 emoji = 32 bytes — would pass a character-count check.
    expect(getMemoError("💧".repeat(8))).toMatch(/28 bytes/i);
  });

  it("exposes the protocol limit constant", () => {
    expect(MAX_MEMO_BYTES).toBe(28);
  });
});
