/**
 * Canned Stellar Horizon / Soroban RPC responses used by the E2E network mocks.
 *
 * These are intentionally minimal — just enough shape for the app to render
 * without hitting the real network. Extend as tests need richer data.
 */

export const TEST_ACCOUNT_ID = 'GBTEST0000000000000000000000000000000000000000000000000000AB';

export const horizonAccount = {
  id: TEST_ACCOUNT_ID,
  account_id: TEST_ACCOUNT_ID,
  sequence: '1234567890',
  subentry_count: 0,
  last_modified_ledger: 1,
  balances: [
    {
      balance: '1000.0000000',
      asset_type: 'native',
    },
    {
      balance: '500.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      is_authorized: true,
    },
  ],
  signers: [{ key: TEST_ACCOUNT_ID, weight: 1, type: 'ed25519_public_key' }],
  data: {},
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
};

export const horizonPayments = {
  _embedded: {
    records: [
      {
        id: '1',
        type: 'payment',
        transaction_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
        from: TEST_ACCOUNT_ID,
        to: 'GDEST0000000000000000000000000000000000000000000000000000CDEF',
        amount: '250.0000000',
        asset_type: 'native',
        created_at: '2026-01-15T10:00:00Z',
      },
    ],
  },
};

export const horizonTransactions = {
  _embedded: { records: [] },
};

/** Generic Soroban JSON-RPC health / getLatestLedger style response. */
export function sorobanRpcResponse(id: number | string = 1) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      status: 'healthy',
      latestLedger: 1000,
      oldestLedger: 1,
      ledgerRetentionWindow: 999,
    },
  };
}

/** Empty, successful backend list response used as a default for `/api/**`. */
export const emptyApiList = {
  data: [],
  items: [],
  results: [],
  total: 0,
  page: 1,
};

/** `GET /api/v1/schedules` — payroll scheduler list. */
export const schedulesResponse = {
  schedules: [],
  pagination: { page: 1, limit: 10, total: 0 },
};

/** `GET /api/v1/payroll-bonus/runs` — bulk payment status tracker. */
export const payrollRunsResponse = {
  success: true,
  data: { data: [], total: 0 },
};

/** `GET /api/.../audit` — classic transaction history feed. */
export const auditResponse = {
  data: [],
  total: 0,
  page: 1,
};
