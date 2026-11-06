"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { getAppConfig } from "@/lib/env";
import { directReadContract, directGetLatestLedger } from "@/lib/client/directClient";
import { buildContractCall, submitContract } from "@/lib/client/apiClient";
import { signTx } from "@/lib/wallets/walletKit";
import {
  formatTokenAmount,
  parseProposals,
  type ProposalView,
} from "@/lib/contractReads";
import * as StellarSdk from "@stellar/stellar-sdk";
import { showToast } from "./Toast";

/**
 * On-chain governance dashboard component for DripGovernance.
 * Displays proposal list, voting power, voting actions (For / Against / Abstain),
 * execution of passed proposals, and proposal creation modal.
 */
export default function GovernanceDashboard() {
  const { state } = useAppContext();
  const walletAddress = state.wallet.connected ? (state.wallet.publicKey ?? "") : "";
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [votingPower, setVotingPower] = useState<bigint>(BigInt(0));
  const [quorumBps, setQuorumBps] = useState<number>(0);
  const [latestLedger, setLatestLedger] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Proposal Creation Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newRate, setNewRate] = useState("500000"); // default 0.05 reward rate

  const govId = getAppConfig().contractIdGovernance;

  const loadData = useCallback(async () => {
    if (!govId || !walletAddress) return;
    setLoading(true);
    try {
      const [listRes, powerRes, quorumRes, ledger] = await Promise.all([
        directReadContract(
          govId,
          "list_proposals",
          [
            StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString("0")),
            StellarSdk.xdr.ScVal.scvU32(20),
          ],
          walletAddress,
        ),
        directReadContract(
          govId,
          "get_voting_power",
          [new StellarSdk.Address(walletAddress).toScVal()],
          walletAddress,
        ),
        directReadContract(govId, "get_quorum", [], walletAddress),
        directGetLatestLedger(),
      ]);

      setProposals(parseProposals(listRes.result));
      const power =
        typeof powerRes.result === "bigint"
          ? powerRes.result
          : typeof powerRes.result === "number"
            ? BigInt(powerRes.result)
            : BigInt(0);
      setVotingPower(power);
      setQuorumBps(typeof quorumRes.result === "number" ? quorumRes.result : 0);
      setLatestLedger(ledger);
    } catch (err) {
      showToast({
        type: "error",
        title: "Governance Data Unavailable",
        message: err instanceof Error ? err.message : "Failed to load governance",
      });
    } finally {
      setLoading(false);
    }
  }, [govId, walletAddress]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Vote on proposal
  const handleVote = async (proposalId: number, choice: 0 | 1 | 2) => {
    if (!govId || !walletAddress || !state.wallet.walletId) return;
    const actionKey = `vote-${proposalId}`;
    setActionInProgress(actionKey);
    try {
      const buildRes = await buildContractCall(
        govId,
        "vote",
        [walletAddress, proposalId, choice],
        walletAddress,
      );
      const signedXdr = await signTx(state.wallet.walletId, buildRes.xdr);
      const submitRes = await submitContract(govId, "vote", walletAddress, signedXdr);
      showToast({
        type: "success",
        title: "Vote Cast! 🗳️",
        message: `Tx: ${submitRes.hash.slice(0, 8)}…`,
      });
      loadData();
    } catch (err) {
      showToast({
        type: "error",
        title: "Vote Failed",
        message: err instanceof Error ? err.message : "Vote transaction failed",
      });
    } finally {
      setActionInProgress(null);
    }
  };

  // Execute passed proposal
  const handleExecute = async (proposalId: number) => {
    if (!govId || !walletAddress || !state.wallet.walletId) return;
    const actionKey = `exec-${proposalId}`;
    setActionInProgress(actionKey);
    try {
      const buildRes = await buildContractCall(
        govId,
        "execute_proposal",
        [walletAddress, proposalId],
        walletAddress,
      );
      const signedXdr = await signTx(state.wallet.walletId, buildRes.xdr);
      const submitRes = await submitContract(
        govId,
        "execute_proposal",
        walletAddress,
        signedXdr,
      );
      showToast({
        type: "success",
        title: "Proposal Executed! 🚀",
        message: `Tx: ${submitRes.hash.slice(0, 8)}…`,
      });
      loadData();
    } catch (err) {
      showToast({
        type: "error",
        title: "Execution Failed",
        message: err instanceof Error ? err.message : "Execution transaction failed",
      });
    } finally {
      setActionInProgress(null);
    }
  };

  // Create new proposal
  const handleCreateProposal = async () => {
    if (!govId || !walletAddress || !state.wallet.walletId) return;
    if (!newTitle.trim() || !newDesc.trim()) {
      showToast({ type: "error", title: "Validation Error", message: "Title & description required" });
      return;
    }
    setActionInProgress("create");
    try {
      const buildRes = await buildContractCall(
        govId,
        "create_proposal",
        [
          walletAddress,
          newTitle.trim(),
          newDesc.trim(),
          { SetRewardRate: [newRate.trim() || "500000"] },
        ],
        walletAddress,
      );
      const signedXdr = await signTx(state.wallet.walletId, buildRes.xdr);
      const submitRes = await submitContract(govId, "create_proposal", walletAddress, signedXdr);
      showToast({
        type: "success",
        title: "Proposal Created! 📜",
        message: `Tx: ${submitRes.hash.slice(0, 8)}…`,
      });
      setShowCreateModal(false);
      setNewTitle("");
      setNewDesc("");
      loadData();
    } catch (err) {
      showToast({
        type: "error",
        title: "Creation Failed",
        message: err instanceof Error ? err.message : "Failed to create proposal",
      });
    } finally {
      setActionInProgress(null);
    }
  };

  if (!govId) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-surface-800/30 p-5 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-stellar-purple/10 text-xl">
          🏛️
        </div>
        <h3 className="mt-2 text-sm font-semibold text-white">Governance Contract</h3>
        <p className="mt-1 text-xs text-white/40">
          Configure <code className="text-stellar-purple">NEXT_PUBLIC_CONTRACT_GOVERNANCE</code> in{" "}
          <code className="text-stellar-purple">.env.local</code> to activate on-chain proposals and token-weighted voting.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-5 backdrop-blur-md">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stellar-purple/10 text-sm">
            🏛️
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Governance</h3>
            <p className="text-[10px] text-white/30">On-chain voting & automated execution</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!walletAddress || votingPower <= BigInt(0)}
            className="rounded-lg bg-gradient-to-r from-stellar-purple to-stellar-blue px-3 py-1.5 text-[10px] font-semibold text-white shadow hover:opacity-90 active:scale-95 disabled:opacity-40"
            title={votingPower <= BigInt(0) ? "Hold DRIP tokens to create proposals" : ""}
          >
            + Propose
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] text-white/60 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-white/30">Your Voting Power</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-stellar-purple">
            {formatTokenAmount(votingPower)} DRIP
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-white/30">Active Proposals</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-white">
            {proposals.filter((p) => latestLedger !== null && latestLedger <= p.votingEnd && !p.executed).length}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-white/30">Quorum Required</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-white/70">
            {quorumBps > 0 ? `${(quorumBps / 100).toFixed(1)}%` : "None"}
          </p>
        </div>
      </div>

      {/* Proposals list */}
      <div className="mt-4 space-y-3">
        {proposals.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/25">
            {loading ? "Loading proposals…" : "No proposals submitted yet. Create the first proposal above!"}
          </p>
        ) : (
          proposals.map((p) => {
            const isEnded = latestLedger !== null && latestLedger > p.votingEnd;
            const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
            const forPct = totalVotes > BigInt(0) ? Number((p.forVotes * BigInt(100)) / totalVotes) : 0;
            const againstPct = totalVotes > BigInt(0) ? Number((p.againstVotes * BigInt(100)) / totalVotes) : 0;

            let statusLabel = "Voting Active";
            let statusClass = "bg-blue-500/15 text-blue-400 border-blue-500/30";
            if (p.executed) {
              statusLabel = p.passed ? "Executed ✓" : "Defeated";
              statusClass = p.passed ? "bg-stellar-green/15 text-stellar-green border-stellar-green/30" : "bg-red-500/15 text-red-400 border-red-500/30";
            } else if (isEnded) {
              statusLabel = p.forVotes > p.againstVotes ? "Passed — Ready to Execute" : "Voting Ended";
              statusClass = "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
            }

            return (
              <div
                key={p.id}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-white/40">#{p.id}</span>
                      <h4 className="text-xs font-bold text-white">{p.title}</h4>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[9px] ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-white/60">{p.description}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-white/30">
                    {p.proposer.slice(0, 6)}…{p.proposer.slice(-4)}
                  </span>
                </div>

                {/* Vote Progress Bars */}
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-stellar-green font-medium">For: {forPct}% ({formatTokenAmount(p.forVotes)})</span>
                    <span className="text-red-400 font-medium">Against: {againstPct}% ({formatTokenAmount(p.againstVotes)})</span>
                  </div>
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      style={{ width: `${forPct}%` }}
                      className="bg-stellar-green transition-all duration-300"
                    />
                    <div
                      style={{ width: `${againstPct}%` }}
                      className="bg-red-400 transition-all duration-300"
                    />
                  </div>
                </div>

                {/* Actions: Vote or Execute */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
                  <span className="text-[9px] text-white/30">
                    {isEnded ? "Voting concluded" : `Voting ends at ledger ${p.votingEnd}`}
                  </span>

                  {!isEnded && !p.executed && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleVote(p.id, 0)}
                        disabled={actionInProgress !== null || votingPower <= BigInt(0)}
                        className="rounded-md border border-stellar-green/30 bg-stellar-green/10 px-2 py-1 text-[10px] font-semibold text-stellar-green hover:bg-stellar-green/20 active:scale-95 disabled:opacity-40"
                      >
                        Vote For 👍
                      </button>
                      <button
                        onClick={() => handleVote(p.id, 1)}
                        disabled={actionInProgress !== null || votingPower <= BigInt(0)}
                        className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-400 hover:bg-red-500/20 active:scale-95 disabled:opacity-40"
                      >
                        Vote Against 👎
                      </button>
                      <button
                        onClick={() => handleVote(p.id, 2)}
                        disabled={actionInProgress !== null || votingPower <= BigInt(0)}
                        className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/50 hover:bg-white/10 active:scale-95 disabled:opacity-40"
                      >
                        Abstain
                      </button>
                    </div>
                  )}

                  {isEnded && !p.executed && p.forVotes > p.againstVotes && (
                    <button
                      onClick={() => handleExecute(p.id)}
                      disabled={actionInProgress !== null}
                      className="rounded-md bg-gradient-to-r from-stellar-green to-emerald-600 px-3 py-1 text-[10px] font-semibold text-white hover:opacity-90 active:scale-95 disabled:opacity-50"
                    >
                      {actionInProgress === `exec-${p.id}` ? "Executing…" : "Execute Action 🚀"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create Proposal Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface-900 p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white">Create Governance Proposal</h3>
            <p className="mt-1 text-xs text-white/40">
              Propose an on-chain action to adjust staking pool reward rate.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[10px] text-white/40">Proposal Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Increase Reward Rate"
                  className="w-full rounded-xl border border-white/10 bg-surface-950 px-3 py-2 text-xs text-white focus:border-stellar-purple/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-white/40">Description & Rationale</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Explain why the community should support this proposal…"
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-surface-950 px-3 py-2 text-xs text-white focus:border-stellar-purple/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-white/40">Target Reward Rate (Smallest Unit)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  placeholder="500000"
                  className="w-full rounded-xl border border-white/10 bg-surface-950 px-3 py-2 text-xs text-white focus:border-stellar-purple/50 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/60 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProposal}
                disabled={actionInProgress !== null || !newTitle.trim()}
                className="rounded-xl bg-gradient-to-r from-stellar-purple to-stellar-blue px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {actionInProgress === "create" ? "Submitting…" : "Submit Proposal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
