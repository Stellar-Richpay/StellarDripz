/**
 * Tests for the Stellar contract ID validator.
 */
import { isValidContractId, getContractIdError } from "@/lib/stellar/contractId";

// A checksum-valid C... address (56 chars).
const VALID_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("isValidContractId", () => {
  it("accepts a valid C contract address", () => {
    expect(isValidContractId(VALID_ID)).toBe(true);
  });

  it("rejects empty, wrong-length, and wrong-prefix inputs", () => {
    expect(isValidContractId("")).toBe(false);
    expect(isValidContractId(VALID_ID.slice(0, 30))).toBe(false);
    expect(isValidContractId(`G${VALID_ID.slice(1)}`)).toBe(false);
  });

  it("rejects a wrong-checksum id that matches the character set", () => {
    // 56 C-address chars but invalid base32/CRC16 checksum.
    expect(isValidContractId("C" + "A".repeat(55))).toBe(false);
  });

  it("does not silently accept surrounding whitespace", () => {
    expect(isValidContractId(` ${VALID_ID}`)).toBe(false);
  });
});

describe("getContractIdError", () => {
  it("returns null for a valid id", () => {
    expect(getContractIdError(VALID_ID)).toBeNull();
  });

  it("explains why an id is invalid", () => {
    expect(getContractIdError("")).toContain("required");
    expect(getContractIdError("CC123")).toContain("56 characters");
    expect(getContractIdError("G".repeat(56))).toContain("start with 'C'");
    expect(getContractIdError("C" + "A".repeat(55))).toContain("checksum");
  });
});
