"use client";

import { useAppContext } from "@/context/AppContext";
import type { TransactionRecord } from "@/types/stellar";

/**
 * Dedicated transaction feedback component.
 * Shows the most recent transaction status with rich details.
 */
export default function TransactionFeedback() {
  const { state } = useAppContext();
  const latestTx: TransactionRecord | null = state.transactions[0] || null;

  if (!latestTx) return null;

  const statusColors = {
    pending: "border-yellow-500/20 bg-yellow-500/5 text-yellow-400",
    success: "border-green-500/20 bg-green-500/5 text-green-400",
    error: "border-red-500/20 bg-red-500/5 text-red-400",
    idle: "border-white/10 bg-white/5 text-white/40",
  };

  const statusIcons = {
    pending: "⏳",
    success: "✅",
    error: "❌",
    idle: "—",
  };

  const typeLabels = {
    faucet: "Faucet Request",
    send: "Send Payment",
    contract: "Contract Call",
  };

  // Records can carry values outside the known unions (older rows, migrated
  // data, or future types written by a newer backend). Look them up
  // defensively so an unknown status renders the neutral idle styling instead
  // of a broken `undefined` class name, and an unknown type labels the row
  // "Transaction" instead of printing the literal string "undefined".
  const status =
    latestTx.status in statusColors ? latestTx.status : ("idle" as keyof typeof statusColors);
  const type = latestTx.type in typeLabels ? latestTx.type : ("send" as keyof typeof typeLabels);

  return (
    <div className={`rounded-xl border px-4 py-3 ${statusColors[status]}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === "pending" ? (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-yellow-400/30 border-t-yellow-400"
              role="status"
              aria-label="Transaction pending"
            />
          ) : (
            <span>{statusIcons[status]}</span>
          )}
          <span className="text-xs font-semibold">{typeLabels[type]}</span>
          <span className="text-[10px] opacity-60 uppercase">{status}</span>
        </div>
        <span className="text-[10px] opacity-60">
          {latestTx.timestamp ? latestTx.timestamp.toLocaleTimeString() : ""}
        </span>
      </div>

      {latestTx.hash && latestTx.status === "success" && (
        <div className="mt-2">
          <p className="font-mono text-[10px] break-all opacity-70">
            TX: {latestTx.hash.slice(0, 24)}...
          </p>
          {latestTx.explorerUrl && (
            <a
              href={latestTx.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] underline opacity-70 hover:opacity-100"
            >
              View on Explorer ↗
            </a>
          )}
        </div>
      )}

      {latestTx.status === "error" && latestTx.errorMessage && (
        <p className="mt-1 text-[10px] opacity-80">{latestTx.errorMessage}</p>
      )}

      {latestTx.amount && (
        <p className="mt-1 text-[10px] opacity-60">
          {latestTx.amount} {latestTx.assetCode || "XLM"} → {latestTx.destination.slice(0, 8)}...
        </p>
      )}
    </div>
  );
}
