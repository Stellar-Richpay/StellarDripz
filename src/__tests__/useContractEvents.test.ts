/**
 * Tests for the pure dedupe helpers in useContractEvents.
 *
 * The hook merges events from two channels — SSE and direct RPC polling —
 * that can deliver the same ledger event twice (or more). The keying and
 * merge logic is pure, so it gets its own unit tests here without needing
 * EventSource/interval scaffolding.
 */
import { appendUnique, eventKey, filterFresh } from "@/hooks/useContractEvents";
import type { ContractEvent } from "@/types/stellar";

function makeEvent(overrides: Partial<ContractEvent> = {}): ContractEvent {
  return {
    id: "evt-1",
    contractId: "CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM",
    topic: "transfer",
    value: "100",
    ledgerSequence: 0,
    txHash: "",
    timestamp: new Date(),
    ...overrides,
  };
}

describe("eventKey", () => {
  it("distinguishes events by contract, topic, value, ledger, and hash", () => {
    const a = makeEvent({ topic: "transfer", value: "100", ledgerSequence: 5, txHash: "x" });
    const b = makeEvent({ topic: "transfer", value: "100", ledgerSequence: 5, txHash: "y" });
    expect(eventKey(a)).not.toBe(eventKey(b));
  });

  it("treats absent ledger/txHash consistently (stable key)", () => {
    // The default event carries no ledger/hash; two such events must key
    // identically so the same SSE + polling pair is deduped regardless of
    // which channel reported it first.
    expect(eventKey(makeEvent())).toBe(eventKey(makeEvent()));
  });
});

describe("appendUnique", () => {
  it("prepends fresh events newest-first", () => {
    const prev = [makeEvent({ id: "old", topic: "a" })];
    const fresh = [makeEvent({ id: "new", topic: "b" })];
    const next = appendUnique(prev, fresh);
    expect(next.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("drops events whose key already exists (SSE + polling overlap)", () => {
    const dup = makeEvent({ id: "dup", topic: "transfer", value: "100" });
    const next = appendUnique([dup], [makeEvent({ id: "dup2", topic: "transfer", value: "100" })]);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("dup");
  });

  it("returns the previous list unchanged when nothing is new", () => {
    const prev = [makeEvent({ id: "only", topic: "t" })];
    expect(appendUnique(prev, [])).toBe(prev);
    expect(appendUnique(prev, [makeEvent({ id: "clone", topic: "t" })])).toBe(prev);
  });

  it("caps the merged list at 100 events", () => {
    const prev = Array.from({ length: 99 }, (_, i) => makeEvent({ id: `p${i}`, topic: "a" }));
    const next = appendUnique(prev, [makeEvent({ id: "fresh", topic: "b" })]);
    expect(next).toHaveLength(100);
    expect(next[0].id).toBe("fresh");
  });
});

describe("filterFresh", () => {
  it("keeps events seen for the first time and records their keys", () => {
    const seen = new Set<string>();
    const a = makeEvent({ topic: "transfer", value: "100", ledgerSequence: 5 });
    const b = makeEvent({ topic: "mint", value: "50", ledgerSequence: 6 });

    const fresh = filterFresh([a, b], seen);
    expect(fresh).toHaveLength(2);
    expect(seen.has(eventKey(a))).toBe(true);
    expect(seen.has(eventKey(b))).toBe(true);
  });

  it("drops events from a later round whose key was already seen", () => {
    const seen = new Set<string>();
    const evt = makeEvent({ topic: "transfer", value: "100", ledgerSequence: 5 });

    // Round 1 delivers the event.
    expect(filterFresh([evt], seen)).toHaveLength(1);
    // Round 2 re-delivers the same on-chain event (same ledger, same value,
    // empty txHash — exactly what the direct-poll fallback produces). The
    // display list may have grown or the event may have scrolled off the cap;
    // either way it must not be re-added.
    expect(
      filterFresh([makeEvent({ topic: "transfer", value: "100", ledgerSequence: 5 })], seen),
    ).toHaveLength(0);
  });

  it("keeps distinct events even when they share a topic", () => {
    const seen = new Set<string>();
    const a = makeEvent({ topic: "transfer", value: "100", ledgerSequence: 5 });
    const b = makeEvent({ topic: "transfer", value: "200", ledgerSequence: 6 });
    expect(filterFresh([a], seen)).toHaveLength(1);
    expect(filterFresh([b], seen)).toHaveLength(1);
  });

  it("returns an empty list without mutating the set when nothing is new", () => {
    const seen = new Set<string>();
    const evt = makeEvent({ topic: "transfer" });
    filterFresh([evt], seen);
    expect(filterFresh([evt], seen)).toHaveLength(0);
    expect(seen.size).toBe(1);
  });
});
