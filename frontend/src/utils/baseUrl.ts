const isProd = import.meta.env.MODE === 'production' || import.meta.env.VITE_MODE === 'production';

const explicitBase = (import.meta.env.VITE_API_BASE_URL || '').trim();

export const API_BASE_URL: string = explicitBase || (isProd ? '' : '');

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}
