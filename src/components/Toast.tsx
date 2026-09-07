"use client";

import { useEffect, useState } from "react";

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info" | "pending";
  title: string;
  message?: string;
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastProps) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (toast.type === "pending") return;
    const timer = setTimeout(() => setLeaving(true), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onDismiss(toast.id), 300);
    return () => clearTimeout(timer);
  }, [leaving, toast.id, onDismiss]);

  const colors = {
    success: "border-green-500/30 bg-green-500/10 text-green-400",
    error: "border-red-500/30 bg-red-500/10 text-red-400",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  };

  const icons = {
    success: "✅",
    error: "❌",
    info: "ℹ️",
    pending: "⏳",
  };

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 backdrop-blur-md transition-all duration-300 ${
        colors[toast.type]
      } ${leaving ? "animate-fade-in opacity-0" : "animate-slide-up"}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg">{icons[toast.type]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.message && <p className="mt-0.5 text-xs opacity-80 break-all">{toast.message}</p>}
        </div>
        <button
          onClick={() => setLeaving(true)}
          className="ml-2 text-xs opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Expose to global for context use (with cleanup on unmount)
  useEffect(() => {
    const fn = (toast: ToastMessage) => {
      setToasts((prev) => {
        // Replace pending toasts with the same title, otherwise append
        if (toast.type === "pending") {
          const withoutSamePending = prev.filter(
            (t) => !(t.type === "pending" && t.title === toast.title),
          );
          return [...withoutSamePending, toast];
        }
        const filtered = prev.filter((t) => !(t.type === "pending" && t.title === toast.title));
        return [...filtered, toast];
      });
    };

    setToastDispatcher(fn);

    return () => {
      setToastDispatcher(null);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}

/** Singleton toast dispatcher for cross-component use. */
let _toastDispatcher: ((t: ToastMessage) => void) | null = null;

export function setToastDispatcher(fn: ((t: ToastMessage) => void) | null): void {
  _toastDispatcher = fn;
}

export function showToast(toast: Omit<ToastMessage, "id">): void {
  if (_toastDispatcher) {
    _toastDispatcher({ ...toast, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
  }
}
