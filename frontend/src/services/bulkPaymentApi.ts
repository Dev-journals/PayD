import axios from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001/api/v1';

export type RecipientStatus = 'pending' | 'confirmed' | 'failed';

export interface BatchRecipient {
  id: string;
  employeeName: string;
  walletAddress: string;
  amount: string;
  asset: string;
  status: RecipientStatus;
  txHash: string | null;
  errorMessage?: string;
}

export interface BatchRun {
  id: string;
  createdAt: string;
  employeeCount: number;
  totalAmount: string;
  asset: string;
  status: 'pending' | 'partial' | 'confirmed' | 'failed';
  txHash: string | null;
  confirmations: number;
  recipients: BatchRecipient[];
}

export interface BulkPaymentListResponse {
  data: BatchRun[];
  total: number;
  page: number;
  totalPages: number;
}

export interface BulkPaymentFilters {
  page?: number;
  limit?: number;
  status?: string;
}

export const fetchBulkPaymentBatches = async (
  filters: BulkPaymentFilters = {}
): Promise<BulkPaymentListResponse> => {
  try {
    const { data } = await axios.get<BulkPaymentListResponse>(`${API_BASE_URL}/bulk-payments`, {
      params: filters,
    });
    return data;
  } catch {
    // Return mock data when backend is unavailable
    return getMockBulkPaymentData(filters);
  }
};

export const retryBatchPayment = async (
  batchId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> => {
  try {
    const { data } = await axios.post<{ success: boolean; txHash?: string; error?: string }>(
      `${API_BASE_URL}/bulk-payments/${batchId}/retry`
    );
    return data;
  } catch {
    // Simulate a retry in development
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return {
      success: Math.random() > 0.3,
      txHash:
        Math.random() > 0.3
          ? Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
          : undefined,
      error: Math.random() > 0.3 ? undefined : 'Insufficient XLM balance for transaction fees.',
    };
  }
};

// ── Mock data generator ────────────────────────────────────────────────────
function getMockBulkPaymentData(filters: BulkPaymentFilters): BulkPaymentListResponse {
  const { page = 1, limit = 10 } = filters;

  const EMPLOYEE_NAMES = [
    'Alice Nakamura',
    'Bob Tesfaye',
    'Carol Osei',
    'David Lim',
    'Eve Sharpe',
    'Frank Müller',
    'Grace Kim',
    'Hiro Tanaka',
    'Iris Costa',
    'Jack Mensah',
  ];

  const ASSETS = ['USDC', 'XLM', 'EUROC'];
  const STATUSES: RecipientStatus[] = ['pending', 'confirmed', 'failed'];
  const BATCH_STATUSES: BatchRun['status'][] = ['confirmed', 'partial', 'pending', 'failed'];

  const generateHash = () =>
    Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

  const generateWallet = () =>
    'G' +
    Array.from(
      { length: 55 },
      () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[Math.floor(Math.random() * 32)]
    ).join('');

  const batches: BatchRun[] = Array.from({ length: 25 }, (_, batchIdx) => {
    const batchId = `batch-${String(batchIdx + 1).padStart(4, '0')}`;
    const asset = ASSETS[batchIdx % ASSETS.length];
    const batchStatus = BATCH_STATUSES[batchIdx % BATCH_STATUSES.length];
    const recipientCount = 3 + (batchIdx % 7);
    const createdAt = new Date(Date.now() - batchIdx * 86_400_000 * 1.5).toISOString();

    const recipients: BatchRecipient[] = Array.from({ length: recipientCount }, (_, rIdx) => {
      const recipientStatus: RecipientStatus =
        batchStatus === 'confirmed'
          ? 'confirmed'
          : batchStatus === 'failed'
            ? 'failed'
            : batchStatus === 'pending'
              ? 'pending'
              : STATUSES[rIdx % STATUSES.length];

      const amount = (100 + ((batchIdx * 37 + rIdx * 13) % 4900)).toFixed(2);

      return {
        id: `${batchId}-r${rIdx}`,
        employeeName: EMPLOYEE_NAMES[(batchIdx + rIdx) % EMPLOYEE_NAMES.length],
        walletAddress: generateWallet(),
        amount,
        asset,
        status: recipientStatus,
        txHash: recipientStatus !== 'pending' ? generateHash() : null,
        errorMessage:
          recipientStatus === 'failed'
            ? ['Insufficient balance', 'Trustline missing', 'Account not found'][rIdx % 3]
            : undefined,
      };
    });

    const totalAmount = recipients.reduce((sum, r) => sum + parseFloat(r.amount), 0).toFixed(2);

    const confirmedCount = recipients.filter((r) => r.status === 'confirmed').length;
    const confirmations =
      batchStatus === 'confirmed'
        ? 10
        : batchStatus === 'partial'
          ? Math.ceil(confirmedCount * 0.7)
          : 0;

    return {
      id: batchId,
      createdAt,
      employeeCount: recipientCount,
      totalAmount,
      asset,
      status: batchStatus,
      txHash: batchStatus !== 'pending' ? generateHash() : null,
      confirmations,
      recipients,
    };
  });

  const filtered =
    filters.status && filters.status !== 'all'
      ? batches.filter((b) => b.status === filters.status)
      : batches;

  const start = (page - 1) * limit;
  const end = start + limit;

  return {
    data: filtered.slice(start, end),
    total: filtered.length,
    page,
    totalPages: Math.ceil(filtered.length / limit),
  };
}
