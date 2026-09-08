"use client";

import { useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { getAddressError } from "@/lib/stellar/address";
import { assetDecimals } from "@/lib/stellar/format";
import { getMemoError, memoByteLength } from "@/lib/stellar/memo";
import { getNetworkState } from "@/lib/stellar/networkGuard";
import QrModal from "./QrModal";
import AddressBook from "./AddressBook";

export default function SendForm() {
  const { state, doSendPayment } = useAppContext();
  const { wallet, txInProgress } = state;

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [destError, setDestError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [memoError, setMemoError] = useState("");
  const [showPaymentQr, setShowPaymentQr] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState("XLM");
  const [selectedAssetIssuer, setSelectedAssetIssuer] = useState<string | undefined>(undefined);
  const [showAddressBook, setShowAddressBook] = useState(false);

  if (!wallet.connected) return null;

  const isPending = txInProgress === "pending";
  // Block sends when the wallet sits on a different network than the app
  // (e.g. mainnet wallet on a testnet deployment). On a mainnet deployment
  // a mainnet wallet is correct, so the check is a mismatch, not a
  // hardcoded "mainnet is wrong".
  const { mismatch: isNetworkMismatch, appLabel } = getNetworkState(wallet.network);

  const validateDestination = (val: string) => {
    setDestination(val);
    if (!val.trim()) {
      setDestError("");
      return;
    }
    setDestError(getAddressError(val, "recipient address") ?? "");
  };

  const validateMemo = (val: string) => {
    setMemo(val);
    setMemoError(getMemoError(val) ?? "");
  };

  const validateAmount = (val: string) => {
    setAmount(val);
    if (!val.trim()) {
      setAmountError("");
      return;
    }
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) {
      setAmountError("Must be a positive number");
      return;
    }
    // Stellar amounts are fixed-precision: XLM and credit_alphanum4 assets
    // use 7 decimals, credit_alphanum12 uses 12. Look up the selected asset's
    // actual type rather than assuming every non-native asset is alphanum12,
    // so an alphanum4 balance isn't offered 12 decimals and then rejected by
    // Horizon after signing.
    const selected = state.balance.assets.find((a) => a.asset.code === selectedAsset);
    const maxDecimals =
      selectedAsset === "XLM" ? 7 : assetDecimals(selected?.asset.type ?? "credit_alphanum4");
    const [, fraction = ""] = val.trim().split(".");
    if (fraction.length > maxDecimals) {
      setAmountError(`Maximum ${maxDecimals} decimal places for ${selectedAsset}`);
      return;
    }
    // Can't spend what you don't hold (also catches the zero-balance case
    // before the wallet prompts).
    const available = getAssetBalance(selectedAsset);
    if (available !== null && num > available) {
      setAmountError(`Insufficient ${selectedAsset} balance`);
      return;
    }
    setAmountError("");
  };

  /** Numeric balance for the selected asset, or null if unknown. */
  const getAssetBalance = (code: string): number | null => {
    if (code === "XLM") {
      const raw = state.balance.raw;
      return raw ? parseFloat(raw) : null;
    }
    const asset = state.balance.assets.find((a) => a.asset.code === code);
    return asset ? parseFloat(asset.balance) : null;
  };

  const handleSend = async () => {
    let valid = true;
    if (!destination.trim() || destError) {
      setDestError("Valid destination required");
      valid = false;
    }
    if (!amount.trim() || amountError) {
      setAmountError("Valid amount required");
      valid = false;
    }
    const memoTrimmed = memo.trim();
    if (getMemoError(memoTrimmed)) {
      setMemoError(getMemoError(memoTrimmed)!);
      valid = false;
    }
    if (!valid) return;

    const assetCode = selectedAsset !== "XLM" ? selectedAsset : undefined;
    const assetIssuer = selectedAsset !== "XLM" ? selectedAssetIssuer : undefined;
    const ok = await doSendPayment(
      destination.trim(),
      amount.trim(),
      assetCode,
      assetIssuer,
      memoTrimmed || undefined,
    );
    // Only clear the form on a confirmed submission. A failed send (rejected
    // by the wallet, rate-limited, network error) must leave the user's input
    // intact so they can retry instead of retyping everything.
    if (ok) {
      setDestination("");
      setAmount("");
      setMemo("");
    }
  };

  const hasValidPaymentInfo = destination.trim() && !destError && amount.trim() && !amountError;
  const submitDisabled =
    isPending ||
    isNetworkMismatch ||
    !destination.trim() ||
    !amount.trim() ||
    !!destError ||
    !!amountError ||
    !!memoError;

  /** Fill the amount with everything spendable for the selected asset. */
  const handleMax = () => {
    if (selectedAsset === "XLM") {
      // Keep a small reserve for the transaction fee (~0.001 XLM) so a max
      // send doesn't fail for lack of fee budget.
      const reserve = 0.001;
      const raw = state.balance.raw;
      const balance = raw ? parseFloat(raw) : 0;
      const max = Math.max(0, balance - reserve);
      setAmount(max.toFixed(7));
    } else {
      const asset = state.balance.assets.find((a) => a.asset.code === selectedAsset);
      if (asset) setAmount(asset.balance);
    }
    setAmountError("");
  };

  return (
    <>
      {hasValidPaymentInfo && (
        <QrModal
          open={showPaymentQr}
          onClose={() => setShowPaymentQr(false)}
          address={destination.trim()}
          amount={amount.trim()}
          assetCode={selectedAsset === "XLM" ? undefined : selectedAsset}
          assetIssuer={selectedAssetIssuer}
          label="Payment Request"
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="rounded-2xl border border-white/10 bg-surface-800/60 p-6 backdrop-blur-md animate-slide-up"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stellar-blue/10">
            <span className="text-xl">📤</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Send</h3>
            <p className="text-xs text-white/50">Transfer assets to another address</p>
          </div>
        </div>

        {isNetworkMismatch && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            ⚠️ Wallet on wrong network — switch to {appLabel} to send.
          </div>
        )}

        <div className="space-y-3">
          {/* Destination */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-white/60">Recipient Address</label>
              <button
                type="button"
                onClick={() => setShowAddressBook(true)}
                disabled={isPending || isNetworkMismatch}
                className="text-xs text-stellar-blue/60 hover:text-stellar-blue transition-colors disabled:opacity-30"
              >
                📖 Address Book
              </button>
            </div>
            <div className="relative">
              <input
                type="text"
                value={destination}
                onChange={(e) => validateDestination(e.target.value)}
                placeholder="G..."
                disabled={isPending || isNetworkMismatch}
                className={`w-full rounded-xl border bg-white/5 px-4 py-2.5 pr-9 font-mono text-sm text-white placeholder:text-white/20 transition-all focus:outline-none focus:ring-2 ${
                  destError
                    ? "border-red-500/50 focus:ring-red-500/30"
                    : "border-white/10 focus:border-stellar-blue/50 focus:ring-stellar-blue/30"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              />
            </div>
            {destError && <p className="mt-1 text-xs text-red-400">{destError}</p>}
          </div>

          <AddressBook
            open={showAddressBook}
            onClose={() => setShowAddressBook(false)}
            onSelect={(addr) => {
              setDestination(addr);
              validateDestination(addr);
            }}
          />

          {/* Asset selector */}
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Asset</label>
            <select
              value={selectedAsset}
              onChange={(e) => {
                setSelectedAsset(e.target.value);
                // Track the issuer for the chosen asset so non-native sends
                // build the correct asset instead of misusing the sender.
                const asset = state.balance.assets.find((a) => a.asset.code === e.target.value);
                setSelectedAssetIssuer(asset?.asset.issuer || undefined);
                setAmount("");
                setAmountError("");
              }}
              disabled={isPending || isNetworkMismatch}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white transition-all focus:outline-none focus:ring-2 focus:border-stellar-blue/50 focus:ring-stellar-blue/30 disabled:opacity-50 disabled:cursor-not-allowed appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394A3B8%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9"
            >
              <option value="XLM">XLM (native)</option>
              {state.balance.assets
                .filter((a) => a.asset.type !== "native")
                .map((a) => (
                  <option key={`${a.asset.code}-${a.asset.issuer}`} value={a.asset.code}>
                    {a.asset.code} · {a.asset.issuer.slice(0, 6)}…{a.asset.issuer.slice(-4)} (
                    {a.formatted})
                  </option>
                ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-white/60">Amount</label>
              <button
                type="button"
                onClick={handleMax}
                disabled={isPending || isNetworkMismatch}
                className="text-xs font-semibold text-stellar-blue/60 hover:text-stellar-blue transition-colors disabled:opacity-30"
              >
                Max
              </button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => validateAmount(e.target.value)}
              placeholder="0.0"
              min="0.0000001"
              step="0.0000001"
              disabled={isPending || isNetworkMismatch}
              className={`w-full rounded-xl border bg-white/5 px-4 py-2.5 font-mono text-sm text-white placeholder:text-white/20 transition-all focus:outline-none focus:ring-2 ${
                amountError
                  ? "border-red-500/50 focus:ring-red-500/30"
                  : "border-white/10 focus:border-stellar-blue/50 focus:ring-stellar-blue/30"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            />
            {amountError && <p className="mt-1 text-xs text-red-400">{amountError}</p>}
          </div>

          {/* Memo (optional) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-white/60">Memo (optional)</label>
              <span className={`text-xs ${memoError ? "text-red-400" : "text-white/30"}`}>
                {memoByteLength(memo)}/28 bytes
              </span>
            </div>
            <input
              type="text"
              value={memo}
              maxLength={64}
              onChange={(e) => validateMemo(e.target.value)}
              placeholder="e.g. Invoice #1234"
              disabled={isPending || isNetworkMismatch}
              className={`w-full rounded-xl border bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/20 transition-all focus:outline-none focus:ring-2 ${
                memoError
                  ? "border-red-500/50 focus:ring-red-500/30"
                  : "border-white/10 focus:border-stellar-blue/50 focus:ring-stellar-blue/30"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            />
            {memoError && <p className="mt-1 text-xs text-red-400">{memoError}</p>}
          </div>

          {/* Submit */}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitDisabled}
              className={`flex-1 rounded-xl px-5 py-3 text-sm font-semibold transition-all active:scale-[0.98] ${
                isPending
                  ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 cursor-not-allowed"
                  : "bg-white/5 text-white border border-white/10 hover:bg-white/10 hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
              }`}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-yellow-400/30 border-t-yellow-400" />
                  Sending...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <span className="text-lg">📤</span>
                  Send {selectedAsset}
                </span>
              )}
            </button>
            {hasValidPaymentInfo && (
              <button
                type="button"
                onClick={() => setShowPaymentQr(true)}
                disabled={isPending || isNetworkMismatch}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/60 transition-all hover:bg-white/10 hover:text-white/80 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Generate payment QR"
              >
                📱
              </button>
            )}
          </div>
        </div>
      </form>
    </>
  );
}
