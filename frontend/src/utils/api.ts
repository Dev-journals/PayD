import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include the auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('payd_auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

export default api;

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export function createApiError(message: string, status?: number, code?: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Wrapper to ensure Promise rejection reasons are Error instances.
 */
export function safeReject<T>(reason: unknown): Promise<T> {
  let message: string;
  if (reason instanceof Error) {
    message = reason.message;
  } else if (typeof reason === 'object' && reason !== null) {
    message = JSON.stringify(reason);
  } else {
    message = String(reason);
  }
  return Promise.reject(reason instanceof Error ? reason : new Error(message));
}
