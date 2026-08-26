import * as React from 'react';
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  Users,
  DollarSign,
  CheckCircle2,
  Clock,
  Layers,
  Wifi,
  WifiOff,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useBulkPaymentTracker } from '../hooks/useBulkPaymentTracker';
import { useSocket } from '../hooks/useSocket';
import type { BatchRun, BatchRecipient } from '../services/bulkPaymentApi';
import styles from './BulkPaymentTracker.module.css';

const STELLAR_EXPERT_TX = 'https://stellar.expert/explorer/testnet/tx/';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortHash(hash: string | null) {
  if (!hash) return '—';
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function BatchStatusBadge({ status }: { status: BatchRun['status'] }) {
  const map: Record<BatchRun['status'], { cls: string; dot: string; label: string }> = {
    confirmed: { cls: styles.statusConfirmed, dot: styles.statusDotConfirmed, label: 'Confirmed' },
    pending: { cls: styles.statusPending, dot: styles.statusDotPending, label: 'Pending' },
    partial: { cls: styles.statusPartial, dot: styles.statusDotPartial, label: 'Partial' },
    failed: { cls: styles.statusFailed, dot: styles.statusDotFailed, label: 'Failed' },
  };
  const { cls, dot, label } = map[status];
  return (
    <span className={`${styles.statusBadge} ${cls}`}>
      <span className={`${styles.statusDot} ${dot}`} />
      {label}
    </span>
  );
}

function RecipientStatusBadge({ status }: { status: BatchRecipient['status'] }) {
  const map: Record<BatchRecipient['status'], { cls: string; dot: string; label: string }> = {
    confirmed: { cls: styles.statusConfirmed, dot: styles.statusDotConfirmed, label: 'Confirmed' },
    pending: { cls: styles.statusPending, dot: styles.statusDotPending, label: 'Pending' },
    failed: { cls: styles.statusFailed, dot: styles.statusDotFailed, label: 'Failed' },
  };
  const { cls, dot, label } = map[status];
  return (
    <span className={`${styles.statusBadge} ${cls}`}>
      <span className={`${styles.statusDot} ${dot}`} />
      {label}
    </span>
  );
}

// ── Recipient Expansion Panel ─────────────────────────────────────────────────

function RecipientPanel({ recipients }: { recipients: BatchRecipient[] }) {
  return (
    <div className={styles.recipientPanel}>
      <div className={styles.recipientHeader}>
        <span>Per-Recipient Breakdown</span>
        <span>
          {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Column headers */}
      <div className={styles.recipientGrid}>
        <span>Employee</span>
        <span>Amount</span>
        <span>Status</span>
        <span>Tx Hash</span>
        <span>Details</span>
      </div>

      {recipients.map((r) => (
        <div
          key={r.id}
          className={`${styles.recipientRow} ${r.status === 'failed' ? styles.recipientRowFailed : ''}`}
        >
          {/* Employee */}
          <div className={styles.recipientName}>
            <span>{r.employeeName}</span>
            <span className={styles.recipientWallet}>
              {r.walletAddress.slice(0, 6)}…{r.walletAddress.slice(-6)}
            </span>
          </div>

          {/* Amount */}
          <span className={styles.cellText}>
            {r.amount} {r.asset}
          </span>

          {/* Status */}
          <RecipientStatusBadge status={r.status} />

          {/* Tx Hash */}
          {r.txHash ? (
            <a
              href={`${STELLAR_EXPERT_TX}${r.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.hashLink}
              title={r.txHash}
            >
              {shortHash(r.txHash)}
              <ExternalLink size={10} />
            </a>
          ) : (
            <span className={styles.cellMuted}>—</span>
          )}

          {/* Error message or placeholder */}
          {r.status === 'failed' && r.errorMessage ? (
            <span className={styles.recipientError}>
              <XCircle size={12} />
              {r.errorMessage}
            </span>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Batch Row ─────────────────────────────────────────────────────────────────

interface BatchRowProps {
  batch: BatchRun;
  isExpanded: boolean;
  isRetrying: boolean;
  onToggle: () => void;
  onRetry: () => void;
}

const BatchRow: React.FC<BatchRowProps> = ({
  batch,
  isExpanded,
  isRetrying,
  onToggle,
  onRetry,
}) => {
  const hasFailed =
    batch.status === 'failed' ||
    batch.recipients.some((r: BatchRecipient) => r.status === 'failed');

  return (
    <div className={styles.batchRowWrapper}>
      <div
        id={`batch-row-${batch.id}`}
        className={`${styles.batchRow} ${isExpanded ? styles.batchRowExpanded : ''}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Date */}
        <span className={styles.cellMuted}>{formatDate(batch.createdAt)}</span>

        {/* Employees */}
        <span className={styles.cellText}>{batch.employeeCount}</span>

        {/* Total Amount */}
        <span className={styles.cellText}>
          {Number(batch.totalAmount).toLocaleString()} {batch.asset}
        </span>

        {/* Status */}
        <BatchStatusBadge status={batch.status} />

        {/* Confirmations */}
        <span
          className={`${styles.confirmBadge} ${batch.confirmations > 0 ? styles.confirmBadgeActive : ''}`}
        >
          <CheckCircle2 size={12} />
          {batch.confirmations}
        </span>

        {/* Tx Hash */}
        {batch.txHash ? (
          <a
            href={`${STELLAR_EXPERT_TX}${batch.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.hashLink}
            title={batch.txHash}
            onClick={(e) => e.stopPropagation()}
          >
            {shortHash(batch.txHash)}
            <ExternalLink size={10} />
          </a>
        ) : (
          <span className={styles.cellMuted}>—</span>
        )}

        {/* Expand / Retry */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={(e) => e.stopPropagation()}
        >
          {hasFailed && (
            <button
              id={`retry-btn-${batch.id}`}
              className={styles.retryBtn}
              onClick={onRetry}
              disabled={isRetrying}
              title="Retry failed batch"
              aria-label={`Retry batch ${batch.id}`}
            >
              {isRetrying ? (
                <RefreshCw size={11} className={styles.refreshSpin} />
              ) : (
                <RotateCcw size={11} />
              )}
              Retry
            </button>
          )}
          <button
            className={styles.expandBtn}
            onClick={onToggle}
            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {isExpanded && <RecipientPanel recipients={batch.recipients} />}
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BulkPaymentTracker() {
  const {
    batches,
    total,
    totalPages,
    page,
    setPage,
    statusFilter,
    setStatusFilter,
    isLoading,
    error,
    refresh,
    expandedBatchId,
    toggleExpand,
    retryingBatchId,
    handleRetry,
  } = useBulkPaymentTracker();

  const { connected } = useSocket();

  // ── Stats derived from visible page ──────────────────────────────────────
  const confirmedCount = batches.filter((b: BatchRun) => b.status === 'confirmed').length;
  const pendingCount = batches.filter(
    (b: BatchRun) => b.status === 'pending' || b.status === 'partial'
  ).length;
  const failedCount = batches.filter((b: BatchRun) => b.status === 'failed').length;

  return (
    <div className={`${styles.page} page-fade`}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            Bulk Payment <span className={styles.titleAccent}>Status Tracker</span>
          </h1>
          <p className={styles.subtitle}>Real-time on-chain confirmation for batch payroll runs</p>
        </div>

        <div className={styles.toolbar}>
          {/* Live indicator */}
          <div className={styles.liveIndicator}>
            <span className={`${styles.liveDot} ${connected ? '' : styles.disconnectedDot}`} />
            {connected ? 'Live' : 'Offline'}
          </div>

          {connected ? (
            <Wifi size={14} color="var(--success)" />
          ) : (
            <WifiOff size={14} color="var(--muted)" />
          )}

          {/* Status filter */}
          <select
            id="bulk-status-filter"
            className={styles.filterSelect}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="partial">Partial</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
          </select>

          <button
            id="bulk-refresh-btn"
            className={styles.refreshBtn}
            onClick={refresh}
            disabled={isLoading}
            aria-label="Refresh batch list"
          >
            <RefreshCw size={13} className={isLoading ? styles.refreshSpin : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Stat Chips ──────────────────────────────────────────────────── */}
      <div className={styles.statsRow}>
        <div className={styles.statChip}>
          <div
            className={styles.statChipIcon}
            style={{ background: 'rgba(74,240,184,0.1)', border: '1px solid rgba(74,240,184,0.2)' }}
          >
            <Layers size={16} color="var(--accent)" />
          </div>
          <div>
            <div className={styles.statChipValue}>{total}</div>
            <div className={styles.statChipLabel}>Total Batches</div>
          </div>
        </div>

        <div className={styles.statChip}>
          <div
            className={styles.statChipIcon}
            style={{ background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)' }}
          >
            <CheckCircle2 size={16} color="var(--success)" />
          </div>
          <div>
            <div className={styles.statChipValue}>{confirmedCount}</div>
            <div className={styles.statChipLabel}>Confirmed</div>
          </div>
        </div>

        <div className={styles.statChip}>
          <div
            className={styles.statChipIcon}
            style={{ background: 'rgba(255,213,0,0.1)', border: '1px solid rgba(255,213,0,0.2)' }}
          >
            <Clock size={16} color="#ffd500" />
          </div>
          <div>
            <div className={styles.statChipValue}>{pendingCount}</div>
            <div className={styles.statChipLabel}>In Progress</div>
          </div>
        </div>

        <div className={styles.statChip}>
          <div
            className={styles.statChipIcon}
            style={{
              background: 'rgba(255,123,114,0.1)',
              border: '1px solid rgba(255,123,114,0.2)',
            }}
          >
            <AlertTriangle size={16} color="var(--danger)" />
          </div>
          <div>
            <div className={styles.statChipValue}>{failedCount}</div>
            <div className={styles.statChipLabel}>Failed</div>
          </div>
        </div>

        <div className={styles.statChip}>
          <div
            className={styles.statChipIcon}
            style={{
              background: 'rgba(124,111,247,0.1)',
              border: '1px solid rgba(124,111,247,0.2)',
            }}
          >
            <Users size={16} color="var(--accent2)" />
          </div>
          <div>
            <div className={styles.statChipValue}>
              {batches.reduce((s: number, b: BatchRun) => s + b.employeeCount, 0)}
            </div>
            <div className={styles.statChipLabel}>Recipients</div>
          </div>
        </div>

        <div className={styles.statChip}>
          <div
            className={styles.statChipIcon}
            style={{
              background: 'rgba(74,240,184,0.06)',
              border: '1px solid rgba(74,240,184,0.15)',
            }}
          >
            <DollarSign size={16} color="var(--accent)" />
          </div>
          <div>
            <div className={styles.statChipValue}>
              {batches
                .reduce((s: number, b: BatchRun) => s + parseFloat(b.totalAmount), 0)
                .toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className={styles.statChipLabel}>Volume (page)</div>
          </div>
        </div>
      </div>

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className={styles.tableContainer}>
        {/* Table Header */}
        <div className={styles.tableHead}>
          <span className={styles.thCell}>Date</span>
          <span className={styles.thCell}>Employees</span>
          <span className={styles.thCell}>Total Amount</span>
          <span className={styles.thCell}>Status</span>
          <span className={styles.thCell}>Confs</span>
          <span className={styles.thCell}>Tx Hash</span>
          <span className={styles.thCell}>Actions</span>
        </div>

        {/* Body */}
        {isLoading ? (
          ['sk1', 'sk2', 'sk3', 'sk4', 'sk5', 'sk6', 'sk7', 'sk8'].map((id) => (
            <div key={id} className={`${styles.skeleton} ${styles.skeletonRow}`} />
          ))
        ) : batches.length === 0 ? (
          <div className={styles.empty}>
            <Layers className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No batch runs found</p>
            <p className={styles.emptyDesc}>
              {statusFilter !== 'all'
                ? `No batches with status "${statusFilter}". Try a different filter.`
                : 'Payroll batch runs will appear here once the first bulk payment is submitted.'}
            </p>
          </div>
        ) : (
          batches.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              isExpanded={expandedBatchId === batch.id}
              isRetrying={retryingBatchId === batch.id}
              onToggle={() => toggleExpand(batch.id)}
              onRetry={() => {
                void handleRetry(batch.id);
              }}
            />
          ))
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage(page - 1)}
              disabled={page <= 1 || isLoading}
              aria-label="Previous page"
            >
              ‹
            </button>

            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p =
                totalPages <= 7
                  ? i + 1
                  : page <= 4
                    ? i + 1
                    : page >= totalPages - 3
                      ? totalPages - 6 + i
                      : page - 3 + i;
              return (
                <button
                  key={p}
                  className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}
                  onClick={() => setPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                >
                  {p}
                </button>
              );
            })}

            <button
              className={styles.pageBtn}
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages || isLoading}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
