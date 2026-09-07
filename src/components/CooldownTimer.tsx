"use client";

import { useState, useEffect, useRef } from "react";
import { getCooldownRemaining } from "@/lib/rateLimiter";

interface CooldownTimerProps {
  address: string | null;
  onReady: () => void;
}

/**
 * Displays a countdown timer when the user is rate-limited.
 * Shows remaining seconds until the next faucet request is allowed.
 */
export default function CooldownTimer({ address, onReady }: CooldownTimerProps) {
  const [remaining, setRemaining] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasReady = useRef(false);

  useEffect(() => {
    if (!address) {
      setRemaining(0);
      return;
    }

    const check = () => {
      const ms = getCooldownRemaining(address, 60_000);
      const secs = Math.ceil(ms / 1000);
      setRemaining(secs);

      if (secs === 0 && !wasReady.current) {
        wasReady.current = true;
        onReady();
      }
      if (secs > 0) {
        wasReady.current = false;
      }
    };

    check();
    intervalRef.current = setInterval(check, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [address, onReady]);

  if (remaining <= 0) return null;

  // Format as m:ss (e.g. 1:05) so longer cooldowns stay scannable.
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const label = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, "0")}` : `${seconds}s`;

  return (
    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-center animate-pulse">
      <div className="flex items-center justify-center gap-2">
        <span className="text-lg">⏳</span>
        <p className="text-sm font-semibold text-yellow-400">Cooldown: {label} remaining</p>
      </div>
      <p className="mt-1 text-xs text-yellow-400/60">
        You can request faucet funds again in {label}.
      </p>
    </div>
  );
}
