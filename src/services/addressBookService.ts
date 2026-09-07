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
    // Update name if different
    if (existing.name !== name) {
      existing.name = name;
      saveAll(entries);
    }
    return existing;
  }

  const entry: AddressBookEntry = {
    id: `ab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    address: address.trim(),
    createdAt: Date.now(),
  };

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

  if (updates.name !== undefined) entry.name = updates.name.trim();
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
