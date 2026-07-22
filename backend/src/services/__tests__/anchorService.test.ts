import { AnchorService, AnchorInfo } from '../anchorService.js';
import axios from 'axios';
import { Keypair, Transaction, Networks } from '@stellar/stellar-sdk';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Minimal stellar.toml fixture with SEP-24 TRANSFER_SERVER
const STELLAR_TOML_SEP24 = `
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
WEB_AUTH_ENDPOINT="https://anchor.example.com/auth"
TRANSFER_SERVER="https://anchor.example.com/sep24"
TRANSFER_SERVER_SEP0031="https://anchor.example.com/sep31"
`;

const STELLAR_TOML_NO_SEP24 = `
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
WEB_AUTH_ENDPOINT="https://anchor.example.com/auth"
TRANSFER_SERVER_SEP0031="https://anchor.example.com/sep31"
`;

const MOCK_SEP24_INFO = {
  deposit: {
    AUD: { enabled: true, fee_fixed: 1 },
  },
  withdrawal: {
    AUD: { enabled: true, fee_fixed: 1, min_amount: 0.5, max_amount: 1000 },
  },
  withdraw: {
    enabled: true,
  },
  fee: {
    enabled: true,
  },
};

const MOCK_SEP24_WITHDRAWAL_RESPONSE = {
  type: 'interactive_client_response',
  url: 'https://anchor.example.com/sep24/transactions/interactive/webapp?token=abc123',
};

const MOCK_SEP24_TRANSACTION = {
  transactions: [
    {
      id: 'tx-001',
      type: 'withdrawal',
      status: 'completed',
      amount_in: '100.00',
      amount_out: '95.00',
      asset_code: 'AUD',
      started_at: '2026-01-15T10:00:00Z',
      completed_at: '2026-01-15T10:05:00Z',
    },
  ],
};

describe('AnchorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset cache between tests by accessing private static
    (AnchorService as any).anchorCache = {};
  });

  describe('getAnchorInfo — SEP-24 discovery', () => {
    it('should parse TRANSFER_SERVER from stellar.toml', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: STELLAR_TOML_SEP24 });

      const info = await AnchorService.getAnchorInfo('anchor.example.com');

      expect(info.sep24Endpoint).toBe('https://anchor.example.com/sep24');
      expect(info.webAuthEndpoint).toBe('https://anchor.example.com/auth');
      expect(info.sep31Endpoint).toBe('https://anchor.example.com/sep31');
    });

    it('should set sep24Endpoint to undefined when TRANSFER_SERVER is absent', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: STELLAR_TOML_NO_SEP24 });

      const info = await AnchorService.getAnchorInfo('no-sep24.example.com');

      expect(info.sep24Endpoint).toBeUndefined();
      expect(info.webAuthEndpoint).toBe('https://anchor.example.com/auth');
    });

    it('should cache results and not re-fetch on second call', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: STELLAR_TOML_SEP24 });

      const first = await AnchorService.getAnchorInfo('anchor.example.com');
      const second = await AnchorService.getAnchorInfo('anchor.example.com');

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);
    });

    it('should throw when stellar.toml fetch fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(AnchorService.getAnchorInfo('bad.example.com')).rejects.toThrow(
        'Anchor discovery failed for bad.example.com'
      );
    });
  });

  describe('getSEP24Info', () => {
    it('should return the anchor SEP-24 /info payload', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: STELLAR_TOML_SEP24 }) // discovery
        .mockResolvedValueOnce({ data: MOCK_SEP24_INFO });    // /info

      const info = await AnchorService.getSEP24Info('anchor.example.com');

      expect(info).toEqual(MOCK_SEP24_INFO);
      expect(mockedAxios.get).toHaveBeenLastCalledWith(
        'https://anchor.example.com/sep24/info'
      );
    });

    it('should throw when anchor does not support SEP-24', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: STELLAR_TOML_NO_SEP24 });

      await expect(AnchorService.getSEP24Info('no-sep24.example.com')).rejects.toThrow(
        'Anchor does not support SEP-24'
      );
    });
  });

  describe('initiateSEP24Withdrawal', () => {
    it('should POST to /transactions/interactive and return the interactive URL', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: STELLAR_TOML_SEP24 })  // discovery
        .mockResolvedValueOnce({ data: MOCK_SEP24_INFO });     // (unused here, but getAnchorInfo hits cache)

      mockedAxios.post.mockResolvedValueOnce({ data: MOCK_SEP24_WITHDRAWAL_RESPONSE });

      const result = await AnchorService.initiateSEP24Withdrawal(
        'anchor.example.com',
        'mock-jwt-token',
        {
          asset_code: 'AUD',
          amount: 100,
          account: 'GABC123...',
        }
      );

      expect(result).toEqual(MOCK_SEP24_WITHDRAWAL_RESPONSE);
      expect(result.type).toBe('interactive_client_response');
      expect(result.url).toContain('token=');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://anchor.example.com/sep24/transactions/interactive',
        {
          asset_code: 'AUD',
          amount: 100,
          account: 'GABC123...',
        },
        {
          headers: {
            Authorization: 'Bearer mock-jwt-token',
            'Content-Type': 'application/json',
          },
        }
      );
    });

    it('should throw when anchor does not support SEP-24', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: STELLAR_TOML_NO_SEP24 });

      await expect(
        AnchorService.initiateSEP24Withdrawal('no-sep24.example.com', 'token', {
          asset_code: 'AUD',
          amount: 100,
          account: 'GABC...',
        })
      ).rejects.toThrow('Anchor does not support SEP-24');
    });

    it('should include memo when provided', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: STELLAR_TOML_SEP24 })
        .mockResolvedValueOnce({ data: MOCK_SEP24_INFO });

      mockedAxios.post.mockResolvedValueOnce({ data: MOCK_SEP24_WITHDRAWAL_RESPONSE });

      await AnchorService.initiateSEP24Withdrawal(
        'anchor.example.com',
        'mock-jwt-token',
        {
          asset_code: 'AUD',
          amount: 50,
          account: 'GABC123...',
          memo: 'Employee cashout',
          memo_type: 'text',
        }
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          memo: 'Employee cashout',
          memo_type: 'text',
        }),
        expect.any(Object)
      );
    });
  });

  describe('getSEP24Transaction', () => {
    it('should GET /transactions?id= and return transaction details', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: STELLAR_TOML_SEP24 })        // discovery
        .mockResolvedValueOnce({ data: MOCK_SEP24_TRANSACTION });    // /transactions?id=...

      const result = await AnchorService.getSEP24Transaction(
        'anchor.example.com',
        'mock-jwt-token',
        'tx-001'
      );

      expect(result).toEqual(MOCK_SEP24_TRANSACTION);
      expect(result.transactions[0].id).toBe('tx-001');
      expect(result.transactions[0].status).toBe('completed');

      expect(mockedAxios.get).toHaveBeenLastCalledWith(
        'https://anchor.example.com/sep24/transactions',
        {
          params: { id: 'tx-001' },
          headers: { Authorization: 'Bearer mock-jwt-token' },
        }
      );
    });

    it('should throw when anchor does not support SEP-24', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: STELLAR_TOML_NO_SEP24 });

      await expect(
        AnchorService.getSEP24Transaction('no-sep24.example.com', 'token', 'tx-001')
      ).rejects.toThrow('Anchor does not support SEP-24');
    });
  });

  describe('authenticate', () => {
    it('should perform SEP-10 challenge-response and return a token', async () => {
      const testKeypair = Keypair.random();
      const mockToken = 'eyJhbGciOiJIUzI1NiIs...';

      // Discovery
      mockedAxios.get
        .mockResolvedValueOnce({ data: STELLAR_TOML_SEP24 })  // getAnchorInfo
        .mockResolvedValueOnce({                              // challenge GET
          data: {
            transaction: 'AAAAAgAAAAD...AAAAAQ==',
            network_passphrase: Networks.TESTNET,
          },
        });

      // Challenge POST (signed tx)
      mockedAxios.post.mockResolvedValueOnce({ data: { token: mockToken } });

      const token = await AnchorService.authenticate('anchor.example.com', testKeypair);

      expect(token).toBe(mockToken);
    });

    it('should throw if webAuthEndpoint is missing', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '' });

      const testKeypair = Keypair.random();
      await expect(
        AnchorService.authenticate('no-auth.example.com', testKeypair)
      ).rejects.toThrow('Anchor does not support SEP-10');
    });
  });
});
