/**
 * Unit tests for AssetService clawback operations.
 *
 * All network calls (StellarService / Horizon) and DB writes are mocked
 * so the suite runs fully in-process without real credentials or a live node.
 */

// ---------------------------------------------------------------------------
// Mock the Stellar SDK – keeps the real Keypair/Asset/Operation factories
// but stubs out TransactionBuilder so we never try to build real XDR.
// ---------------------------------------------------------------------------
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({
        sign: jest.fn(),
      }),
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock StellarService – avoids Horizon HTTP calls.
// ---------------------------------------------------------------------------
jest.mock('../stellarService', () => ({
  StellarService: {
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
  },
}));

// ---------------------------------------------------------------------------
// Mock the DB pool.
// ---------------------------------------------------------------------------
jest.mock('../../config/database', () => ({
  pool: { query: jest.fn() },
}));

import { Keypair } from '@stellar/stellar-sdk';
import { AssetService } from '../assetService.js';
import { StellarService } from '../stellarService.js';
import { pool } from '../../config/database.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TX_HASH = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

function makeMockServer(
  overrides: Partial<{
    loadAccount: jest.Mock;
    submitTransaction: jest.Mock;
  }> = {}
) {
  return {
    loadAccount:
      overrides.loadAccount ??
      jest.fn().mockResolvedValue({
        accountId: () => 'G_ISSUER',
        sequenceNumber: () => '1000',
        incrementSequenceNumber: jest.fn(),
      }),
    submitTransaction:
      overrides.submitTransaction ??
      jest.fn().mockResolvedValue({ hash: TX_HASH }),
    accounts: jest.fn().mockReturnValue({
      accountId: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('AssetService – clawback operations', () => {
  let issuerKeypair: Keypair;

  beforeEach(() => {
    jest.clearAllMocks();
    issuerKeypair = Keypair.random();
    (StellarService.getServer as jest.Mock).mockReturnValue(makeMockServer());
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  // ─── clawbackAsset ───────────────────────────────────────────────────────

  describe('clawbackAsset', () => {
    it('returns the transaction hash on success', async () => {
      const fromAccount = Keypair.random().publicKey();
      const hash = await AssetService.clawbackAsset(issuerKeypair, fromAccount, '100.0');
      expect(hash).toBe(TX_HASH);
    });

    it('writes an audit row to clawback_audit_logs', async () => {
      const fromAccount = Keypair.random().publicKey();
      const reason = 'Incorrect recipient address';

      await AssetService.clawbackAsset(issuerKeypair, fromAccount, '250.0', reason);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO clawback_audit_logs'),
        expect.arrayContaining([TX_HASH, 'ORGUSD', '250.0', fromAccount, issuerKeypair.publicKey(), reason])
      );
    });

    it('writes a null reason when none is provided', async () => {
      const fromAccount = Keypair.random().publicKey();

      await AssetService.clawbackAsset(issuerKeypair, fromAccount, '10.0');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO clawback_audit_logs'),
        expect.arrayContaining([null])
      );
    });

    it('throws when Horizon rejects the transaction', async () => {
      const horizonError = new Error('op_not_authorized');
      (StellarService.getServer as jest.Mock).mockReturnValue(
        makeMockServer({
          submitTransaction: jest.fn().mockRejectedValue(horizonError),
        })
      );

      await expect(
        AssetService.clawbackAsset(issuerKeypair, Keypair.random().publicKey(), '100.0')
      ).rejects.toThrow('op_not_authorized');
    });

    it('does NOT write an audit row when the transaction fails', async () => {
      (StellarService.getServer as jest.Mock).mockReturnValue(
        makeMockServer({
          submitTransaction: jest.fn().mockRejectedValue(new Error('tx_failed')),
        })
      );

      try {
        await AssetService.clawbackAsset(issuerKeypair, Keypair.random().publicKey(), '50.0');
      } catch {
        // expected
      }

      // pool.query should NOT have been called with an INSERT (only the Horizon submit failed before it)
      const insertCalls = (pool.query as jest.Mock).mock.calls.filter((args: unknown[]) =>
        typeof args[0] === 'string' && args[0].includes('INSERT INTO clawback_audit_logs')
      );
      expect(insertCalls).toHaveLength(0);
    });

    it('uses the issuer public key as the source of the clawback operation', async () => {
      const { Operation } = jest.requireActual('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
      const spy = jest.spyOn(Operation, 'clawback');

      const fromAccount = Keypair.random().publicKey();
      await AssetService.clawbackAsset(issuerKeypair, fromAccount, '75.0');

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: issuerKeypair.publicKey(),
          from: fromAccount,
          amount: '75.0',
        })
      );

      spy.mockRestore();
    });
  });

  // ─── clawbackClaimableBalance ─────────────────────────────────────────────

  describe('clawbackClaimableBalance', () => {
    const BALANCE_ID =
      '00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be';

    it('returns the transaction hash on success', async () => {
      const hash = await AssetService.clawbackClaimableBalance(issuerKeypair, BALANCE_ID);
      expect(hash).toBe(TX_HASH);
    });

    it('throws when Horizon rejects the operation', async () => {
      (StellarService.getServer as jest.Mock).mockReturnValue(
        makeMockServer({
          submitTransaction: jest.fn().mockRejectedValue(new Error('op_no_claimable_balance')),
        })
      );

      await expect(
        AssetService.clawbackClaimableBalance(issuerKeypair, BALANCE_ID)
      ).rejects.toThrow('op_no_claimable_balance');
    });

    it('passes the correct balance ID to Operation.clawbackClaimableBalance', async () => {
      const { Operation } = jest.requireActual('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
      const spy = jest.spyOn(Operation, 'clawbackClaimableBalance');

      await AssetService.clawbackClaimableBalance(issuerKeypair, BALANCE_ID);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ balanceId: BALANCE_ID })
      );

      spy.mockRestore();
    });
  });
});
