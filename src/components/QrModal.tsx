"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface QrModalProps {
  open: boolean;
  onClose: () => void;
  address: string;
  label?: string;
  amount?: string;
}

export default function QrModal({ open, onClose, address, label, amount }: QrModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  // Build payment URI for QR
  const qrValue = amount
    ? `web+stellar:pay?destination=${address}&amount=${amount}&memo=StellarDripz`
    : address;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = address;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={label || "Wallet address"}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-surface-800 p-6 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-sm font-semibold text-white">{label || "Wallet Address"}</h3>
            {amount && <p className="text-xs text-stellar-blue font-mono mt-0.5">{amount} XLM</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 hover:text-white hover:bg-white/5 transition-all"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-6">
          <div className="rounded-2xl border border-white/10 bg-white p-4 shadow-lg">
            <QRCodeSVG
              value={qrValue}
              size={200}
              level="M"
              fgColor="#0F172A"
              bgColor="#FFFFFF"
              includeMargin={false}
            />
          </div>
        </div>

        {/* Address display */}
        <div
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 cursor-pointer hover:bg-white/[0.08] transition-all group"
          onClick={handleCopy}
          title="Click to copy"
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-white/70 break-all select-all mr-2">{address}</p>
            <span className="shrink-0 text-xs text-white/30 group-hover:text-stellar-blue transition-colors">
              {copied ? "✅ Copied!" : "📋"}
            </span>
          </div>
        </div>

        <p className="mt-3 text-center text-[10px] text-white/25">
          Scan with any Stellar-compatible wallet
        </p>
      </div>
    </div>
  );
}
