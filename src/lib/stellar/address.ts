/**
 * Shared Stellar account address validation.
 *
 * Several components, API routes, and services previously each rolled their
 * own try/catch around StrKey.decodeEd25519PublicKey with subtly different
 * behavior (some trimmed, some did not; some only ran length checks). This
 * module centralizes the checksum-verified validation so every caller
 * behaves identically.
 */
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * True when the string is a checksum-valid Stellar ed25519 public key
 * (G... address). Empty strings and whitespace-padded values are invalid;
 * callers that accept surrounding whitespace should trim before calling.
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address || address.length !== 56) return false;
  if (address[0] !== "G") return false;
  try {
    StellarSdk.StrKey.decodeEd25519PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trimmed variant used by form inputs where users may paste stray
 * whitespace or newlines.
 */
export function isValidStellarAddressTrimmed(address: string): boolean {
  return isValidStellarAddress(address.trim());
}

/**
 * Return a user-facing error message when the address is not usable, or
 * null when it is valid. Optional label ("recipient", "wallet address"…)
 * keeps messages specific without duplicating the checks.
 */
export function getAddressError(address: string, label = "address"): string | null {
  const trimmed = address.trim();
  if (!trimmed) return `${capitalize(label)} is required`;
  if (trimmed.length !== 56) return `${capitalize(label)} must be 56 characters`;
  if (trimmed[0] !== "G") return `${capitalize(label)} must start with 'G'`;
  if (!isValidStellarAddress(trimmed)) return `Invalid Stellar ${label} (checksum mismatch)`;
  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
