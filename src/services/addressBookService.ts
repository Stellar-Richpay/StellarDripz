export interface AddressBookEntry {
  id: string;
  name: string;
  address: string;
  createdAt: number;
}

import { storageGetJSON, storageSetJSON } from "@/lib/storage";

export interface AddressBookEntry {
  id: string;
  name: string;
  address: string;
  createdAt: number;
}

const STORAGE_KEY = "stellardripz_address_book";

/** Longest label a user may store, bounding per-entry storage cost. */
export const MAX_NAME_LENGTH = 40;
/**
 * Most entries the address book will keep. localStorage is a bounded
 * resource shared with cooldowns and wallet sessions; an unbounded book
 * (users can add hundreds of entries) would grow without limit. When full,
 * the oldest entry is evicted to make room.
 */
export const MAX_ENTRIES = 100;

function getAll(): AddressBookEntry[] {
  return storageGetJSON<AddressBookEntry[]>(STORAGE_KEY) ?? [];
}

function saveAll(entries: AddressBookEntry[]): void {
  storageSetJSON(STORAGE_KEY, entries);
}

export function getAddressBookEntries(): AddressBookEntry[] {
  return getAll().sort((a, b) => a.name.localeCompare(b.name));
}

export function addAddressBookEntry(name: string, address: string): AddressBookEntry {
  const entries = getAll();

  // Don't add duplicate addresses
  const existing = entries.find((e) => e.address === address);
  if (existing) {
    // Update name if different (still capped at the max label length)
    const capped = name.trim().slice(0, MAX_NAME_LENGTH);
    if (existing.name !== capped) {
      existing.name = capped;
      saveAll(entries);
    }
    return existing;
  }

  // Bounds: cap label length, and when the book is at capacity evict the
  // oldest entry so the storage footprint stays flat instead of growing
  // without limit across months of use.
  const entry: AddressBookEntry = {
    id: `ab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, MAX_NAME_LENGTH),
    address: address.trim(),
    createdAt: Date.now(),
  };

  if (entries.length >= MAX_ENTRIES) {
    const oldest = entries.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    entries.splice(entries.indexOf(oldest), 1);
  }

  entries.push(entry);
  saveAll(entries);
  return entry;
}

export function updateAddressBookEntry(
  id: string,
  updates: Partial<Pick<AddressBookEntry, "name" | "address">>,
): boolean {
  const entries = getAll();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return false;

  if (updates.name !== undefined) entry.name = updates.name.trim().slice(0, MAX_NAME_LENGTH);
  if (updates.address !== undefined) entry.address = updates.address.trim();
  saveAll(entries);
  return true;
}

export function removeAddressBookEntry(id: string): boolean {
  const entries = getAll();
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) return false;
  saveAll(filtered);
  return true;
}
