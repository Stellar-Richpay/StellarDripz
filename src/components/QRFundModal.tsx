"use client";

import { useState, useEffect } from "react";
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
          onClick={() => void copyToClipboard(faucetUrl)}
          className="mt-3 w-full rounded-xl border border-stellar-blue/30 bg-stellar-blue/10 py-2 text-xs font-medium text-stellar-blue transition-all hover:bg-stellar-blue/20"
        >
          📋 Copy Faucet URL
        </button>
      </div>
    </div>
  );
}
