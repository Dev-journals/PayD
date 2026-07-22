import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
  Building2,
  Smartphone,
} from 'lucide-react';
import { useWithdrawal } from '../hooks/useWithdrawal';
import { formatCurrency } from '../services/currencyConversion';

interface WithdrawalFlowProps {
  balance: number;
  exchangeRate: number;
  selectedCurrency: string;
  onClose: () => void;
  onSuccess: () => void;
}

const WithdrawalFlow: React.FC<WithdrawalFlowProps> = ({
  balance,
  exchangeRate,
  selectedCurrency,
  onClose,
  onSuccess,
}) => {
  const {
    state,
    setStep,
    selectAnchor,
    setAmount,
    initiateWithdrawal,
    openInteractiveUrl,
    cancelWithdrawal,
    reset,
    loadAnchors,
  } = useWithdrawal(balance, exchangeRate, selectedCurrency);

  const [destinationType, setDestinationType] = useState<'bank_account' | 'mobile_money'>(
    'bank_account'
  );
  const [destinationDetails, setDestinationDetails] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadAnchors();
  }, [loadAnchors]);

  const handleAmountSubmit = () => {
    setStep('confirm');
  };

  const handleConfirmWithdrawal = async () => {
    await initiateWithdrawal(destinationType, destinationDetails);
    if (state.step !== 'failed') {
      onSuccess();
    }
  };

  const handleReset = () => {
    reset();
    setDestinationDetails({});
    void loadAnchors();
  };

  const renderStep = () => {
    switch (state.step) {
      case 'select_anchor':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Select Withdrawal Method</h3>
            <p className="text-sm text-[var(--muted)]">
              Choose an anchor service to convert your ORGUSD to {selectedCurrency}.
            </p>

            {state.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
                <span className="ml-2 text-[var(--muted)]">Loading anchors...</span>
              </div>
            ) : state.anchors.length === 0 ? (
              <div className="text-center py-8">
                <XCircle className="w-12 h-12 mx-auto text-[var(--muted)] mb-4" />
                <p className="text-[var(--muted)]">No withdrawal anchors available</p>
              </div>
            ) : (
              <div className="space-y-3">
                {state.anchors.map((anchor) => (
                  <button
                    key={anchor.domain}
                    onClick={() => selectAnchor(anchor)}
                    className="w-full p-4 text-left rounded-xl border border-[var(--border)] hover:border-[var(--accent)] transition-colors bg-[var(--surface)]"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{anchor.name}</div>
                        <div className="text-sm text-[var(--muted)]">
                          Fee: {anchor.withdrawFee || 'Varies'} · Min:{' '}
                          {anchor.withdrawMinAmount || 0} {selectedCurrency}
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-[var(--muted)]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );

      case 'enter_amount':
        return (
          <div className="space-y-4">
            <button
              onClick={() => setStep('select_anchor')}
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <h3 className="text-lg font-semibold">Withdraw via {state.selectedAnchor?.name}</h3>

            <div>
              <label className="block text-sm text-[var(--muted)] mb-2">Amount (ORGUSD)</label>
              <input
                type="number"
                value={state.amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                max={balance}
                className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
              <div className="flex justify-between mt-2 text-sm">
                <span className="text-[var(--muted)]">
                  Available: {formatCurrency(balance, 'USD')}
                </span>
                <span className="text-[var(--muted)]">
                  ≈ {formatCurrency(state.estimatedReceive, selectedCurrency)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm text-[var(--muted)] mb-2">Destination Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setDestinationType('bank_account')}
                  className={`flex-1 p-3 rounded-lg border ${
                    destinationType === 'bank_account'
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)]'
                  }`}
                >
                  <Building2 className="w-5 h-5 mx-auto mb-1" />
                  <span className="text-sm">Bank Account</span>
                </button>
                <button
                  onClick={() => setDestinationType('mobile_money')}
                  className={`flex-1 p-3 rounded-lg border ${
                    destinationType === 'mobile_money'
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)]'
                  }`}
                >
                  <Smartphone className="w-5 h-5 mx-auto mb-1" />
                  <span className="text-sm">Mobile Money</span>
                </button>
              </div>
            </div>

            {destinationType === 'bank_account' ? (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Account Number"
                  value={destinationDetails.accountNumber || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, accountNumber: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Bank Name"
                  value={destinationDetails.bankName || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, bankName: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Phone Number"
                  value={destinationDetails.phoneNumber || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, phoneNumber: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Provider (e.g., M-Pesa, MTN)"
                  value={destinationDetails.provider || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, provider: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={handleAmountSubmit}
              disabled={
                !state.amount || parseFloat(state.amount) <= 0 || parseFloat(state.amount) > balance
              }
              className="w-full p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <button
              onClick={() => setStep('enter_amount')}
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <h3 className="text-lg font-semibold">Confirm Withdrawal</h3>

            <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-3">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Amount</span>
                <span className="font-medium">
                  {formatCurrency(parseFloat(state.amount), 'USD')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Anchor</span>
                <span className="font-medium">{state.selectedAnchor?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Receive</span>
                <span className="font-medium text-[var(--accent)]">
                  ≈ {formatCurrency(state.estimatedReceive, selectedCurrency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Destination</span>
                <span className="font-medium capitalize">{destinationType.replace('_', ' ')}</span>
              </div>
            </div>

            <button
              onClick={() => void handleConfirmWithdrawal()}
              disabled={state.isLoading}
              className="w-full p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {state.isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </span>
              ) : (
                'Confirm Withdrawal'
              )}
            </button>
          </div>
        );

      case 'processing':
        return (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <RefreshCw className="w-12 h-12 text-[var(--accent)] animate-spin" />
            </div>

            <h3 className="text-lg font-semibold">Processing Withdrawal</h3>
            <p className="text-sm text-[var(--muted)]">
              Please complete the withdrawal on the anchor's website.
            </p>

            <button
              onClick={openInteractiveUrl}
              className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10"
            >
              <ExternalLink className="w-4 h-4" />
              Open Anchor Website
            </button>

            <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
              <div className="flex justify-between mb-2">
                <span className="text-[var(--muted)]">Status</span>
                <span className="font-medium capitalize">
                  {state.transaction?.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Transaction ID</span>
                <span className="font-mono text-xs">{state.transaction?.id}</span>
              </div>
            </div>

            <button
              onClick={() => void cancelWithdrawal()}
              disabled={state.isLoading}
              className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
            >
              Cancel Withdrawal
            </button>
          </div>
        );

      case 'complete':
        return (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <CheckCircle2 className="w-16 h-16 text-[var(--success)]" />
            </div>

            <h3 className="text-lg font-semibold">Withdrawal Complete</h3>
            <p className="text-sm text-[var(--muted)]">
              Your withdrawal of {formatCurrency(parseFloat(state.amount), 'USD')} has been
              processed successfully.
            </p>

            <button
              onClick={onClose}
              className="w-full p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90"
            >
              Done
            </button>
          </div>
        );

      case 'failed':
        return (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <XCircle className="w-16 h-16 text-[var(--danger)]" />
            </div>

            <h3 className="text-lg font-semibold">Withdrawal Failed</h3>
            <p className="text-sm text-[var(--muted)]">
              {state.error || 'Something went wrong with your withdrawal.'}
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="flex-1 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)]"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="flex-1 p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90"
              >
                Close
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg)] rounded-2xl border border-[var(--border)] max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Cash Out</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Error Banner */}
          {state.error && state.step !== 'failed' && (
            <div className="mb-4 p-3 rounded-lg bg-[rgba(255,123,114,0.1)] border border-[rgba(255,123,114,0.2)]">
              <div className="flex items-center gap-2 text-[var(--danger)] text-sm">
                <AlertCircle className="w-4 h-4" />
                {state.error}
              </div>
            </div>
          )}

          {/* Step Content */}
          {renderStep()}
        </div>
      </div>
    </div>
  );
};

export default WithdrawalFlow;
