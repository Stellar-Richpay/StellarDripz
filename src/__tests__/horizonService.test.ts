/**
 * Service-layer tests for horizonService's error classification.
 *
 * Caller mistakes (invalid addresses, bad memos, mainnet-only features)
 * must surface as HttpError(400) so routes map them to 4xx responses —
 * not as generic errors that become opaque 500s in production.
 */

// http.ts (imported transitively by horizonService) touches next/server at
// module load, so provide the same minimal shim the route tests use.
jest.mock("next/server", () => {
  class MockNextRequest {
    url: string;
    method: string;
    headers: { get: (name: string) => string | null };
    private bodyStr: string;
    constructor(input: string, init?: RequestInit) {
      this.url = input;
      this.method = init?.method || "GET";
      this.headers = {
        get: (name: string) =>
          (init?.headers as Record<string, string> | undefined)?.[name.toLowerCase()] ?? null,
      };
      this.bodyStr = (init as { body?: string } | undefined)?.body || "";
    }
    async json() {
      try {
        return JSON.parse(this.bodyStr);
      } catch {
        return {};
      }
    }
    async text() {
      return this.bodyStr;
    }
  }
  class MockNextResponse {
    status: number;
    private body: unknown;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status || 200;
      this.body = body;
    }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
    async json() {
      if (typeof this.body === "string") {
        try {
          return JSON.parse(this.body);
        } catch {
          return this.body;
        }
      }
      return this.body;
    }
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse };
});

import { sendPaymentServer, assertFaucetAllowed } from "@/lib/server/horizonService";
import { HttpError } from "@/lib/server/http";

// Mock a mainnet configuration so assertFaucetAllowed has something to
// reject. All assertions below fail before any XDR decode or Horizon call.
jest.mock("@/lib/stellar/network", () => ({
  STELLAR_NETWORK: {
    network: "MAINNET",
    horizonUrl: "https://horizon.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    sorobanRpcUrl: "https://soroban-rpc.mainnet.stellar.org",
    stellarExpertUrl: "https://stellar.expert/explorer/public",
    contractExplorerUrl: "https://stellar.expert/explorer/public/contract",
  },
}));

/** Checksum-valid addresses (any value works — validation throws first). */
const SENDER = "GCNIK6CGM3DXD3NJPZBG4Z76NGCU6YNID3TK7OSTKOJXF3ALBVJWESXK";
const DEST = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("horizonService error classification", () => {
  describe("sendPaymentServer", () => {
    it("classifies an invalid destination as a 400 client error", async () => {
      await expect(
        sendPaymentServer(SENDER, "not-an-xdr", "not-an-address", "100", "XLM", {}),
      ).rejects.toMatchObject({ status: 400, message: /Invalid destination/i });
    });

    it("classifies a memo longer than 28 bytes as a 400 client error", async () => {
      const longMemo = "x".repeat(29);
      await expect(
        sendPaymentServer(SENDER, "not-an-xdr", DEST, "100", "XLM", {}, undefined, longMemo),
      ).rejects.toMatchObject({ status: 400, message: /Memo/i });
    });

    it("classifies invalid destination as HttpError, not a plain Error", async () => {
      const promise = sendPaymentServer(SENDER, "not-an-xdr", "bad", "100", "XLM", {});
      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
    });
  });

  describe("assertFaucetAllowed", () => {
    it("rejects faucet funding on mainnet as a 400 client error", () => {
      let thrown: unknown;
      try {
        assertFaucetAllowed();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as HttpError).status).toBe(400);
      expect((thrown as HttpError).message).toMatch(/test networks/i);
    });
  });
});
