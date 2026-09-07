-- =============================================================================
-- StellarDripz Supabase Database Schema v1
-- =============================================================================
-- Apply via:  npm run db:migrate   (programmatic, uses env vars)
--         or:  npx supabase db push  (Supabase CLI)
--         or:  paste into Supabase SQL Editor
--
-- Tables:
--   _migrations   — migration version tracking
--   transactions  — faucet requests, payments, contract invocations
--   analytics     — event tracking (faucet, payment, contract, wallet, balance)
--   sessions      — wallet session persistence
--
-- Functions:
--   get_analytics_summary() — aggregated analytics counts per event type
-- =============================================================================

-- ─── Migration Tracking ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _migrations (
  version       INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  applied_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Transactions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('faucet', 'send', 'contract')),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error')),
  hash            TEXT,
  amount          TEXT NOT NULL,
  asset_code      TEXT,
  memo            TEXT,
  fee_stroops     BIGINT,
  sender_address  TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  function_name   TEXT,
  contract_id     TEXT,
  error_message   TEXT,
  timestamp       BIGINT NOT NULL,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent upgrades for deployments that created the table before these
-- columns existed (re-paste this file to apply).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_stroops BIGINT;

-- Index for fast lookups by sender address
CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender_address);
-- Index for filtering by type
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
-- Index for ordering by timestamp
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);

-- ─── Analytics ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL CHECK (
    event_type IN (
      'faucet_request', 'payment_send', 'contract_invoke',
      'wallet_connect', 'balance_fetch'
    )
  ),
  address         TEXT NOT NULL,
  timestamp       BIGINT NOT NULL,
  data            JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_address ON analytics(address);
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics(timestamp DESC);

-- ─── Sessions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  address         TEXT PRIMARY KEY,
  wallet_id       TEXT NOT NULL,
  wallet_name     TEXT NOT NULL,
  connected_at    BIGINT NOT NULL,
  last_active     BIGINT NOT NULL,
  ip              TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active DESC);

-- ─── Row Level Security (RLS) ─────────────────────────────────────────────
-- Enable RLS on all tables for multi-tenancy safety.
-- The server-side admin client uses the service_role key and bypasses RLS.
-- Client-side access (if ever added) would use anon key + these policies.

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Transactions: users can only see their own transactions
-- NOTE: These RLS policies assume Supabase Auth user IDs (JWT 'sub' claim)
-- map directly to Stellar public keys. If using standard Supabase Auth
-- (email/password with UUID user IDs), these policies must be updated to
-- join against a user→address mapping table instead.
CREATE POLICY IF NOT EXISTS transactions_self_access ON transactions
  FOR ALL
  USING (sender_address = current_setting('request.jwt.claims', true)::json->>'sub');

-- Analytics: users can only see their own analytics
CREATE POLICY IF NOT EXISTS analytics_self_access ON analytics
  FOR ALL
  USING (address = current_setting('request.jwt.claims', true)::json->>'sub');

-- Sessions: users can only see/manage their own sessions
CREATE POLICY IF NOT EXISTS sessions_self_access ON sessions
  FOR ALL
  USING (address = current_setting('request.jwt.claims', true)::json->>'sub');

-- ─── Triggers ─────────────────────────────────────────────────────────────

-- Auto-update updated_at on row modifications
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_analytics_updated_at ON analytics;
CREATE TRIGGER trg_analytics_updated_at
  BEFORE UPDATE ON analytics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on session modifications
-- (replaces the old update_sessions_updated_at function if it exists)
DROP FUNCTION IF EXISTS update_sessions_updated_at();
DROP TRIGGER IF EXISTS trg_sessions_updated_at ON sessions;
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── Stored Procedures ────────────────────────────────────────────────────

-- Aggregated analytics summary for the dashboard
-- Called by dbService.getAnalyticsSummary() via supabase.rpc('get_analytics_summary')
CREATE OR REPLACE FUNCTION get_analytics_summary()
RETURNS TABLE (
  event_type       TEXT,
  total            BIGINT,
  unique_addresses BIGINT
) AS $$
BEGIN
  RETURN QUERY
    SELECT
      a.event_type,
      COUNT(*)::BIGINT AS total,
      COUNT(DISTINCT a.address)::BIGINT AS unique_addresses
    FROM analytics a
    GROUP BY a.event_type
    ORDER BY a.event_type;
END;
$$ LANGUAGE plpgsql STABLE;

-- Record this migration version (MUST be last — only after all DDL succeeds)
INSERT INTO _migrations (version, name)
VALUES (1, 'initial_schema')
ON CONFLICT (version) DO NOTHING;
