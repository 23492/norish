import type { AppRouter } from '@norish/trpc/client';
import { createTRPCProviderBundle } from '@norish/shared-react/providers';
import { createClientLogger } from '@norish/shared/lib/logger';
import React, { useEffect, useMemo } from 'react';

import { getAuthClient } from '@/lib/auth-client';
import { notifyBackendDisconnect, notifyBackendConnect } from '@/context/network-context';
import { createPersistedQueryClient } from '@/lib/query-cache/create-persisted-query-client';
import {
  createOutboxLink,
  setReplayFn,
  replayOutboxItem,
  startOutboxProcessor,
} from '@/lib/outbox';

const log = createClientLogger('mobile-trpc');

type CookieCapableAuthClient = ReturnType<typeof getAuthClient> & {
  getCookie?: () => string | undefined;
};

type HeaderCapableWebSocket = typeof WebSocket & {
  new (
    url: string | URL,
    protocols?: string | string[],
    options?: { headers: Record<string, string> },
  ): WebSocket;
};

function toWsUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);

  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/trpc';
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/+$/, '');
}

let currentBaseUrl = '';

function createMobileWebSocket(): typeof WebSocket | undefined {
  const NativeWebSocket = globalThis.WebSocket as HeaderCapableWebSocket | undefined;

  if (!NativeWebSocket) {
    return undefined;
  }

  return class MobileWebSocketWithHeaders extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const headers = trpcBundleGetHeaders();

      if (Object.keys(headers).length === 0) {
        super(url, protocols);
        return;
      }

      try {
        super(url, protocols, { headers });
      } catch {
        super(url, protocols);
      }
    }
  } as unknown as typeof WebSocket;
}

function trpcBundleGetHeaders(): Record<string, string> {
  if (!currentBaseUrl) {
    return {};
  }

  const client = getAuthClient(currentBaseUrl) as CookieCapableAuthClient;
  const cookies = client.getCookie?.();

  if (!cookies) {
    return {};
  }

  return { Cookie: cookies };
}

const { queryClient: persistedQueryClient, restorePromise: queryCacheRestorePromise } =
  createPersistedQueryClient();
export { queryCacheRestorePromise };
export { persistedQueryClient };

const trpcBundle = createTRPCProviderBundle<AppRouter>({
  logger: log,
  getBaseUrl: () => currentBaseUrl,
  getWsUrl: () => toWsUrl(currentBaseUrl),
  getHeaders: trpcBundleGetHeaders,
  getWebSocketImpl: createMobileWebSocket,
  wsLazyEnabled: false,
  enableLoggerLink: false,
  getQueryClient: () => persistedQueryClient,
  onWebSocketClose: notifyBackendDisconnect,
  onWebSocketOpen: notifyBackendConnect,
  mutationLink: createOutboxLink<AppRouter>(),
});

export const useTRPC = trpcBundle.useTRPC;
export const useConnectionStatus = trpcBundle.useConnectionStatus;
export const useTRPCClient = trpcBundle.useTRPCClient;

function OutboxReplayRegistration() {
  const trpcClient = useTRPCClient();

  useEffect(() => {
    if (!trpcClient) {
      return;
    }

    setReplayFn((item) => replayOutboxItem(trpcClient, item));
  }, [trpcClient]);

  return null;
}

export function TrpcProvider({
  baseUrl,
  children,
}: {
  baseUrl: string;
  children: React.ReactNode;
}) {
  const providerKey = useMemo(() => baseUrl, [baseUrl]);

  currentBaseUrl = baseUrl;

  useEffect(() => {
    const unsubscribe = startOutboxProcessor();

    return unsubscribe;
  }, []);

  return (
    <trpcBundle.TRPCProviderWrapper key={providerKey}>
      <OutboxReplayRegistration />
      {children}
    </trpcBundle.TRPCProviderWrapper>
  );
}
