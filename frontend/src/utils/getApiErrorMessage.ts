import axios from 'axios';

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === 'object' && value !== null;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;

    if (isApiErrorPayload(responseData)) {
      if (typeof responseData.message === 'string' && responseData.message.trim()) {
        return responseData.message;
      }

      if (typeof responseData.error === 'string' && responseData.error.trim()) {
        return responseData.error;
      }
    }

    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
