/**
 * Database service — transaction history, analytics, and session storage.
 *
 * PRIMARY: Supabase/PostgreSQL (when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set)
 * FALLBACK: In-memory store with JSON file persistence (local dev / no Supabase config)
 *
 * The public API is identical regardless of backend — consumers don't need to change.
 *
 * SUPABASE SETUP:
 *   1. Create a Supabase project at https://supabase.com
 *   2. Run src/lib/server/supabase-schema.sql in the SQL Editor
 *   3. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   4. Deploy — the service automatically uses Supabase when configured
 */
import fs from "fs";
import os from "os";
import path from "path";
import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase";
import { logger } from "@/lib/logger";

// SECURITY NOTE: The JSON fallback file stores transaction data including
// IP addresses and user agents unencrypted. For production deployments:
// 1. Always use Supabase as the primary store (encrypted at rest)
// 2. If the fallback is needed, consider encrypting the file or using
//    a dedicated ephemeral volume that's cleaned on restart

// Resolve a writable path for the JSON fallback.
// Serverless platforms (Vercel) mount a read-only project filesystem, so we
// probe the project data dir first and fall back to the OS temp dir (writable,
// but ephemeral — data does not survive instance restarts).
const PREFERRED_DB_PATH = path.join(process.cwd(), "data", "stellardripz-db.json");
const TMP_DB_PATH = path.join(os.tmpdir(), "stellardripz-db.json");

function resolveDbPath(): string {
  try {
    const dir = path.dirname(PREFERRED_DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return PREFERRED_DB_PATH;
  } catch {
    return TMP_DB_PATH;
  }
}

let _dbPath: string | null = null;

function getDbPath(): string {
  if (_dbPath) return _dbPath;
  _dbPath = resolveDbPath();
  if (_dbPath !== PREFERRED_DB_PATH) {
    logger.warn(
      `[StellarDripz] Project data dir not writable — JSON fallback persistence disabled. ` +
        `Writing to ephemeral ${_dbPath} instead. Configure Supabase for durable storage.`,
    );
  }
  return _dbPath;
}

/**
 * Reports how database persistence is behaving on this instance.
 * - supabase: durable, production-grade.
 * - memory + writable project dir: persists to a JSON file (local dev / VM).
 * - memory + tmp dir: serverless fallback — data is lost on cold start.
 */
export function getDatabaseStatus(): {
  backend: "supabase" | "memory";
  persistent: boolean;
  path: string | null;
} {
  if (isSupabaseConfigured()) {
    return { backend: "supabase", persistent: true, path: null };
  }
  const dbPath = getDbPath();
  return {
    backend: "memory",
    persistent: dbPath === PREFERRED_DB_PATH,
    path: dbPath,
  };
}

// ---- Types ----

export interface TxRecord {
  id: string;
  type: "faucet" | "send" | "contract";
  status: "pending" | "success" | "error";
  hash: string | null;
  amount: string;
  assetCode?: string;
  senderAddress: string;
  destinationAddress: string;
  functionName?: string;
  contractId?: string;
  errorMessage?: string;
  timestamp: number;
  ip?: string;
  userAgent?: string;
}

export interface AnalyticsEntry {
  id: string;
  eventType:
    | "faucet_request"
    | "payment_send"
    | "contract_invoke"
    | "wallet_connect"
    | "balance_fetch";
  address: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface SessionEntry {
  address: string;
  walletId: string;
  walletName: string;
  connectedAt: number;
  lastActive: number;
  ip?: string;
}

interface Database {
  transactions: TxRecord[];
  analytics: AnalyticsEntry[];
  sessions: SessionEntry[];
  lastCleanup: number;
}

// ---- In-Memory Store (Fallback) ----

let _db: Database | null = null;

function getEmptyDb(): Database {
  return { transactions: [], analytics: [], sessions: [], lastCleanup: Date.now() };
}

function getDb(): Database {
  if (_db) return _db;

  if (typeof fs !== "undefined") {
    try {
      const dbPath = getDbPath();
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(dbPath)) {
        const raw = fs.readFileSync(dbPath, "utf-8");
        _db = JSON.parse(raw) as Database;
      }
    } catch {
      /* fall through to empty */
    }
  }

  if (!_db) _db = getEmptyDb();
  return _db;
}

// Coalesce writes: multiple save calls in the same tick trigger a single disk
// write, which matters for bursty flows (batch funding, contract polls).
let _persistScheduled = false;

function persistDb(): void {
  if (typeof fs === "undefined") return;
  if (_persistScheduled) return;
  _persistScheduled = true;

  setImmediate(() => {
    _persistScheduled = false;
    try {
      const dbPath = getDbPath();
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(_db ?? getEmptyDb(), null, 2));
    } catch {
      /* disk full or permission error */
    }
  });
}

// ---- Supabase Column Mapping Helpers ----

/** Map a database row to TxRecord (snake_case → camelCase) */
function mapTxRow(row: Record<string, unknown>): TxRecord {
  return {
    id: String(row.id || ""),
    type: (row.type as TxRecord["type"]) || "send",
    status: (row.status as TxRecord["status"]) || "success",
    hash: (row.hash as string) || null,
    amount: String(row.amount || "0"),
    assetCode: (row.asset_code as string) || undefined,
    senderAddress: String(row.sender_address || ""),
    destinationAddress: String(row.destination_address || ""),
    functionName: (row.function_name as string) || undefined,
    contractId: (row.contract_id as string) || undefined,
    errorMessage: (row.error_message as string) || undefined,
    timestamp: Number(row.timestamp || 0),
    ip: (row.ip as string) || undefined,
    userAgent: (row.user_agent as string) || undefined,
  };
}

/** Map TxRecord to a database row (camelCase → snake_case) */
function txToDbRow(tx: TxRecord): Record<string, unknown> {
  return {
    id: tx.id,
    type: tx.type,
    status: tx.status,
    hash: tx.hash,
    amount: tx.amount,
    asset_code: tx.assetCode || null,
    sender_address: tx.senderAddress,
    destination_address: tx.destinationAddress,
    function_name: tx.functionName || null,
    contract_id: tx.contractId || null,
    error_message: tx.errorMessage || null,
    timestamp: tx.timestamp,
    ip: tx.ip || null,
    user_agent: tx.userAgent || null,
  };
}

function mapAnalyticsRow(row: Record<string, unknown>): AnalyticsEntry {
  return {
    id: String(row.id || ""),
    eventType: (row.event_type as AnalyticsEntry["eventType"]) || "faucet_request",
    address: String(row.address || ""),
    timestamp: Number(row.timestamp || 0),
    data: (row.data as Record<string, unknown>) || undefined,
  };
}

function mapSessionRow(row: Record<string, unknown>): SessionEntry {
  return {
    address: String(row.address || ""),
    walletId: String(row.wallet_id || ""),
    walletName: String(row.wallet_name || ""),
    connectedAt: Number(row.connected_at || 0),
    lastActive: Number(row.last_active || 0),
    ip: (row.ip as string) || undefined,
  };
}

// ---- Transactions ----

export async function saveTransaction(tx: TxRecord): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { error } = await supabase
      .from("transactions")
      .upsert(txToDbRow(tx), { onConflict: "id" });

    if (error) {
      logger.error("Supabase saveTransaction failed", new Error(error.message));
    }
    return;
  }

  // Fallback: in-memory
  const db = getDb();
  db.transactions.unshift(tx);
  if (db.transactions.length > 1000) db.transactions = db.transactions.slice(0, 1000);
  persistDb();
}

export async function updateTransaction(
  id: string,
  updates: Partial<TxRecord>,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status) dbUpdates.status = updates.status;
    if (updates.hash !== undefined) dbUpdates.hash = updates.hash;
    if (updates.errorMessage !== undefined) dbUpdates.error_message = updates.errorMessage;

    const { error } = await supabase
      .from("transactions")
      .update(dbUpdates)
      .eq("id", id);

    if (error) {
      logger.error("Supabase updateTransaction failed", new Error(error.message));
    }
    return;
  }

  // Fallback: in-memory
  const db = getDb();
  const idx = db.transactions.findIndex((t) => t.id === id);
  if (idx !== -1) {
    db.transactions[idx] = { ...db.transactions[idx], ...updates };
    persistDb();
  }
}

export async function getTransactions(
  address?: string,
  type?: TxRecord["type"],
  limit = 50,
  offset = 0,
): Promise<TxRecord[]> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    let query = supabase
      .from("transactions")
      .select("*")
      .order("timestamp", { ascending: false })
      .range(offset, offset + Math.min(limit, 100) - 1);

    if (address) query = query.eq("sender_address", address);
    if (type) query = query.eq("type", type);

    const { data, error } = await query;
    if (error) {
      logger.error("Supabase getTransactions failed", new Error(error.message));
      return [];
    }

    return (data as Record<string, unknown>[]).map(mapTxRow);
  }

  // Fallback: in-memory
  const db = getDb();
  let txs = db.transactions;
  if (address) txs = txs.filter((t) => t.senderAddress === address);
  if (type) txs = txs.filter((t) => t.type === type);
  return txs.slice(offset, offset + limit);
}

// ---- Analytics ----

export async function logAnalytics(
  entry: Omit<AnalyticsEntry, "id" | "timestamp">,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const record = {
    id: `an-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    event_type: entry.eventType,
    address: entry.address,
    timestamp: Date.now(),
    data: entry.data || {},
  };

  if (supabase) {
    const { error } = await supabase.from("analytics").insert(record);
    if (error) {
      logger.error("Supabase logAnalytics failed", new Error(error.message));
    }
    return;
  }

  // Fallback: in-memory
  const db = getDb();
  db.analytics.push({
    ...entry,
    id: record.id,
    timestamp: record.timestamp,
  });
  if (db.analytics.length > 5000) db.analytics = db.analytics.slice(-5000);
  persistDb();
}

export async function getAnalytics(
  eventType?: AnalyticsEntry["eventType"],
  limit = 100,
): Promise<AnalyticsEntry[]> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    let query = supabase
      .from("analytics")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(Math.min(limit, 500));

    if (eventType) query = query.eq("event_type", eventType);

    const { data, error } = await query;
    if (error) {
      logger.error("Supabase getAnalytics failed", new Error(error.message));
      return [];
    }

    return (data as Record<string, unknown>[]).map(mapAnalyticsRow);
  }

  // Fallback: in-memory
  const db = getDb();
  let entries = db.analytics;
  if (eventType) entries = entries.filter((e) => e.eventType === eventType);
  return entries.slice(-limit).reverse();
}

export async function getAnalyticsSummary(): Promise<
  Record<string, { total: number; uniqueAddresses: number }>
> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    // Use a single query to aggregate counts
    const { data, error } = await supabase.rpc("get_analytics_summary");

    if (error) {
      // Fall back to client-side aggregation if RPC not available
      const entries = await getAnalytics(undefined, 5000);
      const summary: Record<string, { total: number; addresses: Set<string> }> = {};
      for (const entry of entries) {
        if (!summary[entry.eventType]) {
          summary[entry.eventType] = { total: 0, addresses: new Set() };
        }
        summary[entry.eventType].total++;
        summary[entry.eventType].addresses.add(entry.address);
      }
      const result: Record<string, { total: number; uniqueAddresses: number }> = {};
      for (const [key, val] of Object.entries(summary)) {
        result[key] = { total: val.total, uniqueAddresses: val.addresses.size };
      }
      return result;
    }

    return (data as Record<string, { total: number; uniqueAddresses: number }>) || {};
  }

  // Fallback: in-memory
  const db = getDb();
  const summary: Record<string, { total: number; addresses: Set<string> }> = {};
  for (const entry of db.analytics) {
    if (!summary[entry.eventType]) {
      summary[entry.eventType] = { total: 0, addresses: new Set() };
    }
    summary[entry.eventType].total++;
    summary[entry.eventType].addresses.add(entry.address);
  }
  const result: Record<string, { total: number; uniqueAddresses: number }> = {};
  for (const [key, val] of Object.entries(summary)) {
    result[key] = { total: val.total, uniqueAddresses: val.addresses.size };
  }
  return result;
}

// ---- Sessions ----

export async function saveSession(session: SessionEntry): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { error } = await supabase.from("sessions").upsert(
      {
        address: session.address,
        wallet_id: session.walletId,
        wallet_name: session.walletName,
        connected_at: session.connectedAt,
        last_active: session.lastActive,
        ip: session.ip || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "address" },
    );

    if (error) {
      logger.error("Supabase saveSession failed", new Error(error.message));
    }
    return;
  }

  // Fallback: in-memory
  const db = getDb();
  const idx = db.sessions.findIndex((s) => s.address === session.address);
  if (idx !== -1) db.sessions[idx] = session;
  else db.sessions.push(session);
  persistDb();
}

export async function getSession(address: string): Promise<SessionEntry | null> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("address", address)
      .maybeSingle();

    if (error) {
      logger.error("Supabase getSession failed", new Error(error.message));
      return null;
    }

    return data ? mapSessionRow(data as Record<string, unknown>) : null;
  }

  // Fallback: in-memory
  return getDb().sessions.find((s) => s.address === address) || null;
}

export async function removeSession(address: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { error } = await supabase.from("sessions").delete().eq("address", address);
    if (error) {
      logger.error("Supabase removeSession failed", new Error(error.message));
    }
    return;
  }

  // Fallback: in-memory
  const db = getDb();
  const idx = db.sessions.findIndex((s) => s.address === address);
  if (idx !== -1) {
    db.sessions.splice(idx, 1);
    persistDb();
  }
}

export async function getActiveSessions(): Promise<SessionEntry[]> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .gt("last_active", oneDayAgo)
      .order("last_active", { ascending: false });

    if (error) {
      logger.error("Supabase getActiveSessions failed", new Error(error.message));
      return [];
    }

    return (data as Record<string, unknown>[]).map(mapSessionRow);
  }

  // Fallback: in-memory
  const db = getDb();
  const now = Date.now();
  return db.sessions.filter((s) => now - s.lastActive < 24 * 60 * 60 * 1000);
}

// ---- Cleanup ----

/**
 * Clear all database data.
 *
 * DANGER: when Supabase is configured this deletes every row in every table.
 * That is only allowed when ALLOW_DANGEROUS_DB_OPS=true is explicitly set in
 * the environment — a stray call from a bug or a misconfigured admin route
 * must never be able to wipe production data. The in-memory fallback is always
 * cleared so unit/integration tests keep working.
 */
export async function clearDb(): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    if (process.env.ALLOW_DANGEROUS_DB_OPS !== "true") {
      throw new Error(
        "clearDb() with Supabase requires ALLOW_DANGEROUS_DB_OPS=true (refusing to wipe production data)",
      );
    }
    await supabase.from("transactions").delete().neq("id", "__never__");
    await supabase.from("analytics").delete().neq("id", "__never__");
    await supabase.from("sessions").delete().neq("address", "__never__");
  }

  // Clear in-memory store too
  _db = getEmptyDb();
  persistDb();
}

export async function runPeriodicCleanup(): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = Date.now();

  if (supabase) {
    // Clean up old sessions (7 days)
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    await supabase.from("sessions").delete().lt("last_active", sevenDaysAgo);

    // Clean up old analytics (30 days)
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    await supabase.from("analytics").delete().lt("timestamp", thirtyDaysAgo);
    return;
  }

  // Fallback: in-memory cleanup
  const db = getDb();
  db.sessions = db.sessions.filter((s) => now - s.lastActive < 7 * 24 * 60 * 60 * 1000);
  db.analytics = db.analytics.filter((e) => now - e.timestamp < 30 * 24 * 60 * 60 * 1000);
  db.lastCleanup = now;
  persistDb();
}

/**
 * Export a helper to check which backend is active.
 * Useful for admin dashboard display.
 */
export function getDatabaseBackend(): "supabase" | "memory" {
  return isSupabaseConfigured() ? "supabase" : "memory";
}
