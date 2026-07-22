import { useState, useCallback, useEffect, useRef } from 'react';
import withdrawalService, {
  AnchorInfo,
  WithdrawalRequest,
  WithdrawalTransaction,
} from '../services/withdrawal';

export type WithdrawalStep =
  | 'select_anchor'
  | 'enter_amount'
  | 'confirm'
  | 'processing'
  | 'complete'
  | 'failed';

export interface WithdrawalState {
  step: WithdrawalStep;
  anchors: AnchorInfo[];
  selectedAnchor: AnchorInfo | null;
  amount: string;
  estimatedReceive: number;
  transaction: WithdrawalTransaction | null;
  isLoading: boolean;
  isPolling: boolean;
  error: string | null;
}

interface UseWithdrawalReturn {
  state: WithdrawalState;
  setStep: (step: WithdrawalStep) => void;
  selectAnchor: (anchor: AnchorInfo) => void;
  setAmount: (amount: string) => void;
  initiateWithdrawal: (
    destinationType: 'bank_account' | 'mobile_money',
    destinationDetails: Record<string, string>
  ) => Promise<void>;
  openInteractiveUrl: () => void;
  pollTransactionStatus: () => Promise<void>;
  cancelWithdrawal: () => Promise<void>;
  reset: () => void;
  loadAnchors: () => Promise<void>;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // 3 minutes max

export function useWithdrawal(
  balance: number,
  exchangeRate: number,
  selectedCurrency: string
): UseWithdrawalReturn {
  const [state, setState] = useState<WithdrawalState>({
    step: 'select_anchor',
    anchors: [],
    selectedAnchor: null,
    amount: '',
    estimatedReceive: 0,
    transaction: null,
    isLoading: false,
    isPolling: false,
    error: null,
  });

  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const loadAnchors = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const anchors = await withdrawalService.getAvailableAnchors();
      setState((prev) => ({ ...prev, anchors, isLoading: false }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load anchors',
      }));
    }
  }, []);

  const setStep = useCallback((step: WithdrawalStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const selectAnchor = useCallback((anchor: AnchorInfo) => {
    setState((prev) => ({
      ...prev,
      selectedAnchor: anchor,
      step: 'enter_amount',
      error: null,
    }));
  }, []);

  const setAmount = useCallback(
    (amount: string) => {
      const numAmount = parseFloat(amount) || 0;
      const rate = state.selectedAnchor?.supportedCurrencies.includes(selectedCurrency)
        ? exchangeRate
        : exchangeRate;
      setState((prev) => ({
        ...prev,
        amount,
        estimatedReceive: numAmount * rate,
      }));
    },
    [exchangeRate, selectedCurrency, state.selectedAnchor]
  );

  const initiateWithdrawal = useCallback(
    async (
      destinationType: 'bank_account' | 'mobile_money',
      destinationDetails: Record<string, string>
    ) => {
      if (!state.selectedAnchor || !state.amount) {
        setState((prev) => ({ ...prev, error: 'Please select an anchor and enter an amount' }));
        return;
      }

      const amount = parseFloat(state.amount);
      if (isNaN(amount) || amount <= 0) {
        setState((prev) => ({ ...prev, error: 'Please enter a valid amount' }));
        return;
      }

      if (amount > balance) {
        setState((prev) => ({ ...prev, error: 'Insufficient balance' }));
        return;
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null, step: 'confirm' }));

      try {
        const request: WithdrawalRequest = {
          anchorDomain: state.selectedAnchor.domain,
          assetCode: 'ORGUSD',
          amount,
          destinationType,
          destinationDetails,
        };

        const response = await withdrawalService.initiateWithdrawal(request);

        const transaction: WithdrawalTransaction = {
          id: response.transactionId,
          anchorDomain: state.selectedAnchor.domain,
          status: 'pending_user_transfer',
          amountIn: amount,
          assetCode: 'ORGUSD',
          interactiveUrl: response.interactiveUrl,
          startedAt: new Date().toISOString(),
        };

        setState((prev) => ({
          ...prev,
          transaction,
          isLoading: false,
          step: 'processing',
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to initiate withdrawal',
          step: 'enter_amount',
        }));
      }
    },
    [state.selectedAnchor, state.amount, balance]
  );

  const pollTransactionStatus = useCallback(async () => {
    if (!state.transaction) return;

    setState((prev) => ({ ...prev, isPolling: true }));

    try {
      const updatedTx = await withdrawalService.getTransactionStatus(
        state.transaction.id,
        state.transaction.anchorDomain
      );

      setState((prev) => ({
        ...prev,
        transaction: updatedTx,
        isPolling: false,
      }));

      // Check if terminal state
      if (['completed', 'failed', 'refunded', 'expired', 'error'].includes(updatedTx.status)) {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setState((prev) => ({
          ...prev,
          step: updatedTx.status === 'completed' ? 'complete' : 'failed',
          isPolling: false,
        }));
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isPolling: false,
        error: err instanceof Error ? err.message : 'Failed to check status',
      }));
    }
  }, [state.transaction]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }

    pollCountRef.current = 0;
    pollTimerRef.current = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLL_ATTEMPTS) {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setState((prev) => ({
          ...prev,
          step: 'failed',
          error: 'Polling timeout - please check your transaction status later',
          isPolling: false,
        }));
        return;
      }
      void pollTransactionStatus();
    }, POLL_INTERVAL_MS);
  }, [pollTransactionStatus]);

  // Start polling when entering processing step
  useEffect(() => {
    if (state.step === 'processing' && state.transaction?.interactiveUrl) {
      startPolling();
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [state.step, state.transaction?.interactiveUrl, startPolling]);

  const openInteractiveUrl = useCallback(() => {
    if (state.transaction?.interactiveUrl) {
      window.open(state.transaction.interactiveUrl, '_blank', 'noopener,noreferrer');
    }
  }, [state.transaction]);

  const cancelWithdrawal = useCallback(async () => {
    if (!state.transaction) return;

    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      await withdrawalService.cancelWithdrawal(state.transaction.id);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setState((prev) => ({
        ...prev,
        step: 'select_anchor',
        transaction: null,
        isLoading: false,
        selectedAnchor: null,
        amount: '',
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to cancel withdrawal',
      }));
    }
  }, [state.transaction]);

  const reset = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setState({
      step: 'select_anchor',
      anchors: [],
      selectedAnchor: null,
      amount: '',
      estimatedReceive: 0,
      transaction: null,
      isLoading: false,
      isPolling: false,
      error: null,
    });
  }, []);

  return {
    state,
    setStep,
    selectAnchor,
    setAmount,
    initiateWithdrawal,
    openInteractiveUrl,
    pollTransactionStatus,
    cancelWithdrawal,
    reset,
    loadAnchors,
  };
}
