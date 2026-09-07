"use client";

import { useState } from "react";
import { useAppContext } from "@/context/AppContext";
import type { TransactionRecord } from "@/types/stellar";

type TxFilter = "all" | TransactionRecord["type"];

const FILTERS: { id: TxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "send", label: "Sends" },
  { id: "faucet", label: "Faucet" },
  { id: "contract", label: "Contracts" },
];

function TxStatusBadge({ status }: { status: TransactionRecord["status"] }) {
  const styles = {
    pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    success: "bg-green-500/10 text-green-400 border-green-500/20",
    error: "bg-red-500/10 text-red-400 border-red-500/20",
    idle: "bg-white/5 text-white/40 border-white/10",
  };

  const labels = {
    pending: "⏳ Pending",
    success: "✅ Success",
    error: "❌ Failed",
    idle: "—",
  };

  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
        styles[status]
      }`}
    >
      {labels[status]}
    </span>
  );
}

function TxRow({ tx }: { tx: TransactionRecord }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">
            {tx.type === "faucet" ? "💧" : tx.type === "contract" ? "📜" : "📤"}
          </span>
          <span className="text-xs font-semibold text-white/80">
            {tx.type === "faucet"
              ? "Faucet Request"
              : tx.type === "contract"
                ? "Contract Call"
                : "Send Payment"}
          </span>
        </div>
        <TxStatusBadge status={tx.status} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-white/50">
        <div>
          <span className="text-white/30">Amount: </span>
          <span className="font-mono text-white/60">
            {tx.type === "faucet" ? "10,000" : tx.amount} {tx.assetCode || "XLM"}
          </span>
        </div>
        <div>
          <span className="text-white/30">To: </span>
          <span className="font-mono text-white/60 truncate">
            {tx.destination.slice(0, 8)}...{tx.destination.slice(-6)}
          </span>
        </div>
      </div>

      {/* Hash / Error */}
      {/* Memo (sends only) */}
      {tx.type === "send" && (tx as TransactionRecord & { memo?: string }).memo && (
        <div className="mt-1.5 text-[11px] text-white/40">
          <span className="text-white/30">Memo: </span>
          <span className="font-mono">{(tx as TransactionRecord & { memo?: string }).memo}</span>
        </div>
      )}

      {tx.hash && tx.status === "success" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {tx.explorerUrl ? (
            <a
              href={tx.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open transaction on StellarExpert"
              className="font-mono text-[10px] text-stellar-green/70 hover:text-stellar-blue truncate max-w-[200px] transition-colors"
            >
              {tx.hash.slice(0, 16)}... ↗
            </a>
          ) : (
            <span className="font-mono text-[10px] text-stellar-green/70 truncate max-w-[200px]">
              {tx.hash.slice(0, 16)}...
            </span>
          )}
        </div>
      )}

      {tx.status === "error" && tx.errorMessage && (
        <div className="mt-2 rounded-lg border border-red-500/10 bg-red-500/[0.03] px-3 py-1.5">
          <p className="text-[11px] text-red-400">{tx.errorMessage}</p>
        </div>
      )}

      <p className="mt-2 text-[10px] text-white/20">{tx.timestamp.toLocaleString()}</p>
    </div>
  );
}

export default function TransactionHistory() {
  const { state } = useAppContext();
  const { wallet, transactions } = state;
  const [filter, setFilter] = useState<TxFilter>("all");

  if (!wallet.connected) return null;

  const visible = filter === "all" ? transactions : transactions.filter((t) => t.type === filter);

  return (
    <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-6 backdrop-blur-md animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">
          Transaction History
        </h3>
        {transactions.length > 0 && (
          <span className="text-xs text-white/30">{transactions.length} recent</span>
        )}
      </div>

      {transactions.length > 0 && (
        <div className="mb-3 flex gap-1.5" role="tablist" aria-label="Filter transactions by type">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={`rounded-lg px-3 py-1 text-xs transition-colors ${
                filter === id
                  ? "bg-stellar-purple/20 text-white border border-stellar-purple/30"
                  : "border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
          <p className="text-sm text-white/40">
            {transactions.length === 0
              ? "No transactions yet. Try the faucet or send XLM!"
              : `No ${filter} transactions yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {visible.map((tx) => (
            <TxRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}
    </div>
  );
}
