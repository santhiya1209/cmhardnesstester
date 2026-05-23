import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';

/**
 * Shared API response handler for all CRUD endpoints.
 *
 * Each domain module (measurement, calibration, ...) calls `apiClient.get / post / put / delete`
 * with a path relative to the API root. Common concerns live here once:
 *   - URL composition off `API_BASE_URL` (dev proxy vs same-origin prod).
 *   - Response unwrapping (return `data` only — callers never touch the Axios envelope).
 *   - Error normalisation (extract `{ message }` from JSON bodies, fall back to Axios message).
 *
 * Non-CRUD endpoints (IPC calls via `window.api.invoke`, machine bridge ops, image dialogs)
 * keep their bespoke implementations — this client deliberately covers HTTP CRUD only.
 */

function buildUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractErrorMessage(err: AxiosError): string {
  const body = err.response?.data;
  if (isRecord(body)) {
    const candidate = body.message ?? body.error;
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  return err.message || 'Request failed';
}

async function request<T>(promise: Promise<{ data: T }>): Promise<T> {
  try {
    const res = await promise;
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      throw new Error(extractErrorMessage(err));
    }
    throw err;
  }
}

export const apiClient = {
  get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    return request<T>(axios.get<T>(buildUrl(path), config));
  },
  post<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return request<T>(axios.post<T>(buildUrl(path), body, config));
  },
  put<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return request<T>(axios.put<T>(buildUrl(path), body, config));
  },
  delete<T = void>(path: string, config?: AxiosRequestConfig): Promise<T> {
    return request<T>(axios.delete<T>(buildUrl(path), config));
  },
};
