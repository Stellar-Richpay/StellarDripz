"use client";

import { useState, useEffect } from "react";
import WalletConnect from "@/components/WalletConnect";
import BalanceCard from "@/components/BalanceCard";
import FaucetButton from "@/components/FaucetButton";
import SendForm from "@/components/SendForm";
import TransactionHistory from "@/components/TransactionHistory";
import NetworkWarning from "@/components/NetworkWarning";
import SorobanDemo from "@/components/SorobanDemo";
import CooldownTimer from "@/components/CooldownTimer";
import TransactionFeedback from "@/components/TransactionFeedback";
import { useAppContext } from "@/context/AppContext";
import { getContractIdError } from "@/lib/stellar/contractId";

export default function Home() {
  const { state, checkCooldown } = useAppContext();
  const { wallet, cooldown } = state;
  const [contractIdInput, setContractIdInput] = useState("");
  const [contractIdError, setContractIdError] = useState<string | null>(null);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.connected && wallet.publicKey) checkCooldown();
  }, [wallet.connected, wallet.publicKey, checkCooldown]);

  const handleSetContractId = () => {
    const trimmed = contractIdInput.trim();
    const error = getContractIdError(trimmed);
    if (error) {
      setContractIdError(error);
      return;
    }
    setContractIdError(null);
    setActiveContractId(trimmed);
  };

  const handleContractIdChange = (value: string) => {
    setContractIdInput(value);
    // Clear the error as the user edits (re-validate on submit/Enter).
    if (contractIdError) setContractIdError(null);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Hero */}
      <div className="text-center max-w-2xl mx-auto animate-fade-in">
        <div className="inline-flex items-center gap-2 rounded-full border border-stellar-blue/20 bg-stellar-blue/5 px-4 py-1.5 text-xs font-medium text-stellar-blue mb-6">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stellar-blue opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-stellar-blue" />
          </span>
          Stellar Testnet
        </div>
        <h2 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Drip <span className="text-gradient">Testnet XLM</span>
        </h2>
        <p className="mt-4 text-lg text-white/50 leading-relaxed max-w-lg mx-auto">
          Multi-wallet faucet with smart contract support. Rate-limited funding, batch API, and
          real-time Soroban events.
        </p>
      </div>

      <NetworkWarning />

      {/* Wallet Connect */}
      <div className="max-w-md mx-auto">
        <WalletConnect />
      </div>

      {wallet.connected && (
        <>
          {/* Cooldown Timer */}
          {cooldown && !cooldown.canRequest && (
            <div className="max-w-md mx-auto">
              <CooldownTimer address={wallet.publicKey} onReady={checkCooldown} />
            </div>
          )}

          {/* Transaction Feedback */}
          <div className="max-w-2xl mx-auto">
            <TransactionFeedback />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-6">
              <BalanceCard />
              <FaucetButton />
            </div>
            <div className="space-y-6">
              <SendForm />
              <TransactionHistory />
            </div>
          </div>

          {/* Soroban Demo */}
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">
                Smart Contracts
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>

            {!activeContractId && (
              <div className="rounded-2xl border border-dashed border-stellar-purple/20 bg-surface-800/40 p-4">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={contractIdInput}
                    onChange={(e) => handleContractIdChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSetContractId()}
                    placeholder="Paste deployed contract ID (C…)"
                    aria-invalid={!!contractIdError}
                    className={`flex-1 rounded-xl border bg-surface-950 px-4 py-2.5 font-mono text-xs text-white placeholder-white/30 focus:outline-none ${
                      contractIdError
                        ? "border-red-500/50 focus:border-red-500/70"
                        : "border-white/10 focus:border-stellar-purple/50"
                    }`}
                  />
                  <button
                    onClick={handleSetContractId}
                    disabled={!contractIdInput.trim()}
                    className="rounded-xl bg-gradient-to-r from-stellar-purple to-stellar-blue px-5 py-2.5 text-xs font-semibold text-white hover:shadow-lg active:scale-95 disabled:opacity-30"
                  >
                    Connect
                  </button>
                </div>
                {contractIdError && (
                  <p role="alert" className="mt-2 text-center text-[10px] text-red-400">
                    {contractIdError}
                  </p>
                )}
                <p className="mt-2 text-[10px] text-white/25 text-center">
                  Deploy via{" "}
                  <code className="text-stellar-purple/60">scripts/deploy-contract.ts</code>
                </p>
              </div>
            )}

            {activeContractId && (
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setActiveContractId(null);
                    setContractIdInput("");
                  }}
                  className="text-[10px] text-white/30 hover:text-white/60"
                >
                  Disconnect
                </button>
              </div>
            )}

            {activeContractId && <SorobanDemo contractId={activeContractId} />}
          </div>
        </>
      )}

      {!wallet.connected && (
        <div className="text-center max-w-md mx-auto space-y-10">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: "💧", label: "Faucet", desc: "10,000 test XLM" },
              { icon: "📤", label: "Send", desc: "Any address" },
              { icon: "📊", label: "Analytics", desc: "Track usage" },
            ].map((f) => (
              <div
                key={f.label}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center hover:border-white/10"
              >
                <span className="text-2xl">{f.icon}</span>
                <p className="mt-2 text-xs font-semibold text-white/60">{f.label}</p>
                <p className="text-[10px] text-white/30">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-dashed border-white/10 bg-surface-800/30 p-6">
            <p className="text-sm text-white/40">
              Connect any Stellar wallet to get started with StellarDripz.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
