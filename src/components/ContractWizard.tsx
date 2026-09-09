"use client";

import { useCallback, useMemo, useState } from "react";
import { getAppConfig } from "@/lib/env";
import { getNetworkState } from "@/lib/stellar/networkGuard";
import { buildContractCall, submitContract } from "@/lib/client/apiClient";
import { signTx } from "@/lib/wallets/walletKit";
import { useAppContext } from "@/context/AppContext";
import { showToast } from "./Toast";
import {
  buildWizardArgs,
  describeWizardArgs,
  EMPTY_FORM,
  getTemplate,
  validateWizardForm,
  WIZARD_TEMPLATES,
  type WizardActionId,
  type WizardFormValues,
} from "@/lib/contractWizard";

type Step = "setup" | "params" | "review";

/**
 * Contract interaction wizard — a guided flow for the four headline Soroban
 * actions (mint / transfer / stake / vote) plus a custom call. Writes go
 * through the proxied /api/contract/invoke route exactly like SorobanDemo:
 * build → sign (wallet) → submit.
 */
export default function ContractWizard() {
  const { state } = useAppContext();
  const walletAddress = state.wallet.connected ? (state.wallet.publicKey ?? "") : "";
  const { mismatch: isNetworkMismatch, appLabel } = getNetworkState(state.wallet.network);

  const [step, setStep] = useState<Step>("setup");
  const [actionId, setActionId] = useState<WizardActionId>("mint");
  const [contractId, setContractId] = useState("");
  const [customContractId, setCustomContractId] = useState("");
  const [values, setValues] = useState<WizardFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const template = getTemplate(actionId);

  // The configured contract IDs (NEXT_PUBLIC_CONTRACT_*); only ones actually
  // set are offered so the wizard never points at an empty string.
  const configured = useMemo(() => {
    const cfg = getAppConfig();
    const entries: Array<{ key: string; label: string; id: string }> = [
      { key: "counter", label: "Counter", id: cfg.contractIdCounter || "" },
      { key: "token", label: "DripToken", id: cfg.contractIdDripToken || "" },
      { key: "pool", label: "DripPool", id: cfg.contractIdDripPool || "" },
      { key: "governance", label: "Governance", id: cfg.contractIdGovernance || "" },
      { key: "badge", label: "DripBadge", id: cfg.contractIdBadge || "" },
    ];
    return entries.filter((e) => e.id);
  }, []);

  const activeContractId = contractId || customContractId.trim();

  const pickAction = (id: WizardActionId) => {
    setActionId(id);
    setErrors({});
    setValues(EMPTY_FORM);
    // Auto-select the target contract when it's configured; otherwise leave
    // the current selection (or require a custom ID on the next step).
    const t = getTemplate(id);
    const match = configured.find((c) => c.label === t.contract);
    if (match) setContractId(match.id);
    setStep("params");
  };

  const setField = (name: keyof WizardFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Re-validate on change once the field already has an error.
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const goReview = () => {
    const errs = validateWizardForm(template, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (!activeContractId) {
      setErrors({ contract: "Select a contract or paste a custom contract ID." });
      return;
    }
    setErrors({});
    setStep("review");
  };

  const handleExecute = useCallback(async () => {
    if (!walletAddress || !activeContractId || isNetworkMismatch) return;
    setLoading(true);
    try {
      const args = buildWizardArgs(template, values, walletAddress);
      const { xdr } = await buildContractCall(
        activeContractId,
        template.method,
        args,
        walletAddress,
      );
      const signedXdr = await signTx(xdr, walletAddress);
      const { hash, status } = await submitContract(
        signedXdr,
        activeContractId,
        template.method,
        walletAddress,
      );

      showToast({
        type: status === "pending" ? "info" : "success",
        title: status === "pending" ? `${template.label} submitted` : `${template.label} executed!`,
        message: `TX: ${hash.slice(0, 10)}...`,
      });
      // Back to a clean slate for the next interaction.
      setStep("setup");
      setValues(EMPTY_FORM);
    } catch (err) {
      showToast({
        type: "error",
        title: `${template.label} failed`,
        message: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [walletAddress, activeContractId, isNetworkMismatch, template, values]);

  const stepIndicator = (
    <div className="flex items-center gap-2 text-[10px]">
      {(["setup", "params", "review"] as Step[]).map((s, i) => {
        const order: Record<Step, number> = { setup: 0, params: 1, review: 2 };
        const active = order[step] === i;
        const done = order[step] > i;
        return (
          <span
            key={s}
            className={`flex items-center gap-1 ${active ? "text-white/80" : done ? "text-stellar-green" : "text-white/25"}`}
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                active
                  ? "bg-stellar-blue/20 text-stellar-blue"
                  : done
                    ? "bg-stellar-green/15 text-stellar-green"
                    : "bg-white/5 text-white/25"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            {s === "setup" ? "Action" : s === "params" ? "Details" : "Review"}
          </span>
        );
      })}
    </div>
  );

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-surface-950 px-4 py-2.5 text-xs text-white placeholder-white/30 focus:border-stellar-purple/50 focus:outline-none";
  const errorClass = "mt-1 text-[10px] text-red-400";

  return (
    <div className="space-y-4 rounded-2xl border border-stellar-blue/20 bg-surface-800/60 p-5 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stellar-blue/10 text-sm">
            🧭
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Contract Wizard</h3>
            <p className="text-[10px] text-white/30">Guided mint / transfer / stake / vote flows</p>
          </div>
        </div>
        {stepIndicator}
      </div>

      {isNetworkMismatch && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          ⚠️ Wallet on wrong network — switch to {appLabel} to use contracts.
        </div>
      )}

      {step === "setup" && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-white/30">
              Action
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WIZARD_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickAction(t.id)}
                  disabled={!walletAddress}
                  className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left transition-all hover:border-stellar-blue/40 hover:bg-white/5 disabled:opacity-40"
                >
                  <p className="text-xs font-semibold text-white/80">{t.label}</p>
                  <p className="mt-0.5 text-[9px] leading-tight text-white/30 line-clamp-2">
                    {t.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-white/30">
              Contract
            </p>
            {configured.length > 0 ? (
              <select
                value={contractId}
                onChange={(e) => {
                  setContractId(e.target.value);
                  setCustomContractId("");
                }}
                className={inputClass}
                aria-label="Target contract"
              >
                <option value="">Select a deployed contract…</option>
                {configured.map((c) => (
                  <option key={c.key} value={c.id}>
                    {c.label} ({c.id.slice(0, 8)}…)
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[10px] text-white/40">
                No contract IDs configured — paste one below, or set NEXT_PUBLIC_CONTRACT_* vars.
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-white/25">or paste a custom ID:</span>
              <input
                type="text"
                value={customContractId}
                onChange={(e) => {
                  setCustomContractId(e.target.value);
                  if (e.target.value) setContractId("");
                }}
                placeholder="C…"
                aria-label="Custom contract ID"
                className={`flex-1 rounded-xl border border-white/10 bg-surface-950 px-3 py-1.5 font-mono text-[10px] text-white placeholder-white/30 focus:border-stellar-purple/50 focus:outline-none`}
              />
            </div>
            {errors.contract && <p className={errorClass}>{errors.contract}</p>}
          </div>

          <button
            onClick={goReview}
            disabled={!activeContractId || !walletAddress}
            className="w-full rounded-xl bg-gradient-to-r from-stellar-blue to-stellar-purple px-4 py-2.5 text-xs font-semibold text-white hover:shadow-lg active:scale-95 disabled:opacity-30"
          >
            Continue
          </button>
        </div>
      )}

      {step === "params" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-white/80">
              {template.label} —{" "}
              <span className="font-mono text-stellar-blue">{template.method}()</span>
            </p>
            <button
              onClick={() => setStep("setup")}
              className="text-[10px] text-white/30 hover:text-white/60"
            >
              ← Change action
            </button>
          </div>

          {template.fields.map((field) => (
            <div key={field.name}>
              {field.type === "choice" ? (
                <>
                  <label className="mb-1 block text-[10px] text-white/40">{field.label}</label>
                  <select
                    value={values.choice}
                    onChange={(e) => setField("choice", e.target.value)}
                    className={inputClass}
                  >
                    <option value="0">For 👍</option>
                    <option value="1">Against 👎</option>
                    <option value="2">Abstain 🤷</option>
                  </select>
                </>
              ) : field.type === "amount" ? (
                <>
                  <label className="mb-1 block text-[10px] text-white/40">
                    {field.label} (smallest token unit)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={values.amount}
                    onChange={(e) => setField("amount", e.target.value)}
                    placeholder="e.g. 10000000 (10.0000000 tokens)"
                    className={inputClass}
                  />
                  {errors.amount && <p className={errorClass}>{errors.amount}</p>}
                </>
              ) : field.type === "proposalId" ? (
                <>
                  <label className="mb-1 block text-[10px] text-white/40">{field.label}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={values.proposalId}
                    onChange={(e) => setField("proposalId", e.target.value)}
                    placeholder="e.g. 1"
                    className={inputClass}
                  />
                  {errors.proposalId && <p className={errorClass}>{errors.proposalId}</p>}
                </>
              ) : field.type === "address" ? (
                <>
                  <label className="mb-1 block text-[10px] text-white/40">{field.label}</label>
                  <input
                    type="text"
                    value={values.address}
                    onChange={(e) => setField("address", e.target.value)}
                    placeholder="G…"
                    className={inputClass}
                  />
                  {errors.address && <p className={errorClass}>{errors.address}</p>}
                </>
              ) : field.type === "method" ? (
                <>
                  <label className="mb-1 block text-[10px] text-white/40">{field.label}</label>
                  <input
                    type="text"
                    value={values.method}
                    onChange={(e) => setField("method", e.target.value)}
                    placeholder="function_name"
                    className={inputClass}
                  />
                  {errors.method && <p className={errorClass}>{errors.method}</p>}
                </>
              ) : (
                <>
                  <label className="mb-1 block text-[10px] text-white/40">{field.label}</label>
                  <textarea
                    value={values.argsJson}
                    onChange={(e) => setField("argsJson", e.target.value)}
                    placeholder='[ "G…", "100" ]'
                    rows={3}
                    className={`${inputClass} font-mono`}
                  />
                  {errors.argsJson && <p className={errorClass}>{errors.argsJson}</p>}
                </>
              )}
            </div>
          ))}

          {template.hint && (
            <p className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-[10px] text-yellow-400/90">
              💡 {template.hint}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setStep("setup")}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white/60 hover:bg-white/10"
            >
              Back
            </button>
            <button
              onClick={goReview}
              className="flex-1 rounded-xl bg-gradient-to-r from-stellar-blue to-stellar-purple px-4 py-2.5 text-xs font-semibold text-white hover:shadow-lg active:scale-95"
            >
              Review
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-white/80">Review & execute</p>
            <button
              onClick={() => setStep("params")}
              className="text-[10px] text-white/30 hover:text-white/60"
            >
              ← Edit details
            </button>
          </div>

          <dl className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-white/30">Contract</dt>
              <dd className="font-mono text-white/70 break-all">{activeContractId}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/30">Function</dt>
              <dd className="font-mono text-stellar-blue">{template.method}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/30">From</dt>
              <dd className="font-mono text-white/70 break-all">{walletAddress}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/30">Args</dt>
              <dd className="font-mono text-white/70 break-all">
                {describeWizardArgs(buildWizardArgs(template, values, walletAddress))}
              </dd>
            </div>
          </dl>

          <p className="text-[10px] text-white/30">
            Signing opens your wallet. The transaction is submitted through the proxied API route
            (rate-limited, logged, CSRF-protected).
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => setStep("params")}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white/60 hover:bg-white/10 disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleExecute}
              disabled={loading || isNetworkMismatch}
              className="flex-1 rounded-xl bg-gradient-to-r from-stellar-blue to-stellar-purple px-4 py-2.5 text-xs font-semibold text-white hover:shadow-lg active:scale-95 disabled:opacity-50"
            >
              {loading ? "Submitting…" : "Sign & execute"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
