/**
 * Postgres Pool Singleton — Server Only
 *
 * Lazy connection pool + idempotent schema bootstrap. The pool is created on
 * first query, so importing this module is cheap and won't fail server boot
 * if Postgres is briefly unreachable.
 */

import { assertServerOnImport } from '../harness-patterns/assert.server'
import pg from 'pg'

assertServerOnImport()

const { Pool } = pg

const DEFAULT_DATABASE_URL =
  'postgresql://postgres:password@localhost:5432/kgagent'

let _pool: pg.Pool | null = null
let _initPromise: Promise<void> | null = null

function getPool(): pg.Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
    _pool = new Pool({ connectionString })
    _pool.on('error', (err) => {
      console.error('[db] idle client error:', err)
    })
  }
  return _pool
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS conversations (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    title        TEXT,
    context      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
    ON conversations (user_id, updated_at DESC);
`

async function initSchema(): Promise<void> {
  await getPool().query(SCHEMA_SQL)
  console.log('[db] schema ready')
}

/**
 * Run a query, ensuring the schema has been bootstrapped first. The schema
 * init runs at most once per process; concurrent callers share the same
 * promise.
 */
export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<R>> {
  if (!_initPromise) {
    _initPromise = initSchema().catch((err) => {
      _initPromise = null // allow retry on next call
      throw err
    })
  }
  await _initPromise
  return getPool().query<R>(text, params as never[])
}

/**
 * Close the pool (test teardown only).
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = null
    _initPromise = null
  }
}
