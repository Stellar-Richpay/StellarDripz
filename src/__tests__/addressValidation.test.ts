import {
  isValidStellarAddress,
  isValidStellarAddressTrimmed,
  getAddressError,
} from "@/lib/stellar/address";

// Real, checksum-valid testnet addresses (derived with StrKey).
const VALID_G = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
// A randomly derived, checksum-valid testnet public key.
const VALID_ALT = "GDAEYSBQM5DK6CTJBMOS4AQFCJ7IQWXLH5FCOMYGOCRFI2ARVYT3KOUZ";

describe("isValidStellarAddress", () => {
  it("accepts valid G addresses", () => {
    expect(isValidStellarAddress(VALID_G)).toBe(true);
  });

  it("rejects wrong-length, wrong-prefix, and empty inputs", () => {
    expect(isValidStellarAddress("")).toBe(false);
    expect(isValidStellarAddress("GAAA")).toBe(false);
    expect(isValidStellarAddress("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4")).toBe(
      false,
    );
    // G with a corrupted trailing char breaks the CRC16 checksum.
    expect(isValidStellarAddress(`${VALID_G.slice(0, -1)}X`)).toBe(false);
  });

  it("does not silently accept surrounding whitespace", () => {
    expect(isValidStellarAddress(` ${VALID_G}`)).toBe(false);
    expect(isValidStellarAddressTrimmed(` ${VALID_G}\n`)).toBe(true);
  });
});

describe("getAddressError", () => {
  it("returns null for valid addresses", () => {
    expect(getAddressError(VALID_G)).toBeNull();
  });

  it("explains why an address is invalid", () => {
    expect(getAddressError("")).toMatch(/required/i);
    expect(getAddressError("GAAA")).toMatch(/56 characters/i);
    expect(getAddressError("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4")).toMatch(
      /start with 'G'/i,
    );
    expect(getAddressError(`${VALID_G.slice(0, -1)}X`)).toMatch(/checksum/i);
  });

  it("honors a custom label", () => {
    expect(getAddressError("GAAA", "recipient address")).toMatch(/Recipient address/i);
  });
});
