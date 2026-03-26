import { TRPCClientError } from '@trpc/client';

export function isBackendUnreachableError(error: unknown): boolean {
  if (error instanceof TRPCClientError) {
    return isNetworkError(error.cause) || !hasHttpStatus(error);
  }

  return isNetworkError(error);
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();

    return (
      msg.includes('fetch failed') ||
      msg.includes('network request failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('load failed')
    );
  }

  return false;
}

function hasHttpStatus(error: TRPCClientError<any>): boolean {
  const shape = error.data as Record<string, unknown> | undefined;

  return typeof shape?.httpStatus === 'number';
}
