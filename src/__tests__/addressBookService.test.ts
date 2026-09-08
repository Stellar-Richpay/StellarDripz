/**
 * Unit tests for addressBookService
 */
import {
  getAddressBookEntries,
  addAddressBookEntry,
  updateAddressBookEntry,
  removeAddressBookEntry,
} from "@/services/addressBookService";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
  jest.clearAllMocks();
});

describe("addressBookService", () => {
  describe("getAddressBookEntries", () => {
    it("returns empty array when no entries exist", () => {
      expect(getAddressBookEntries()).toEqual([]);
    });

    it("returns entries sorted by name", () => {
      addAddressBookEntry("Charlie", "GCHARLIE1234567890123456789012345678901234");
      addAddressBookEntry("Alice", "GALICE123456789012345678901234567890123456");
      addAddressBookEntry("Bob", "GBOB12345678901234567890123456789012345678");

      const entries = getAddressBookEntries();
      expect(entries).toHaveLength(3);
      expect(entries[0].name).toBe("Alice");
      expect(entries[1].name).toBe("Bob");
      expect(entries[2].name).toBe("Charlie");
    });
  });

  describe("addAddressBookEntry", () => {
    it("adds a new entry", () => {
      const entry = addAddressBookEntry("My Wallet", "GDEST123456789012345678901234567890123456");

      expect(entry.name).toBe("My Wallet");
      expect(entry.address).toBe("GDEST123456789012345678901234567890123456");
      expect(entry.id).toBeDefined();
      expect(entry.createdAt).toBeGreaterThan(0);
      expect(getAddressBookEntries()).toHaveLength(1);
    });

    it("trims whitespace from name and address", () => {
      const entry = addAddressBookEntry(
        "  My Wallet  ",
        "  GDEST123456789012345678901234567890123456  ",
      );

      expect(entry.name).toBe("My Wallet");
      expect(entry.address).toBe("GDEST123456789012345678901234567890123456");
    });

    it("caps names longer than the max label length", () => {
      const longName = "x".repeat(200);
      const entry = addAddressBookEntry(longName, "GCAP123456789012345678901234567890123456789");
      expect(entry.name).toHaveLength(40);
    });

    it("evicts the oldest entry when the book is at capacity", () => {
      for (let i = 0; i < 100; i++) {
        addAddressBookEntry(
          `Name ${i}`,
          `GADDR${String(i).padStart(3, "0")}1234567890123456789012345678901234`,
        );
      }
      expect(getAddressBookEntries()).toHaveLength(100);

      // The 101st add must evict the oldest (Name 0) rather than grow past cap.
      addAddressBookEntry("Newest", "GNEW123456789012345678901234567890123456789");
      const entries = getAddressBookEntries();
      expect(entries).toHaveLength(100);
      expect(entries.find((e) => e.name === "Newest")).toBeDefined();
      expect(entries.find((e) => e.name === "Name 0")).toBeUndefined();
    });

    it("updates name for duplicate addresses instead of creating new entry", () => {
      const entry1 = addAddressBookEntry(
        "Original Name",
        "GDUP123456789012345678901234567890123456789",
      );
      const entry2 = addAddressBookEntry(
        "Updated Name",
        "GDUP123456789012345678901234567890123456789",
      );

      expect(entry2.id).toBe(entry1.id);
      expect(entry2.name).toBe("Updated Name");
      expect(getAddressBookEntries()).toHaveLength(1);
    });

    it("does not modify name if duplicate with same name", () => {
      const entry1 = addAddressBookEntry(
        "Same Name",
        "GSAME12345678901234567890123456789012345678",
      );
      const entry2 = addAddressBookEntry(
        "Same Name",
        "GSAME12345678901234567890123456789012345678",
      );

      expect(entry2.id).toBe(entry1.id);
      expect(entry2.name).toBe("Same Name");
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1); // Only first add persisted
    });
  });

  describe("updateAddressBookEntry", () => {
    it("caps an updated name at the max label length", () => {
      const entry = addAddressBookEntry("Old", "GUPDC12345678901234567890123456789012345678");
      updateAddressBookEntry(entry.id, { name: "y".repeat(80) });
      const entries = getAddressBookEntries();
      expect(entries[0].name).toHaveLength(40);
    });

    it("updates an existing entry name", () => {
      const entry = addAddressBookEntry("Old Name", "GUPD123456789012345678901234567890123456789");

      const updated = updateAddressBookEntry(entry.id, { name: "New Name" });
      expect(updated).toBe(true);

      const entries = getAddressBookEntries();
      expect(entries[0].name).toBe("New Name");
      expect(entries[0].address).toBe("GUPD123456789012345678901234567890123456789");
    });

    it("updates an existing entry address", () => {
      const entry = addAddressBookEntry("My Wallet", "GOLD123456789012345678901234567890123456789");

      updateAddressBookEntry(entry.id, {
        address: "GNEW123456789012345678901234567890123456789",
      });

      const entries = getAddressBookEntries();
      expect(entries[0].address).toBe("GNEW123456789012345678901234567890123456789");
    });

    it("returns false for non-existent id", () => {
      const result = updateAddressBookEntry("non-existent-id", {
        name: "Whatever",
      });
      expect(result).toBe(false);
    });
  });

  describe("removeAddressBookEntry", () => {
    it("removes an existing entry", () => {
      const entry = addAddressBookEntry("To Delete", "GDEL123456789012345678901234567890123456789");
      expect(getAddressBookEntries()).toHaveLength(1);

      const removed = removeAddressBookEntry(entry.id);
      expect(removed).toBe(true);
      expect(getAddressBookEntries()).toHaveLength(0);
    });

    it("returns false for non-existent id", () => {
      const result = removeAddressBookEntry("non-existent-id");
      expect(result).toBe(false);
    });

    it("only removes the targeted entry", () => {
      const entry1 = addAddressBookEntry("Keep Me", "GKEEP12345678901234567890123456789012345678");
      const entry2 = addAddressBookEntry(
        "Delete Me",
        "GDELM12345678901234567890123456789012345678",
      );

      removeAddressBookEntry(entry2.id);

      const entries = getAddressBookEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(entry1.id);
    });
  });
});
