"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { copyToClipboard } from "@/lib/clipboard";

interface QrModalProps {
  open: boolean;
  onClose: () => void;
  address: string;
  label?: string;
  amount?: string;
  /** Asset code for payment requests; omitted/empty means native XLM. */
  assetCode?: string;
  /** Issuer address required for credit-asset payment requests. */
  assetIssuer?: string;
}

export default function QrModal({
  open,
  onClose,
  address,
  label,
  amount,
  assetCode,
  assetIssuer,
}: QrModalProps) {
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

  // Build payment URI for QR. The SEP-7 web+stellar:pay scheme needs the
  // asset_code/asset_issuer for credit assets — encoding only destination +
  // amount would silently request XLM even when the sender picked, say, a
  // USDC balance. Encoding the URI via URLSearchParams keeps values escaped.
  const asset = assetCode && assetCode !== "XLM" ? assetCode : null;
  const qrValue =
    amount || asset
      ? (() => {
          const params = new URLSearchParams({ destination: address });
          if (amount) params.set("amount", amount);
          if (asset) {
            params.set("asset_code", asset);
            if (assetIssuer) params.set("asset_issuer", assetIssuer);
          }
          params.set("memo", "StellarDripz");
          return `web+stellar:pay?${params.toString()}`;
        })()
      : address;

  const handleCopy = async () => {
    await copyToClipboard(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            {amount && (
              <p className="text-xs text-stellar-blue font-mono mt-0.5">
                {amount} {asset || "XLM"}
              </p>
            )}
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
