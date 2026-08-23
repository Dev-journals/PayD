import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldOff, Loader2, KeyRound, Copy, Check } from 'lucide-react';
import {
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  startTwoFactorSetup,
  twoFactorErrorMessage,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from '../services/twoFactorApi.js';

const inputClass =
  'w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all';

export default function TwoFactorSettings() {
  const { t } = useTranslation();

  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStatus(await fetchTwoFactorStatus());
    } catch (loadError) {
      setError(twoFactorErrorMessage(loadError, t('twoFactor.errors.loadFailed')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleStartSetup = async () => {
    setFormError(null);
    setIsSubmitting(true);
    try {
      setSetup(await startTwoFactorSetup());
      setCode('');
    } catch (setupError) {
      setFormError(twoFactorErrorMessage(setupError, t('twoFactor.errors.setupFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnable = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const result = await enableTwoFactor(code.trim());
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode('');
      await loadStatus();
    } catch (enableError) {
      setFormError(twoFactorErrorMessage(enableError, t('twoFactor.errors.enableFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisable = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await disableTwoFactor(code.trim());
      setCode('');
      setRecoveryCodes(null);
      await loadStatus();
    } catch (disableError) {
      setFormError(twoFactorErrorMessage(disableError, t('twoFactor.errors.disableFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyCodes = async () => {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), 2000);
  };

  const codeInput = (label: string) => (
    <div className="flex flex-col gap-2">
      <label className="block text-xs font-bold uppercase tracking-widest text-muted">
        {label}
      </label>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="123456"
        className={`${inputClass} font-mono tracking-[0.5em]`}
      />
    </div>
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-12 max-w-3xl mx-auto w-full">
      <div className="w-full mb-12 flex items-end justify-between border-b border-hi pb-8">
        <div>
          <h1 className="text-4xl font-black mb-2 tracking-tight">{t('twoFactor.title')}</h1>
          <p className="text-sm text-muted mt-2">{t('twoFactor.subtitle')}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="w-full card glass noise p-8 flex items-center gap-3 text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          {t('twoFactor.loading')}
        </div>
      ) : null}

      {error ? <p className="w-full text-sm text-red-400 mb-8">{error}</p> : null}

      {!isLoading && status ? (
        <div className="w-full card glass noise p-8 mb-8">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            {status.enabled ? (
              <ShieldCheck className="w-5 h-5 text-accent" />
            ) : (
              <ShieldOff className="w-5 h-5" />
            )}
            {status.enabled ? t('twoFactor.statusEnabled') : t('twoFactor.statusDisabled')}
          </h2>
          <p className="text-sm text-muted">
            {status.enabled
              ? t('twoFactor.statusEnabledDescription', {
                  count: status.recoveryCodesRemaining,
                })
              : t('twoFactor.statusDisabledDescription')}
          </p>
        </div>
      ) : null}

      {/* Recovery codes are returned once, when 2FA is switched on. */}
      {recoveryCodes ? (
        <div className="w-full card glass noise p-8 mb-8">
          <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-accent" />
            {t('twoFactor.recoveryTitle')}
          </h2>
          <p className="text-sm text-muted mb-4">{t('twoFactor.recoveryDescription')}</p>
          <ul className="grid grid-cols-2 gap-2 mb-4">
            {recoveryCodes.map((recoveryCode) => (
              <li
                key={recoveryCode}
                className="px-3 py-2 rounded-lg bg-black/20 border border-hi font-mono text-sm text-center"
              >
                {recoveryCode}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void handleCopyCodes()}
            className="px-6 py-3 rounded-xl font-bold bg-accent text-black hover:opacity-90 transition-all flex items-center gap-2"
          >
            {hasCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {hasCopied ? t('twoFactor.copiedButton') : t('twoFactor.copyButton')}
          </button>
        </div>
      ) : null}

      {!isLoading && status && !status.enabled ? (
        <div className="w-full card glass noise p-8">
          <h2 className="text-lg font-bold mb-4">{t('twoFactor.enableTitle')}</h2>

          {setup ? (
            <form
              onSubmit={(event) => {
                void handleEnable(event);
              }}
              className="flex flex-col gap-4"
            >
              <p className="text-sm text-muted">{t('twoFactor.scanDescription')}</p>
              <img
                src={setup.qrCode}
                alt={t('twoFactor.qrAlt')}
                className="w-48 h-48 rounded-xl bg-white p-2 self-start"
              />
              <div className="flex flex-col gap-1">
                <span className="block text-xs font-bold uppercase tracking-widest text-muted">
                  {t('twoFactor.manualKeyLabel')}
                </span>
                <code className="font-mono text-sm break-all text-text">{setup.secret}</code>
              </div>

              {codeInput(t('twoFactor.codeLabel'))}

              {formError ? <p className="text-sm text-red-400">{formError}</p> : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="self-start px-6 py-3 rounded-xl font-bold bg-accent text-black hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                {t('twoFactor.enableButton')}
              </button>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">{t('twoFactor.enableDescription')}</p>
              {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleStartSetup()}
                className="self-start px-6 py-3 rounded-xl font-bold bg-accent text-black hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                {t('twoFactor.startButton')}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {!isLoading && status?.enabled ? (
        <form
          onSubmit={(event) => {
            void handleDisable(event);
          }}
          className="w-full card glass noise p-8 flex flex-col gap-4"
        >
          <h2 className="text-lg font-bold">{t('twoFactor.disableTitle')}</h2>
          <p className="text-sm text-muted">{t('twoFactor.disableDescription')}</p>

          {codeInput(t('twoFactor.codeLabel'))}

          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="self-start px-6 py-3 rounded-xl font-bold border border-hi text-text hover:border-red-400/60 hover:text-red-400 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldOff className="w-4 h-4" />
            )}
            {t('twoFactor.disableButton')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
