/**
 * GET /api/events — SSE endpoint for real-time contract events.
 * Keeps the connection open and streams contract events as they occur.
 *
 * Query params:
 *   - contractId: Filter by contract ID (required)
 *   - pollInterval: Polling interval in ms (default 5000)
 */

import { NextRequest, NextResponse } from "next/server";
import { getContractEventsServer, getLatestLedgerServer } from "@/lib/server/sorobanService";
import { getClientIp } from "@/lib/server/rateLimiter";
import { isValidContractId } from "@/lib/stellar/contractId";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel function timeout: Hobby ~10s (60s max), Pro up to 300s for streaming.
// Set to the platform maximum so SSE streams live as long as the plan allows.
export const maxDuration = 300;

// Each SSE stream holds a connection open indefinitely, so unlike stateless
// routes a burst of tabs (or an attacker) can exhaust the function pool. Cap
// concurrent streams per IP; slots are released when a client disconnects.
const MAX_STREAMS_PER_IP = 5;
const activeStreams = new Map<string, number>();

function releaseStreamSlot(ip: string): void {
  const current = activeStreams.get(ip) || 0;
  if (current <= 1) activeStreams.delete(ip);
  else activeStreams.set(ip, current - 1);
}

async function* streamEvents(contractId: string, pollMs: number) {
  // Start near the head of the chain instead of ledger 0 (fast cold starts).
  let startLedger = 0;
  try {
    const latest = await getLatestLedgerServer();
    startLedger = Math.max(0, latest - 100);
  } catch {
    startLedger = 0;
  }

  // Instruct browsers (EventSource) to reconnect after 3s when the stream
  // drops, instead of their default polling backoff.
  yield `retry: 3000\n\n`;

  while (true) {
    try {
      const result = await getContractEventsServer(contractId, startLedger);

      if (result.events.length > 0) {
        for (const event of result.events) {
          yield `data: ${JSON.stringify({ ...event, contractId, timestamp: Date.now() })}\n\n`;
        }
      }

      // Advance the cursor past what we've seen. When the RPC returned events
      // we move past the last seen ledger; otherwise we jump to the current
      // chain head so empty polls don't re-scan the same window forever
      // (previously startLedger only advanced when events were found, so a
      // quiet contract re-delivered duplicates on every poll).
      if (result.events.length > 0) {
        startLedger = result.latestLedger + 1;
      } else {
        const latest = await getLatestLedgerServer();
        startLedger = Math.max(startLedger + 1, latest);
      }

      // Send a heartbeat to keep connection alive
      yield `: heartbeat ${Date.now()}\n\n`;
    } catch (err) {
      logger.error("SSE event stream error", err instanceof Error ? err : new Error(String(err)));
      yield `event: error\ndata: ${JSON.stringify({ error: "Stream error, reconnecting..." })}\n\n`;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contractId = searchParams.get("contractId");
  // Clamp the poll interval so clients can't pin streams to absurdly long
  // (or busy) cycles; default 5s, floor 1s, ceiling 60s.
  const pollInterval = Math.min(
    60_000,
    Math.max(1000, parseInt(searchParams.get("pollInterval") || "5000", 10) || 5000),
  );

  if (!contractId) {
    return NextResponse.json({ error: "contractId query parameter required" }, { status: 400 });
  }
  // Checksum-validate up front: an malformed ID would otherwise open a
  // stream that errors on every poll instead of failing fast, and would
  // hold a per-IP stream slot while doing so.
  if (!isValidContractId(contractId)) {
    return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const currentStreams = activeStreams.get(ip) || 0;
  if (currentStreams >= MAX_STREAMS_PER_IP) {
    logger.warn("SSE stream cap reached", { ip, contractId });
    return NextResponse.json(
      {
        error: `Too many active event streams from this connection (max ${MAX_STREAMS_PER_IP}). Close other tabs and reconnect.`,
      },
      { status: 429 },
    );
  }
  activeStreams.set(ip, currentStreams + 1);

  logger.info("SSE stream started", { contractId, pollInterval, ip });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const eventStream = streamEvents(contractId, pollInterval);

      for await (const chunk of eventStream) {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client disconnected
          break;
        }
      }
      releaseStreamSlot(ip);
    },
    cancel() {
      logger.info("SSE stream cancelled", { contractId, ip });
      releaseStreamSlot(ip);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
