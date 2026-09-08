"use client";

import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from "react";
import type {
  AppState,
  WalletState,
  BalanceInfo,
  TransactionRecord,
  TxStatus,
  ContractEvent,
  CooldownState,
} from "@/types/stellar";
import {
  connectWithWallet,
  clearPersistedWallet,
  checkAnyWalletInstalled,
  getSupportedWallets,
  loadPersistedWallet,
  resetKit,
  signTx,
} from "@/lib/wallets/walletKit";
import { connectAndRegister, disconnectAndUnregister } from "@/lib/client/walletClient";
import * as apiClient from "@/lib/client/apiClient";
import { directFetchBalance } from "@/lib/client/directClient";
import { getExplorerUrl } from "@/lib/stellar/explorer";
import { getCooldownRemaining, recordCooldown, recordFaucetRequest } from "@/lib/rateLimiter";

/** Client-side cooldown window, mirroring the server's faucet bucket. */
const FAUCET_COOLDOWN_MS = 60_000;

// --- Actions ---
type Action =
  | { type: "SET_WALLET"; payload: Partial<WalletState> }
  | {
      type: "SET_BALANCE";
      payload: Partial<BalanceInfo & { loading: boolean; error: string | null }>;
    }
  | { type: "SET_BALANCE_LOADING"; payload: boolean }
  | { type: "SET_BALANCE_ERROR"; payload: string | null }
  | { type: "ADD_TRANSACTION"; payload: TransactionRecord }
  | { type: "UPDATE_TRANSACTION"; payload: TransactionRecord }
  | { type: "SET_TX_IN_PROGRESS"; payload: TxStatus }
  | { type: "ADD_CONTRACT_EVENT"; payload: ContractEvent }
  | { type: "CLEAR_CONTRACT_EVENTS" }
  | { type: "SET_COOLDOWN"; payload: CooldownState | null }
  | { type: "RESET" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_WALLET":
      return { ...state, wallet: { ...state.wallet, ...action.payload } };
    case "SET_BALANCE":
      return { ...state, balance: { ...state.balance, ...action.payload } };
    case "SET_BALANCE_LOADING":
      return { ...state, balance: { ...state.balance, loading: action.payload } };
    case "SET_BALANCE_ERROR":
      return { ...state, balance: { ...state.balance, loading: false, error: action.payload } };
    case "ADD_TRANSACTION":
      return { ...state, transactions: [action.payload, ...state.transactions].slice(0, 50) };
    case "UPDATE_TRANSACTION":
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.payload.id ? action.payload : t,
        ),
      };
    case "SET_TX_IN_PROGRESS":
      return { ...state, txInProgress: action.payload };
    case "ADD_CONTRACT_EVENT":
      return { ...state, contractEvents: [action.payload, ...state.contractEvents].slice(0, 50) };
    case "CLEAR_CONTRACT_EVENTS":
      return { ...state, contractEvents: [] };
    case "SET_COOLDOWN":
      return { ...state, cooldown: action.payload };
    case "RESET":
      return {
        ...initialState,
        wallet: {
          ...initialState.wallet,
          isAnyWalletInstalled: state.wallet.isAnyWalletInstalled,
          availableWallets: state.wallet.availableWallets,
        },
      };
    default:
      return state;
  }
}

const initialState: AppState = {
  wallet: {
    connected: false,
    publicKey: null,
    network: "UNKNOWN",
    walletId: null,
    walletName: null,
    isAnyWalletInstalled: false,
    availableWallets: [],
  },
  balance: {
    xlm: "0.0000000",
    raw: "0",
    assets: [],
    lastFetched: null,
    loading: false,
    error: null,
  },
  transactions: [],
  txInProgress: "idle",
  contractEvents: [],
  cooldown: null,
};

interface AppContextValue {
  state: AppState;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  doFaucetRequest: () => Promise<void>;
  doSendPayment: (
    destination: string,
    amount: string,
    assetCode?: string,
    assetIssuer?: string,
    memo?: string,
  ) => Promise<boolean>;
  addContractEvent: (event: ContractEvent) => void;
  clearContractEvents: () => void;
  checkCooldown: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Monotonic id for balance fetches: refreshBalance can be triggered from
  // several places at once (connect, auto-refresh on focus, faucet/send
  // completion, manual click). Horizon responses can resolve out of order,
  // so a slow older fetch must not overwrite a newer one.
  const balanceFetchSeq = useRef(0);

  useEffect(() => {
    dispatch({
      type: "SET_WALLET",
      payload: {
        isAnyWalletInstalled: checkAnyWalletInstalled(),
        availableWallets: getSupportedWallets(),
      },
    });
    const persisted = loadPersistedWallet();
    if (persisted) {
      (async () => {
        try {
          const result = await connectWithWallet(persisted.walletId);
          dispatch({
            type: "SET_WALLET",
            payload: {
              connected: true,
              publicKey: result.publicKey,
              network: result.network,
              walletId: result.walletId,
              walletName: result.walletName,
            },
          });
          // Registration with the backend is best-effort on reconnect: if it
          // fails the wallet is still connected and usable locally, so it must
          // NOT clear the persisted session (which would force the user to
          // re-approve the wallet on every page load). The server session TTL
          // picks the wallet up again on the next explicit connect.
          try {
            await connectAndRegister(result.publicKey, result.walletId, result.walletName);
          } catch {
            /* best-effort — see above */
          }
        } catch {
          // The wallet itself rejected or failed to reconnect: drop the stale
          // persisted session so the user gets a clean connect screen instead
          // of an endless silent reconnect loop on every load.
          clearPersistedWallet();
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.wallet.connected && state.wallet.publicKey) refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.wallet.connected, state.wallet.publicKey]);

  // Re-fetch balances when the tab regains focus. Balances can go stale while
  // the tab is hidden — funding from another device (QR faucet), a payment in
  // another tab, or a wallet-side send all change the account with no local
  // signal — so refresh on visibility/focus, throttled to avoid spamming.
  useEffect(() => {
    if (!state.wallet.connected || !state.wallet.publicKey) return;
    const MIN_REFRESH_GAP_MS = 15_000;
    let lastFocusRefresh = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const lastFetchedMs = state.balance.lastFetched ? state.balance.lastFetched.getTime() : 0;
      const now = Date.now();
      if (now - Math.max(lastFetchedMs, lastFocusRefresh) < MIN_REFRESH_GAP_MS) return;
      lastFocusRefresh = now;
      void refreshBalance();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.wallet.connected, state.wallet.publicKey, state.balance.lastFetched]);

  const connect = useCallback(async (walletId: string) => {
    const { publicKey, network, walletId: wid, walletName } = await connectWithWallet(walletId);
    dispatch({
      type: "SET_WALLET",
      payload: { connected: true, publicKey, network, walletId: wid, walletName },
    });
    await connectAndRegister(publicKey, wid, walletName);
  }, []);

  const disconnect = useCallback(() => {
    const address = state.wallet.publicKey;
    clearPersistedWallet();
    resetKit();
    dispatch({ type: "RESET" });
    // Mirror the disconnect server-side so the session stops counting as
    // active (best-effort; the client UI must not depend on this call).
    if (address) void disconnectAndUnregister(address);
  }, [state.wallet.publicKey]);

  // ---- BALANCE: Direct Horizon read (hybrid) ---- //
  const refreshBalance = useCallback(async () => {
    if (!state.wallet.publicKey) return;
    const seq = ++balanceFetchSeq.current;
    dispatch({ type: "SET_BALANCE_LOADING", payload: true });
    try {
      const info = await directFetchBalance(state.wallet.publicKey);
      // A newer refresh started while this one was in flight — drop this
      // response so an older, slower fetch can't overwrite the freshest one.
      if (seq !== balanceFetchSeq.current) return;
      dispatch({
        type: "SET_BALANCE",
        payload: {
          xlm: info.xlm,
          raw: info.raw,
          lastFetched: new Date(),
          assets: (info.assets || []).map((a) => ({
            asset: {
              code: a.code,
              issuer: a.issuer || "",
              type: a.code === "XLM" ? "native" : ("credit_alphanum4" as const),
            },
            balance: a.balance,
            formatted: a.formatted,
          })),
          loading: false,
          error: null,
        },
      });
    } catch (err) {
      if (seq !== balanceFetchSeq.current) return;
      dispatch({
        type: "SET_BALANCE_ERROR",
        payload: err instanceof Error ? err.message : "Balance fetch failed",
      });
    }
  }, [state.wallet.publicKey]);

  const checkCooldown = useCallback(() => {
    if (!state.wallet.publicKey) {
      dispatch({ type: "SET_COOLDOWN", payload: null });
      return;
    }
    // Read the persisted client-side cooldown so the countdown survives
    // remounts; previously this always reported canRequest: true, making the
    // entire cooldown UI dead code.
    const remainingMs = getCooldownRemaining(state.wallet.publicKey, FAUCET_COOLDOWN_MS);
    dispatch({
      type: "SET_COOLDOWN",
      payload: {
        address: state.wallet.publicKey,
        remainingMs,
        canRequest: remainingMs === 0,
      },
    });
  }, [state.wallet.publicKey]);

  // ---- FAUCET: Proxied write (rate-limited) ---- //
  const doFaucetRequest = useCallback(async () => {
    if (!state.wallet.publicKey) return;
    // Random suffix (like the server's tx ids): two faucet requests landing
    // in the same millisecond would otherwise share an id, and UPDATE_/ADD_
    // would then treat them as one transaction.
    const txId = `faucet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingTx: TransactionRecord = {
      id: txId,
      type: "faucet",
      status: "pending",
      hash: null,
      amount: "10,000",
      destination: state.wallet.publicKey,
      timestamp: new Date(),
    };
    dispatch({ type: "ADD_TRANSACTION", payload: pendingTx });
    dispatch({ type: "SET_TX_IN_PROGRESS", payload: "pending" });

    try {
      const { hash } = await apiClient.requestFaucet(state.wallet.publicKey);
      // Start the client-side cooldown immediately so the button disables and
      // the countdown timer appears, mirroring the server's per-address bucket.
      recordFaucetRequest(state.wallet.publicKey, FAUCET_COOLDOWN_MS);
      dispatch({
        type: "SET_COOLDOWN",
        payload: {
          address: state.wallet.publicKey,
          remainingMs: FAUCET_COOLDOWN_MS,
          canRequest: false,
        },
      });
      dispatch({
        type: "UPDATE_TRANSACTION",
        payload: {
          ...pendingTx,
          status: "success",
          hash,
          explorerUrl: getExplorerUrl(hash),
        },
      });
      dispatch({ type: "SET_TX_IN_PROGRESS", payload: "success" });
      await refreshBalance();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Faucet failed";
      dispatch({
        type: "UPDATE_TRANSACTION",
        payload: { ...pendingTx, status: "error", errorMessage: errMsg },
      });
      dispatch({ type: "SET_TX_IN_PROGRESS", payload: "error" });

      // Honor the server's Retry-After when present (e.g. 429 from another
      // instance or after the window), otherwise the error is just a dead end.
      const retryAfter = (err as Error & { retryAfter?: number }).retryAfter;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        const remainingMs = retryAfter * 1000;
        recordCooldown(state.wallet.publicKey, remainingMs);
        dispatch({
          type: "SET_COOLDOWN",
          payload: {
            address: state.wallet.publicKey,
            remainingMs,
            canRequest: false,
          },
        });
      }
    }
  }, [state.wallet.publicKey, refreshBalance]);

  // ---- PAYMENT: Proxied write (rate-limited, logged) ---- //
  const doSendPayment = useCallback(
    async (
      destination: string,
      amount: string,
      assetCode?: string,
      assetIssuer?: string,
      memo?: string,
    ): Promise<boolean> => {
      // Returns true on a confirmed, submitted payment so the caller (SendForm)
      // only clears its fields when the send actually succeeded — previously
      // failures wiped the form and forced users to retype everything.
      if (!state.wallet.publicKey) return false;
      // Random suffix — see the faucet path: same-ms sends must not collide.
      const txId = `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const pendingTx: TransactionRecord = {
        id: txId,
        type: "send",
        status: "pending",
        hash: null,
        amount,
        destination,
        assetCode: assetCode || "XLM",
        memo: memo || undefined,
        timestamp: new Date(),
      };
      dispatch({ type: "ADD_TRANSACTION", payload: pendingTx });
      dispatch({ type: "SET_TX_IN_PROGRESS", payload: "pending" });

      try {
        // 1. Build transaction via backend (returns the network fee in stroops
        // so the UI can preview the cost before the signing prompt).
        const { xdr, feeStroops } = await apiClient.buildPayment(
          state.wallet.publicKey,
          destination,
          amount,
          assetCode,
          assetIssuer,
          memo,
        );
        dispatch({
          type: "UPDATE_TRANSACTION",
          payload: { ...pendingTx, feeStroops },
        });
        // 2. Sign locally via wallet
        const signedXdr = await signTx(xdr, state.wallet.publicKey);
        // 3. Submit via backend
        const { hash } = await apiClient.submitPayment(
          signedXdr,
          state.wallet.publicKey,
          destination,
          amount,
          assetCode,
          assetIssuer,
          memo,
        );
        dispatch({
          type: "UPDATE_TRANSACTION",
          payload: {
            ...pendingTx,
            status: "success",
            hash,
            explorerUrl: getExplorerUrl(hash),
          },
        });
        dispatch({ type: "SET_TX_IN_PROGRESS", payload: "success" });
        await refreshBalance();
        return true;
      } catch (err) {
        dispatch({
          type: "UPDATE_TRANSACTION",
          payload: {
            ...pendingTx,
            status: "error",
            errorMessage: err instanceof Error ? err.message : "Payment failed",
          },
        });
        dispatch({ type: "SET_TX_IN_PROGRESS", payload: "error" });
        return false;
      }
    },
    [state.wallet.publicKey, refreshBalance],
  );

  const addContractEvent = useCallback(
    (event: ContractEvent) => dispatch({ type: "ADD_CONTRACT_EVENT", payload: event }),
    [],
  );
  const clearContractEvents = useCallback(() => dispatch({ type: "CLEAR_CONTRACT_EVENTS" }), []);

  return (
    <AppContext.Provider
      value={{
        state,
        connect,
        disconnect,
        refreshBalance,
        doFaucetRequest,
        doSendPayment,
        addContractEvent,
        clearContractEvents,
        checkCooldown,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within an AppProvider");
  return ctx;
}
