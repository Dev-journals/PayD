import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Activity,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Code2,
  RotateCcw,
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { useWallet } from '../hooks/useWallet';
import ContractUpgradeTab from '../components/ContractUpgradeTab';

/** Centralized API base so URL changes happen in one place. */
const API_BASE = '/api/v1';

const LOGS_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FreezeLog {
  id: number;
  target_account: string;
  asset_code: string;
  asset_issuer: string;
  action: 'freeze' | 'unfreeze';
  scope: 'account' | 'global';
  initiated_by: string;
  reason: string | null;
  created_at: string;
}

interface StatusResult {
  targetAccount: string;
  assetCode: string;
  assetIssuer: string;
  isFrozen: boolean;
  latestAction: FreezeLog | null;
}

interface ActionApiResponse {
  success: boolean;
  message: string;
  error?: string;
}

interface LogsApiResponse {
  success: boolean;
  data: FreezeLog[];
  total: number;
}

interface ClawbackLog {
  id: number;
  transaction_hash: string;
  asset_code: string;
  amount: string;
  from_account: string;
  issuer_account: string;
  reason: string | null;
  created_at: string;
}

type ActiveTab = 'account' | 'global' | 'status' | 'logs' | 'contracts' | 'clawback';

// ---------------------------------------------------------------------------
// Style constants – defined once to avoid repetition
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  'w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none ' +
  'focus:border-accent/50 focus:bg-accent/5 transition-all font-mono text-sm';

const LABEL_CLASS = 'block text-xs font-bold uppercase tracking-widest text-muted mb-2 ml-1';

const TAB_LABELS: Record<ActiveTab, string> = {
  account: 'Account Control',
  global: 'Global Asset Control',
  status: 'Status Check',
  logs: 'Audit Logs',
  contracts: 'Contract Upgrades',
  clawback: 'Clawback',
};

export default function AdminPanel() {
  const { notifySuccess, notifyError } = useNotification();
  const { address: adminAddress } = useWallet();

  const [activeTab, setActiveTab] = useState<ActiveTab>('account');

  // Account Control
  const [accountTarget, setAccountTarget] = useState('');
  const [accountAsset, setAccountAsset] = useState('ORGUSD');
  const [accountSecret, setAccountSecret] = useState('');
  const [accountReason, setAccountReason] = useState('');
  const [accountLoading, setAccountLoading] = useState(false);

  // Global Control
  const [globalAsset, setGlobalAsset] = useState('ORGUSD');
  const [globalSecret, setGlobalSecret] = useState('');
  const [globalReason, setGlobalReason] = useState('');
  const [globalLoading, setGlobalLoading] = useState(false);

  // Status Check
  const [statusTarget, setStatusTarget] = useState('');
  const [statusAsset, setStatusAsset] = useState('ORGUSD');
  const [statusIssuer, setStatusIssuer] = useState('');
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Audit Logs
  const [logs, setLogs] = useState<FreezeLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);

  // Clawback
  const [clawbackTarget, setClawbackTarget] = useState('');
  const [clawbackAmount, setClawbackAmount] = useState('');
  const [clawbackSecret, setClawbackSecret] = useState('');
  const [clawbackReason, setClawbackReason] = useState('');
  const [clawbackLoading, setClawbackLoading] = useState(false);
  const [clawbackLogs, setClawbackLogs] = useState<ClawbackLog[]>([]);
  const [clawbackLogsTotal, setClawbackLogsTotal] = useState(0);
  const [clawbackLogsPage, setClawbackLogsPage] = useState(1);
  const [clawbackLogsLoading, setClawbackLogsLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'logs') {
      void loadLogs(logsPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, logsPage]);

  useEffect(() => {
    if (activeTab === 'clawback') {
      void loadClawbackLogs(clawbackLogsPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, clawbackLogsPage]);

  // -----------------------------------------------------------------------
  // Data fetchers
  // -----------------------------------------------------------------------

  async function loadLogs(page: number) {
    setLogsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/freeze/logs?page=${page}&limit=${LOGS_PER_PAGE}`);
      const data = (await res.json()) as LogsApiResponse;
      if (data.success) {
        setLogs(data.data);
        setLogsTotal(data.total);
      }
    } catch {
      notifyError('Fetch Error', 'Failed to load audit logs.');
    } finally {
      setLogsLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Clawback log fetcher
  // -----------------------------------------------------------------------

  async function loadClawbackLogs(page: number) {
    setClawbackLogsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/assets/clawback/logs?page=${page}&limit=${LOGS_PER_PAGE}`
      );
      const data = (await res.json()) as { success: boolean; data: ClawbackLog[]; total: number };
      if (data.success) {
        setClawbackLogs(data.data);
        setClawbackLogsTotal(data.total);
      }
    } catch {
      notifyError('Fetch Error', 'Failed to load clawback logs.');
    } finally {
      setClawbackLogsLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------------

  async function handleAccountAction(action: 'freeze' | 'unfreeze') {
    if (!accountTarget || !accountAsset || !accountSecret) {
      notifyError('Missing fields', 'Target account, asset code, and issuer secret are required.');
      return;
    }
    setAccountLoading(true);
    try {
      const res = await fetch(`${API_BASE}/freeze/account/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuerSecret: accountSecret,
          targetAccount: accountTarget,
          assetCode: accountAsset,
          reason: accountReason || undefined,
        }),
      });
      const data = (await res.json()) as ActionApiResponse;
      if (!res.ok) throw new Error(data.error ?? 'Action failed');
      notifySuccess('Success', data.message);
      setAccountSecret('');
      setAccountReason('');
    } catch (err: unknown) {
      notifyError('Action Failed', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setAccountLoading(false);
    }
  }

  async function handleGlobalAction(action: 'freeze' | 'unfreeze') {
    if (!globalAsset || !globalSecret) {
      notifyError('Missing fields', 'Asset code and issuer secret are required.');
      return;
    }
    setGlobalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/freeze/global/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuerSecret: globalSecret,
          assetCode: globalAsset,
          reason: globalReason || undefined,
        }),
      });
      const data = (await res.json()) as ActionApiResponse;
      if (!res.ok) throw new Error(data.error ?? 'Action failed');
      notifySuccess('Success', data.message);
      setGlobalSecret('');
      setGlobalReason('');
    } catch (err: unknown) {
      notifyError('Action Failed', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setGlobalLoading(false);
    }
  }

  async function handleStatusCheck() {
    if (!statusTarget || !statusAsset || !statusIssuer) {
      notifyError('Missing fields', 'Target account, asset code, and asset issuer are required.');
      return;
    }
    setStatusLoading(true);
    setStatusResult(null);
    try {
      const params = new URLSearchParams({
        assetCode: statusAsset,
        assetIssuer: statusIssuer,
      });
      const res = await fetch(
        `${API_BASE}/freeze/status/${encodeURIComponent(statusTarget)}?${params}`
      );
      const data = (await res.json()) as StatusResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Status check failed');
      setStatusResult(data);
    } catch (err: unknown) {
      notifyError(
        'Status Check Failed',
        err instanceof Error ? err.message : 'Status check failed'
      );
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleClawback() {
    if (!clawbackTarget || !clawbackAmount || !clawbackSecret) {
      notifyError('Missing fields', 'Target account, amount, and issuer secret are required.');
      return;
    }
    const parsed = parseFloat(clawbackAmount);
    if (isNaN(parsed) || parsed <= 0) {
      notifyError('Invalid amount', 'Amount must be a positive number.');
      return;
    }
    setClawbackLoading(true);
    try {
      const res = await fetch(`${API_BASE}/assets/clawback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuerSecret: clawbackSecret,
          fromAccount: clawbackTarget,
          amount: clawbackAmount,
          reason: clawbackReason || undefined,
        }),
      });
      const data = (await res.json()) as { success: boolean; txHash?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Clawback failed');
      notifySuccess('Clawback Submitted', `Tx: ${data.txHash?.slice(0, 16)}…`);
      setClawbackTarget('');
      setClawbackAmount('');
      setClawbackSecret('');
      setClawbackReason('');
      // Refresh logs
      void loadClawbackLogs(1);
      setClawbackLogsPage(1);
    } catch (err: unknown) {
      notifyError('Clawback Failed', err instanceof Error ? err.message : 'Clawback failed');
    } finally {
      setClawbackLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(logsTotal / LOGS_PER_PAGE));
  const clawbackTotalPages = Math.max(1, Math.ceil(clawbackLogsTotal / LOGS_PER_PAGE));

  function tabClass(tab: ActiveTab) {
    return activeTab === tab
      ? 'pb-4 px-2 text-sm font-bold uppercase tracking-widest transition-colors text-text border-b-2 border-accent'
      : 'pb-4 px-2 text-sm font-bold uppercase tracking-widest transition-colors text-muted border-transparent hover:text-text';
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-4 sm:p-6 lg:p-12 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="w-full mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between border-b border-hi pb-4 sm:pb-8 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black mb-2 tracking-tight">
            Security <span className="text-red-500">Center</span>
          </h1>
          <p className="text-muted font-mono text-xs sm:text-sm tracking-wider uppercase">
            Asset Freeze & Administrative Controls
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="w-full mb-6 sm:mb-8 flex gap-2 sm:gap-4 border-b border-hi overflow-x-auto -mx-4 sm:-mx-6 lg:-mx-12 px-4 sm:px-6 lg:px-12 scrollbar-hide">
        {(Object.keys(TAB_LABELS) as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`${tabClass(tab)} whitespace-nowrap min-h-[44px] touch-manipulation`}
            style={{ minWidth: '44px' }}
          >
            {tab === 'contracts' && <Code2 className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />}
            <span className="text-xs sm:text-sm">{TAB_LABELS[tab]}</span>
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="w-full border border-hi rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 bg-black/10 backdrop-blur-md">
        {/* ── Account Control ─────────────────────────────────────── */}
        {activeTab === 'account' && (
          <div className="flex flex-col gap-4 sm:gap-6 max-w-2xl">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" /> Account Level Freeze
            </h2>
            <p className="text-xs sm:text-sm text-muted">
              Instantly block or restore an individual account's ability to transact with your
              asset.
            </p>

            <div className="grid gap-4">
              <div>
                <label className={LABEL_CLASS}>Target Account (Public Key)</label>
                <input
                  type="text"
                  value={accountTarget}
                  onChange={(e) => setAccountTarget(e.target.value.trim())}
                  className={INPUT_CLASS}
                  placeholder="G..."
                  spellCheck={false}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS}>Asset Code</label>
                  <input
                    type="text"
                    value={accountAsset}
                    onChange={(e) => setAccountAsset(e.target.value.toUpperCase().trim())}
                    className={INPUT_CLASS}
                    maxLength={12}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Issuer Secret Key</label>
                  <input
                    type="password"
                    value={accountSecret}
                    onChange={(e) => setAccountSecret(e.target.value.trim())}
                    className={INPUT_CLASS}
                    placeholder="S..."
                    autoComplete="off"
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_CLASS}>Reason (Audit Log)</label>
                <input
                  type="text"
                  value={accountReason}
                  onChange={(e) => setAccountReason(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="e.g. Suspicious activity detected"
                  maxLength={500}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-4">
              <button
                disabled={accountLoading}
                onClick={() => void handleAccountAction('freeze')}
                className="flex-1 py-3 sm:py-4 bg-red-500/20 text-red-500 border border-red-500/50 font-black rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-lg uppercase tracking-widest text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
              >
                {accountLoading ? 'Processing...' : 'Freeze Account'}
              </button>
              <button
                disabled={accountLoading}
                onClick={() => void handleAccountAction('unfreeze')}
                className="flex-1 py-3 sm:py-4 bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 font-black rounded-xl hover:bg-emerald-500 hover:text-white transition-all shadow-lg uppercase tracking-widest text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
              >
                {accountLoading ? 'Processing...' : 'Unfreeze Account'}
              </button>
            </div>
          </div>
        )}

        {/* ── Global Asset Control ─────────────────────────────────── */}
        {activeTab === 'global' && (
          <div className="flex flex-col gap-4 sm:gap-6 max-w-2xl">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" /> Global Asset Freeze
            </h2>
            <div className="bg-red-500/10 border border-red-500/30 p-3 sm:p-4 rounded-xl text-red-400 text-xs sm:text-sm">
              <strong>WARNING:</strong> This will freeze ALL accounts holding this asset. Reserve
              for systemic security breaches only.
            </div>

            <div className="grid gap-4 mt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS}>Asset Code</label>
                  <input
                    type="text"
                    value={globalAsset}
                    onChange={(e) => setGlobalAsset(e.target.value.toUpperCase().trim())}
                    className={INPUT_CLASS}
                    maxLength={12}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Issuer Secret Key</label>
                  <input
                    type="password"
                    value={globalSecret}
                    onChange={(e) => setGlobalSecret(e.target.value.trim())}
                    className={INPUT_CLASS}
                    placeholder="S..."
                    autoComplete="off"
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_CLASS}>Reason (Audit Log)</label>
                <input
                  type="text"
                  value={globalReason}
                  onChange={(e) => setGlobalReason(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Mandatory systemic freeze reason"
                  maxLength={500}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-4">
              <button
                disabled={globalLoading}
                onClick={() => void handleGlobalAction('freeze')}
                className="flex-1 py-3 sm:py-4 bg-red-600/30 text-red-400 border border-red-500/50 font-black rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-lg uppercase tracking-widest text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
              >
                {globalLoading ? 'Processing...' : 'Engage Global Freeze'}
              </button>
              <button
                disabled={globalLoading}
                onClick={() => void handleGlobalAction('unfreeze')}
                className="flex-1 py-3 sm:py-4 bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 font-black rounded-xl hover:bg-emerald-500 hover:text-white transition-all shadow-lg uppercase tracking-widest text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
              >
                {globalLoading ? 'Processing...' : 'Lift Global Freeze'}
              </button>
            </div>
          </div>
        )}

        {/* ── Status Check ─────────────────────────────────────────── */}
        {activeTab === 'status' && (
          <div className="flex flex-col gap-4 sm:gap-6 max-w-2xl">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-accent" /> Trustline Status
            </h2>
            <p className="text-xs sm:text-sm text-muted">
              Verify whether an account's trustline is currently frozen for a given asset.
            </p>

            <div className="grid gap-4">
              <div>
                <label className={LABEL_CLASS}>Target Account (Public Key)</label>
                <input
                  type="text"
                  value={statusTarget}
                  onChange={(e) => setStatusTarget(e.target.value.trim())}
                  className={INPUT_CLASS}
                  placeholder="G..."
                  spellCheck={false}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS}>Asset Code</label>
                  <input
                    type="text"
                    value={statusAsset}
                    onChange={(e) => setStatusAsset(e.target.value.toUpperCase().trim())}
                    className={INPUT_CLASS}
                    maxLength={12}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Asset Issuer (Public Key)</label>
                  <input
                    type="text"
                    value={statusIssuer}
                    onChange={(e) => setStatusIssuer(e.target.value.trim())}
                    className={INPUT_CLASS}
                    placeholder="G..."
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>

            <button
              disabled={statusLoading}
              onClick={() => void handleStatusCheck()}
              className="w-full sm:w-auto py-3 sm:py-4 px-6 bg-black/20 border border-hi font-black rounded-xl hover:bg-black/40 transition-all shadow-lg uppercase tracking-widest text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
            >
              {statusLoading ? 'Checking...' : 'Check Status'}
            </button>

            {statusResult && (
              <div className="p-4 sm:p-6 border border-hi rounded-xl bg-black/20">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-5">
                  <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-muted">
                    Status
                  </span>
                  <span
                    className={`px-3 py-1.5 rounded text-xs font-black uppercase tracking-widest border ${
                      statusResult.isFrozen
                        ? 'bg-red-500/20 text-red-500 border-red-500/30'
                        : 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30'
                    }`}
                  >
                    {statusResult.isFrozen ? 'Frozen' : 'Active'}
                  </span>
                </div>
                <dl className="grid gap-3 text-xs sm:text-sm">
                  <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                    <dt className="text-muted sm:min-w-[110px]">Account</dt>
                    <dd className="font-mono text-xs break-all sm:truncate">
                      {statusResult.targetAccount}
                    </dd>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                    <dt className="text-muted sm:min-w-[110px]">Asset</dt>
                    <dd className="font-bold">{statusResult.assetCode}</dd>
                  </div>
                  {statusResult.latestAction && (
                    <>
                      <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                        <dt className="text-muted sm:min-w-[110px]">Last Action</dt>
                        <dd className="capitalize">{statusResult.latestAction.action}</dd>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                        <dt className="text-muted sm:min-w-[110px]">Reason</dt>
                        <dd className="break-words">{statusResult.latestAction.reason || '—'}</dd>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                        <dt className="text-muted sm:min-w-[110px]">Timestamp</dt>
                        <dd className="font-mono text-xs">
                          {new Date(statusResult.latestAction.created_at).toLocaleString()}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </div>
            )}
          </div>
        )}

        {/* ── Contract Upgrades ────────────────────────────────────── */}
        {activeTab === 'contracts' && <ContractUpgradeTab adminAddress={adminAddress ?? ''} />}

        {/* ── Audit Logs ───────────────────────────────────────────── */}
        {activeTab === 'logs' && (
          <div className="flex flex-col gap-4 sm:gap-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-accent" /> Freeze Audit Logs
              </h2>
              <div className="flex items-center gap-3">
                {logsTotal > 0 && (
                  <span className="text-xs text-muted">
                    {(logsPage - 1) * LOGS_PER_PAGE + 1}–
                    {Math.min(logsPage * LOGS_PER_PAGE, logsTotal)} of {logsTotal}
                  </span>
                )}
                <button
                  onClick={() => void loadLogs(logsPage)}
                  disabled={logsLoading}
                  className="text-xs bg-black/20 px-3 py-2 rounded border border-hi hover:bg-black/40 disabled:opacity-50 touch-manipulation min-h-[44px]"
                >
                  {logsLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hi text-muted uppercase tracking-wider text-[10px]">
                    <th className="p-3">Time</th>
                    <th className="p-3">Target</th>
                    <th className="p-3">Asset</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Scope</th>
                    <th className="p-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted">
                        {logsLoading ? 'Loading…' : 'No freeze logs found.'}
                      </td>
                    </tr>
                  ) : (
                    logs.map((log: FreezeLog) => (
                      <tr
                        key={log.id}
                        className="border-b border-hi/50 hover:bg-white/5 transition-colors"
                      >
                        <td className="p-3 text-xs font-mono">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="p-3 text-xs font-mono" title={log.target_account}>
                          {log.target_account.slice(0, 8)}…{log.target_account.slice(-4)}
                        </td>
                        <td className="p-3 text-xs font-bold">{log.asset_code}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest ${
                              log.action === 'freeze'
                                ? 'bg-red-500/20 text-red-500'
                                : 'bg-emerald-500/20 text-emerald-500'
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 text-xs capitalize text-muted">{log.scope}</td>
                        <td
                          className="p-3 text-xs text-muted max-w-[200px] truncate"
                          title={log.reason || ''}
                        >
                          {log.reason || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {logs.length === 0 ? (
                <div className="p-8 text-center text-muted text-sm">
                  {logsLoading ? 'Loading…' : 'No freeze logs found.'}
                </div>
              ) : (
                logs.map((log: FreezeLog) => (
                  <div
                    key={log.id}
                    className="border border-hi/50 rounded-lg p-4 bg-black/5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-muted mb-1">
                          {new Date(log.created_at).toLocaleString()}
                        </div>
                        <div className="text-xs font-mono break-all">{log.target_account}</div>
                      </div>
                      <span
                        className={`px-2 py-1 rounded text-[10px] uppercase font-bold tracking-widest flex-shrink-0 ${
                          log.action === 'freeze'
                            ? 'bg-red-500/20 text-red-500'
                            : 'bg-emerald-500/20 text-emerald-500'
                        }`}
                      >
                        {log.action}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted">Asset:</span>
                        <span className="ml-1 font-bold">{log.asset_code}</span>
                      </div>
                      <div>
                        <span className="text-muted">Scope:</span>
                        <span className="ml-1 capitalize">{log.scope}</span>
                      </div>
                    </div>
                    {log.reason && (
                      <div className="text-xs">
                        <span className="text-muted">Reason:</span>
                        <div className="mt-1 text-text break-words">{log.reason}</div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 sm:gap-4 pt-2">
                <button
                  onClick={() => setLogsPage((p: number) => Math.max(1, p - 1))}
                  disabled={logsPage === 1 || logsLoading}
                  className="flex items-center gap-1 px-4 py-2.5 text-xs border border-hi rounded hover:bg-black/20 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
                >
                  <ChevronLeft className="w-4 h-4" />{' '}
                  <span className="hidden sm:inline">Previous</span>
                </button>
                <span className="text-xs text-muted px-2">
                  Page {logsPage} of {totalPages}
                </span>
                <button
                  onClick={() => setLogsPage((p: number) => Math.min(totalPages, p + 1))}
                  disabled={logsPage === totalPages || logsLoading}
                  className="flex items-center gap-1 px-4 py-2.5 text-xs border border-hi rounded hover:bg-black/20 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
                >
                  <span className="hidden sm:inline">Next</span>{' '}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Clawback ─────────────────────────────────────────────── */}
        {activeTab === 'clawback' && (
          <div className="flex flex-col gap-6">
            {/* ── Clawback Form ── */}
            <div className="flex flex-col gap-4 sm:gap-6 max-w-2xl">
              <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" /> Stellar Asset
                Clawback
              </h2>
              <div className="bg-orange-500/10 border border-orange-500/30 p-3 sm:p-4 rounded-xl text-orange-300 text-xs sm:text-sm">
                <strong>Irreversible:</strong> Clawback burns the specified amount from the target
                account. Use only for compliance or error-correction. Requires{' '}
                <code className="bg-black/20 px-1 rounded">auth_clawback_enabled</code> on the
                issuer account.
              </div>

              <div className="grid gap-4">
                <div>
                  <label className={LABEL_CLASS}>Target Account (Public Key)</label>
                  <input
                    id="clawback-target-account"
                    type="text"
                    value={clawbackTarget}
                    onChange={(e) => setClawbackTarget(e.target.value.trim())}
                    className={INPUT_CLASS}
                    placeholder="G..."
                    spellCheck={false}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL_CLASS}>Amount (ORGUSD)</label>
                    <input
                      id="clawback-amount"
                      type="number"
                      min="0.0000001"
                      step="0.0000001"
                      value={clawbackAmount}
                      onChange={(e) => setClawbackAmount(e.target.value)}
                      className={INPUT_CLASS}
                      placeholder="0.0000000"
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Issuer Secret Key</label>
                    <input
                      id="clawback-issuer-secret"
                      type="password"
                      value={clawbackSecret}
                      onChange={(e) => setClawbackSecret(e.target.value.trim())}
                      className={INPUT_CLASS}
                      placeholder="S..."
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>Reason (Compliance Audit Log)</label>
                  <input
                    id="clawback-reason"
                    type="text"
                    value={clawbackReason}
                    onChange={(e) => setClawbackReason(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="e.g. Funds sent to incorrect address"
                    maxLength={500}
                  />
                </div>
              </div>

              <button
                id="clawback-submit-btn"
                disabled={clawbackLoading}
                onClick={() => void handleClawback()}
                className="w-full sm:w-auto py-3 sm:py-4 px-8 bg-orange-500/20 text-orange-400 border border-orange-500/50 font-black rounded-xl hover:bg-orange-500 hover:text-white transition-all shadow-lg uppercase tracking-widest text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
              >
                {clawbackLoading ? 'Submitting…' : 'Execute Clawback'}
              </button>
            </div>

            {/* ── Clawback Audit Log ── */}
            <div className="flex flex-col gap-4 border-t border-hi pt-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-accent" /> Clawback History
                </h3>
                <div className="flex items-center gap-3">
                  {clawbackLogsTotal > 0 && (
                    <span className="text-xs text-muted">
                      {(clawbackLogsPage - 1) * LOGS_PER_PAGE + 1}–
                      {Math.min(clawbackLogsPage * LOGS_PER_PAGE, clawbackLogsTotal)} of{' '}
                      {clawbackLogsTotal}
                    </span>
                  )}
                  <button
                    onClick={() => void loadClawbackLogs(clawbackLogsPage)}
                    disabled={clawbackLogsLoading}
                    className="text-xs bg-black/20 px-3 py-2 rounded border border-hi hover:bg-black/40 disabled:opacity-50 touch-manipulation min-h-[44px]"
                  >
                    {clawbackLogsLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hi text-muted uppercase tracking-wider text-[10px]">
                      <th className="p-3">Time</th>
                      <th className="p-3">From Account</th>
                      <th className="p-3">Asset</th>
                      <th className="p-3">Amount</th>
                      <th className="p-3">Tx Hash</th>
                      <th className="p-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clawbackLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted">
                          {clawbackLogsLoading ? 'Loading…' : 'No clawback records found.'}
                        </td>
                      </tr>
                    ) : (
                      clawbackLogs.map((log: ClawbackLog) => (
                        <tr
                          key={log.id}
                          className="border-b border-hi/50 hover:bg-white/5 transition-colors"
                        >
                          <td className="p-3 text-xs font-mono">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          <td className="p-3 text-xs font-mono" title={log.from_account}>
                            {log.from_account.slice(0, 8)}…{log.from_account.slice(-4)}
                          </td>
                          <td className="p-3 text-xs font-bold">{log.asset_code}</td>
                          <td className="p-3 text-xs font-mono text-orange-400">{log.amount}</td>
                          <td className="p-3 text-xs font-mono" title={log.transaction_hash}>
                            {log.transaction_hash.slice(0, 10)}…
                          </td>
                          <td
                            className="p-3 text-xs text-muted max-w-[180px] truncate"
                            title={log.reason || ''}
                          >
                            {log.reason || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {clawbackLogs.length === 0 ? (
                  <div className="p-8 text-center text-muted text-sm">
                    {clawbackLogsLoading ? 'Loading…' : 'No clawback records found.'}
                  </div>
                ) : (
                  clawbackLogs.map((log: ClawbackLog) => (
                    <div
                      key={log.id}
                      className="border border-hi/50 rounded-lg p-4 bg-black/5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-mono text-muted mb-1">
                            {new Date(log.created_at).toLocaleString()}
                          </div>
                          <div className="text-xs font-mono break-all">{log.from_account}</div>
                        </div>
                        <span className="px-2 py-1 rounded text-[10px] uppercase font-bold tracking-widest bg-orange-500/20 text-orange-400 flex-shrink-0">
                          Clawback
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted">Asset:</span>
                          <span className="ml-1 font-bold">{log.asset_code}</span>
                        </div>
                        <div>
                          <span className="text-muted">Amount:</span>
                          <span className="ml-1 font-mono text-orange-400">{log.amount}</span>
                        </div>
                      </div>
                      <div
                        className="text-xs font-mono text-muted break-all"
                        title={log.transaction_hash}
                      >
                        Tx: {log.transaction_hash.slice(0, 16)}…
                      </div>
                      {log.reason && (
                        <div className="text-xs">
                          <span className="text-muted">Reason:</span>
                          <div className="mt-1 text-text break-words">{log.reason}</div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Pagination */}
              {clawbackTotalPages > 1 && (
                <div className="flex items-center justify-center gap-3 sm:gap-4 pt-2">
                  <button
                    onClick={() => setClawbackLogsPage((p: number) => Math.max(1, p - 1))}
                    disabled={clawbackLogsPage === 1 || clawbackLogsLoading}
                    className="flex items-center gap-1 px-4 py-2.5 text-xs border border-hi rounded hover:bg-black/20 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
                  >
                    <ChevronLeft className="w-4 h-4" />{' '}
                    <span className="hidden sm:inline">Previous</span>
                  </button>
                  <span className="text-xs text-muted px-2">
                    Page {clawbackLogsPage} of {clawbackTotalPages}
                  </span>
                  <button
                    onClick={() =>
                      setClawbackLogsPage((p: number) => Math.min(clawbackTotalPages, p + 1))
                    }
                    disabled={clawbackLogsPage === clawbackTotalPages || clawbackLogsLoading}
                    className="flex items-center gap-1 px-4 py-2.5 text-xs border border-hi rounded hover:bg-black/20 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation min-h-[44px]"
                  >
                    <span className="hidden sm:inline">Next</span>{' '}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
