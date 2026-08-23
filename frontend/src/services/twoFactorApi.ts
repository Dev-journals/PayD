import axios from 'axios';

const RAW_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';
const API_ROOT = RAW_API_URL.replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');
const TWO_FACTOR_URL = `${API_ROOT}/api/auth/2fa`;

function authHeaders() {
  const token = localStorage.getItem('payd_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  setupPending: boolean;
  recoveryCodesRemaining: number;
}

export interface TwoFactorSetup {
  /** Data URL of the QR code to scan with an authenticator app. */
  qrCode: string;
  otpauthUrl: string;
  /** Shown so the secret can be typed in manually when a QR scan is not possible. */
  secret: string;
}

export interface TwoFactorEnableResult {
  recoveryCodes: string[];
  recoveryCodeCount: number;
}

/** Login response when the account still owes a second factor. */
export interface TwoFactorChallenge {
  requires2fa: true;
  challengeToken: string;
}

export interface TwoFactorSession {
  accessToken: string;
  refreshToken: string;
  usedRecoveryCode: boolean;
  recoveryCodesRemaining: number;
}

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  const { data } = await axios.get<TwoFactorStatus>(`${TWO_FACTOR_URL}/status`, {
    headers: authHeaders(),
  });
  return data;
}

/** Step 1 of enrolment. 2FA stays off until {@link enableTwoFactor} succeeds. */
export async function startTwoFactorSetup(): Promise<TwoFactorSetup> {
  const { data } = await axios.post<TwoFactorSetup>(
    `${TWO_FACTOR_URL}/setup`,
    {},
    { headers: authHeaders() }
  );
  return data;
}

/** Step 2 of enrolment: confirms the code and returns the one-time recovery codes. */
export async function enableTwoFactor(code: string): Promise<TwoFactorEnableResult> {
  const { data } = await axios.post<TwoFactorEnableResult>(
    `${TWO_FACTOR_URL}/verify`,
    { code },
    { headers: authHeaders() }
  );
  return data;
}

/** Turns 2FA off. The backend requires a current TOTP code, not a recovery code. */
export async function disableTwoFactor(code: string): Promise<void> {
  await axios.post(`${TWO_FACTOR_URL}/disable`, { code }, { headers: authHeaders() });
}

/** Second step of login: exchanges the challenge from /login for a session. */
export async function completeTwoFactorLogin(
  challengeToken: string,
  code: string
): Promise<TwoFactorSession> {
  const { data } = await axios.post<TwoFactorSession>(`${TWO_FACTOR_URL}/authenticate`, {
    challengeToken,
    code,
  });
  return data;
}

/** Pulls the API's error message out of an axios failure, with a fallback. */
export function twoFactorErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error;
    if (message) return message;
  }
  return error instanceof Error ? error.message : fallback;
}
