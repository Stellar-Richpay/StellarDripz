"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAnalytics } from "@/lib/client/apiClient";

/**
 * The analytics API is gated by ADMIN_API_TOKEN when that env var is set.
 * The dashboard reads the operator's token from sessionStorage (never
 * localStorage — it should not survive the tab) and presents it on every
 * request. When the server has no token configured (local/dev) requests
 * stay open and no gate is shown.
 */
const TOKEN_STORAGE_KEY = "stellardripz_admin_token";

function readStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export default function AdminDashboard() {
  const [events, setEvents] = useState<
    Array<{ eventType: string; address: string; timestamp: number; data?: Record<string, unknown> }>
  >([]);
  const [summary, setSummary] = useState<
    Record<string, { total: number; uniqueAddresses: number }>
  >({});
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string>(readStoredToken);
  const [authRequired, setAuthRequired] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(
    async (type?: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const [eventsRes, summaryRes] = await Promise.all([
          fetchAnalytics(type || undefined, false, token || undefined),
          fetchAnalytics(undefined, true, token || undefined),
        ]);
        setEvents(eventsRes.events || []);
        if (summaryRes.summary) setSummary(summaryRes.summary);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) {
          // Server wants a token we don't have (or the stored one is wrong).
          setAuthRequired(true);
          setTokenInput("");
        } else {
          setLoadError(err instanceof Error ? err.message : "Failed to load analytics");
        }
      }
      setLoading(false);
    },
    [token],
  );

  // Single effect keyed on the filter: on mount (filter = "") and on every
  // filter change it loads exactly once. Previously two effects both fired on
  // mount, doubling every request.
  useEffect(() => {
    loadData(filter || undefined);
  }, [filter, loadData]);

  const handleSubmitToken = () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
    } catch {
      /* storage unavailable — still use it for this session */
    }
    setToken(trimmed);
    setAuthRequired(false);
  };

  const totalEvents = Object.values(summary).reduce((a, b) => a + (b.total || 0), 0);

  return (
    <div className="space-y-8 pb-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Analytics Dashboard</h1>
        <p className="mt-2 text-sm text-white/40">Server-side analytics from database</p>
      </div>

      {/* Admin token gate — only shown after the API returns 401. */}
      {authRequired && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Admin authentication required"
          className="rounded-2xl border border-red-500/20 bg-surface-800/60 p-6 backdrop-blur-md"
        >
          <h2 className="text-sm font-semibold text-white mb-1">🔒 Admin token required</h2>
          <p className="text-xs text-white/40 mb-4">
            This deployment protects analytics with <code>ADMIN_API_TOKEN</code>. Enter it to view
            the dashboard.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmitToken();
            }}
          >
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Admin token"
              autoComplete="off"
              className="flex-1 rounded-xl border border-white/10 bg-surface-950 px-4 py-2.5 font-mono text-sm text-white placeholder:text-white/30 focus:border-stellar-blue/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="rounded-xl bg-gradient-to-r from-stellar-blue to-stellar-purple px-5 py-2.5 text-sm font-semibold text-white hover:shadow-lg active:scale-95 disabled:opacity-30"
            >
              Unlock
            </button>
          </form>
        </div>
      )}

      {loadError && !authRequired && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-400">
          {loadError}
        </p>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Total Events", value: totalEvents, color: "text-white" },
          {
            label: "Faucet Requests",
            value: summary.faucet_request?.total || 0,
            color: "text-stellar-blue",
          },
          {
            label: "Payments Sent",
            value: summary.payment_send?.total || 0,
            color: "text-stellar-green",
          },
          {
            label: "Contract Calls",
            value: summary.contract_invoke?.total || 0,
            color: "text-stellar-purple",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-white/10 bg-surface-800/60 p-5 backdrop-blur-md text-center"
          >
            <p className={`text-3xl font-bold ${card.color}`}>{loading ? "..." : card.value}</p>
            <p className="mt-1 text-xs text-white/40">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {["faucet_request", "payment_send", "contract_invoke", "wallet_connect"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(filter === f ? "" : f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              filter === f
                ? "bg-stellar-blue/20 text-stellar-blue border border-stellar-blue/30"
                : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/10"
            }`}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Events Table */}
      <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-6 backdrop-blur-md overflow-x-auto">
        {events.length === 0 ? (
          <p className="text-center text-sm text-white/30 py-8">
            {loading ? "Loading..." : "No events yet."}
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-white/40">
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Address</th>
                <th className="text-left py-2 px-3">Time</th>
                <th className="text-left py-2 px-3">Data</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 50).map((e) => {
                // Keyed on the event's own fields, not the array index: rows
                // keep their identity across refreshes, so React never
                // recycles a <tr> onto a different event (which can cause
                // flicker or stale cell state when the list reorders).
                const rowKey = `${e.eventType}-${e.address}-${e.timestamp}-${
                  e.data ? JSON.stringify(e.data).slice(0, 40) : ""
                }`;
                return (
                  <tr key={rowKey} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 px-3">
                      <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px]">
                        {e.eventType.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-white/60">
                      {e.address.slice(0, 12)}...
                    </td>
                    <td className="py-2 px-3 text-white/40">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-white/30 font-mono">
                      {e.data ? JSON.stringify(e.data).slice(0, 40) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
