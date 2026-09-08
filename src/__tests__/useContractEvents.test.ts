/**
 * Tests for the pure dedupe helpers in useContractEvents.
 *
 * The hook merges events from two channels — SSE and direct RPC polling —
 * that can deliver the same ledger event twice (or more). The keying and
 * merge logic is pure, so it gets its own unit tests here without needing
 * EventSource/interval scaffolding.
 */
import { appendUnique, eventKey } from "@/hooks/useContractEvents";
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
