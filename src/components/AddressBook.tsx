"use client";

import { useState, useEffect, useRef } from "react";
import { getAddressError } from "@/lib/stellar/address";
import { copyToClipboard } from "@/lib/clipboard";
import {
  getAddressBookEntries,
  addAddressBookEntry,
  updateAddressBookEntry,
  removeAddressBookEntry,
} from "@/services/addressBookService";
import type { AddressBookEntry } from "@/services/addressBookService";

interface AddressBookProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (address: string) => void;
}

export default function AddressBook({ open, onClose, onSelect }: AddressBookProps) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [addrError, setAddrError] = useState("");
  // Addresses whose full value was copied to the clipboard (for check feedback).
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // The copy-feedback timer must not outlive the modal: firing after unmount
  // is a setState-on-unmounted-component, and a stale timer from a previous
  // copy could clear a newer entry's feedback early.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setEntries(getAddressBookEntries());
      setShowAdd(false);
      setEditingId(null);
      setName("");
      setAddress("");
      setAddrError("");
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingId && !showAdd) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, editingId, showAdd]);

  if (!open) return null;

  const validateAddr = (val: string) => {
    setAddress(val);
    if (!val.trim()) {
      setAddrError("");
      return;
    }
    setAddrError(getAddressError(val, "address") ?? "");
  };

  const handleAdd = () => {
    if (!name.trim()) return;
    if (!address.trim() || addrError) {
      setAddrError("Valid address required");
      return;
    }

    if (editingId) {
      updateAddressBookEntry(editingId, { name, address });
      setEditingId(null);
    } else {
      addAddressBookEntry(name, address);
    }

    setEntries(getAddressBookEntries());
    setName("");
    setAddress("");
    setAddrError("");
    setShowAdd(false);
  };

  const handleEdit = (entry: AddressBookEntry) => {
    setEditingId(entry.id);
    setName(entry.name);
    setAddress(entry.address);
    setAddrError("");
    setShowAdd(true);
  };

  const handleDelete = (id: string) => {
    removeAddressBookEntry(id);
    setEntries(getAddressBookEntries());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Address book"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
    >
      <div className="w-full max-w-md max-h-[80vh] flex flex-col rounded-2xl border border-white/10 bg-surface-800 p-6 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">📖 Address Book</h3>
            <p className="text-xs text-white/40 mt-0.5">
              {entries.length} saved address{entries.length !== 1 ? "es" : ""}
            </p>
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

        {/* Add/Edit form */}
        {showAdd && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Label (e.g. 'My Other Wallet')"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-stellar-blue/30"
              autoFocus
            />
            <input
              type="text"
              value={address}
              onChange={(e) => validateAddr(e.target.value)}
              placeholder="G..."
              className={`w-full rounded-lg border bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 ${
                addrError
                  ? "border-red-500/50 focus:ring-red-500/30"
                  : "border-white/10 focus:ring-stellar-blue/30"
              }`}
            />
            {addrError && <p className="text-xs text-red-400">{addrError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={!name.trim() || !address.trim() || !!addrError}
                className="flex-1 rounded-lg bg-stellar-blue px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-stellar-blue-light active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {editingId ? "Update" : "Save"}
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setEditingId(null);
                  setName("");
                  setAddress("");
                  setAddrError("");
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/50 hover:text-white/80 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {entries.length === 0 && !showAdd && (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
              <p className="text-sm text-white/40">No saved addresses yet.</p>
              <p className="text-xs text-white/25 mt-1">Add addresses you send to frequently.</p>
            </div>
          )}

          {entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.01] px-4 py-3 transition-all hover:border-white/10"
            >
              <button
                onClick={() => {
                  if (onSelect) {
                    onSelect(entry.address);
                    onClose();
                  }
                }}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-sm font-medium text-white/80 truncate">{entry.name}</p>
                <p className="font-mono text-[11px] text-white/30 truncate mt-0.5">
                  {entry.address.slice(0, 10)}...{entry.address.slice(-6)}
                </p>
              </button>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    void copyToClipboard(entry.address);
                    setCopiedId(entry.id);
                    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
                    copyTimerRef.current = setTimeout(
                      () => setCopiedId((id) => (id === entry.id ? null : id)),
                      1500,
                    );
                  }}
                  className={`rounded-lg p-1.5 transition-all ${
                    copiedId === entry.id
                      ? "text-stellar-green"
                      : "text-white/30 hover:text-white/70 hover:bg-white/5"
                  }`}
                  title={copiedId === entry.id ? "Copied!" : "Copy address"}
                  aria-label={`Copy ${entry.name || "address"} to clipboard`}
                  aria-live="polite"
                >
                  {copiedId === entry.id ? (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m4.5 12.75 6 6 9-13.5"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"
                      />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => handleEdit(entry)}
                  className="rounded-lg p-1.5 text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
                  title="Edit"
                  aria-label={`Edit ${entry.name || "address"}`}
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="rounded-lg p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Delete"
                  aria-label={`Delete ${entry.name || "address"} from address book`}
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add button */}
        {!showAdd && (
          <button
            onClick={() => {
              setShowAdd(true);
              setEditingId(null);
              setName("");
              setAddress("");
              setAddrError("");
            }}
            className="mt-4 w-full rounded-xl border border-dashed border-white/10 bg-white/[0.01] px-4 py-3 text-xs font-medium text-white/40 transition-all hover:border-white/20 hover:text-white/60 active:scale-[0.98]"
          >
            + Add New Address
          </button>
        )}
      </div>
    </div>
  );
}
