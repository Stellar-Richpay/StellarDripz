"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAnalytics } from "@/lib/client/apiClient";

export default function AdminDashboard() {
  const [events, setEvents] = useState<
    Array<{ eventType: string; address: string; timestamp: number; data?: Record<string, unknown> }>
  >([]);
  const [summary, setSummary] = useState<
    Record<string, { total: number; uniqueAddresses: number }>
  >({});
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (type?: string) => {
    setLoading(true);
    try {
      const [eventsRes, summaryRes] = await Promise.all([
        fetchAnalytics(type || undefined),
        fetchAnalytics(undefined, true),
      ]);
      setEvents(eventsRes.events || []);
      if (summaryRes.summary) setSummary(summaryRes.summary);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  // Single effect keyed on the filter: on mount (filter = "") and on every
  // filter change it loads exactly once. Previously two effects both fired on
  // mount, doubling every request.
  useEffect(() => {
    loadData(filter || undefined);
  }, [filter, loadData]);

  const totalEvents = Object.values(summary).reduce((a, b) => a + (b.total || 0), 0);

  return (
    <div className="space-y-8 pb-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Analytics Dashboard</h1>
        <p className="mt-2 text-sm text-white/40">Server-side analytics from database</p>
      </div>

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
              {events.slice(0, 50).map((e, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 px-3">
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px]">
                      {e.eventType.replace("_", " ")}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-mono text-white/60">{e.address.slice(0, 12)}...</td>
                  <td className="py-2 px-3 text-white/40">
                    {new Date(e.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-white/30 font-mono">
                    {e.data ? JSON.stringify(e.data).slice(0, 40) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
