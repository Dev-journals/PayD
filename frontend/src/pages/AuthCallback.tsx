import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { completeTwoFactorLogin, twoFactorErrorMessage } from '../services/twoFactorApi.js';

const AuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Present only when the account has 2FA enabled: the first factor succeeded
  // but no session is issued until a one-time code is supplied.
  const challengeToken = searchParams.get('challengeToken');

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (challengeToken) return;

    const token = searchParams.get('token');
    if (token) {
      localStorage.setItem('payd_auth_token', token);
      // Optional: decode token to get user info or trigger a refresh in a context provider
      void navigate('/');
    } else {
      void navigate('/login?error=no_token');
    }
  }, [searchParams, navigate, challengeToken]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeToken) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const session = await completeTwoFactorLogin(challengeToken, code.trim());
      localStorage.setItem('payd_auth_token', session.accessToken);
      void navigate('/');
    } catch (submitError) {
      setError(twoFactorErrorMessage(submitError, t('twoFactor.errors.loginFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (challengeToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="glass noise p-10 rounded-3xl max-w-md w-full border border-white/10 shadow-2xl flex flex-col gap-4"
        >
          <h1 className="text-3xl font-black tracking-tight">{t('twoFactor.loginTitle')}</h1>
          <p className="text-sm text-muted">{t('twoFactor.loginDescription')}</p>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
            className="w-full bg-black/20 border border-hi rounded-xl p-4 text-text text-center font-mono tracking-[0.5em] outline-none focus:border-accent/50 focus:bg-accent/5 transition-all"
          />

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting || code.trim().length === 0}
            className="w-full py-3 px-4 bg-accent text-black font-bold rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
          >
            {t('twoFactor.loginButton')}
          </button>

          <p className="text-xs text-muted">{t('twoFactor.loginRecoveryHint')}</p>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-6">
        <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xl font-bold tracking-tight">Authenticating...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
