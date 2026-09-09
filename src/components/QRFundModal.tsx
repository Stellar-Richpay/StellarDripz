"use client";

import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { STELLAR_NETWORK } from "@/lib/stellar/network";
import { copyToClipboard } from "@/lib/clipboard";

interface QRFundModalProps {
  address: string | null;
}

/**
 * QR code modal optimized for cross-device faucet funding.
 * Shows wallet address as QR + provides a shareable faucet URL.
 */
export default function QRFundModal({ address }: QRFundModalProps) {
  const [open, setOpen] = useState(false);

  if (!address) return null;

  const faucetUrl = `${STELLAR_NETWORK.friendbotUrl}?addr=${encodeURIComponent(address)}`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 transition-all hover:bg-white/10 hover:text-white/80 active:scale-95"
        title="Show QR for cross-device funding"
      >
        📱 Fund via QR
      </button>

      {open && <QrDialog faucetUrl={faucetUrl} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The modal body, split out so its effect hooks (Escape handling, body scroll
 * lock) mount and unmount exactly with the dialog's visibility.
 */
function QrDialog({ faucetUrl, onClose }: { faucetUrl: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  // The copy-confirmation timer must not outlive the modal: firing after
  // unmount is a setState-on-unmounted-component (and a stale timer from a
  // previous copy could clear a newer copy's feedback early).
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);

    // Lock background scrolling while the modal is open, matching the other
    // modal patterns in the app.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // Only show "Copied!" when the write actually succeeded — copyToClipboard
  // returns false when both the Clipboard API and the execCommand fallback
  // fail (e.g. permissions denied), and a false confirmation would teach the
  // user to trust a copy that never happened.
  const handleCopy = async () => {
    const ok = await copyToClipboard(faucetUrl);
    if (!ok) return;
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cross-device funding"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-surface-800 p-6 shadow-2xl animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Cross-Device Funding</h3>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/80 transition-colors text-lg"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="rounded-xl bg-white p-4 mb-4 flex justify-center">
          <QRCodeSVG value={faucetUrl} size={200} level="M" />
        </div>

        <p className="text-xs text-white/50 text-center mb-3">
          Scan this QR from another device to fund this wallet via Friendbot.
        </p>

        <div className="rounded-lg bg-surface-950 p-3">
          <p className="text-[10px] text-white/30 mb-1">Faucet URL</p>
          <p className="font-mono text-[10px] text-stellar-blue/70 break-all">{faucetUrl}</p>
        </div>

        <button
          onClick={() => void handleCopy()}
          className={`mt-3 w-full rounded-xl border py-2 text-xs font-medium transition-all ${
            copied
              ? "border-stellar-green/40 bg-stellar-green/10 text-stellar-green"
              : "border-stellar-blue/30 bg-stellar-blue/10 text-stellar-blue hover:bg-stellar-blue/20"
          }`}
        >
          {copied ? "✅ Copied!" : "📋 Copy Faucet URL"}
        </button>
      </div>
    </div>
  );
}
