import type { HTTPHeaders, TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";

import {
  createWSClient,
  httpBatchLink,
  httpLink,
  isNonJsonSerializable,
  loggerLink,
  splitLink,
  wsLink,
} from "@trpc/client";
import superjson from "superjson";

import { createOperationIdLink } from "./operation-id-link";
import {
  createBatchRequestHeadersResolver,
  createRequestHeadersResolver,
} from "./request-headers";

export type TrpcLogger = {
  info: (message: string) => void;
  warn: (meta: unknown, message: string) => void;
  debug: (meta: unknown, message: string) => void;
};

export type CreateTRPCProviderBundleOptions = {
  logger: TrpcLogger;
  getBaseUrl?: () => string;
  getWsUrl?: () => string;
  getHeaders?: () => HTTPHeaders;
  getWebSocketImpl?: () => typeof WebSocket | undefined;
  wsLazyEnabled?: boolean;
  wsLazyCloseMs?: number;
  maxRetries?: number;
  enableLoggerLink?: boolean;
  getQueryClient?: () => import("@tanstack/react-query").QueryClient;
  onWebSocketClose?: (cause: unknown) => void;
  onWebSocketOpen?: () => void;
  mutationLink?: TRPCLink<any>;
  extraLinks?: TRPCLink<any>[];
};

type CreateTRPCClientLinksOptions = CreateTRPCProviderBundleOptions & {
  includeSubscriptions?: boolean;
};

function getWebSocketCloseCode(cause: unknown): number | null {
  if (!cause || typeof cause !== "object") {
    return null;
  }

  const event = cause as { code?: unknown; _code?: unknown };

  if (typeof event.code === "number") {
    return event.code;
  }

  if (typeof event._code === "number") {
    return event._code;
  }

  return null;
}

export function isNormalWebSocketClose(cause: unknown): boolean {
  return getWebSocketCloseCode(cause) === 1000;
}

function createHttpMutationLink(getBaseUrl: () => string, getHeaders: () => HTTPHeaders): TRPCLink<any> {
  return httpLink({
    url: `${getBaseUrl()}/api/trpc`,
    headers: createRequestHeadersResolver(getHeaders),
    transformer: superjson as any,
  });
}

function createHttpFormDataMutationLink(
  getBaseUrl: () => string,
  getHeaders: () => HTTPHeaders,
): TRPCLink<any> {
  return httpLink({
    url: `${getBaseUrl()}/api/trpc`,
    headers: createRequestHeadersResolver(getHeaders),
    transformer: {
      serialize: (data: unknown) => data,
      deserialize: superjson.deserialize,
    } as any,
  });
}

function createHttpTransportLink<TRouter extends AnyTRPCRouter>(
  getBaseUrl: () => string,
  getHeaders: () => HTTPHeaders,
): TRPCLink<TRouter> {
  return splitLink({
    condition: (op) => op.type === "mutation",
    true: splitLink({
      condition: (op) => isNonJsonSerializable(op.input),
      true: createHttpFormDataMutationLink(getBaseUrl, getHeaders),
      false: createHttpMutationLink(getBaseUrl, getHeaders),
    }),
    false: httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      headers: createBatchRequestHeadersResolver(getHeaders),
      transformer: superjson as any,
    }),
  });
}

export const defaultGetBaseUrl = () => {
  if (typeof window !== "undefined") {
    return "";
  }

  return `http://localhost:${process.env.PORT ?? 3000}`;
};

export const defaultGetWsUrl = () => {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    return `${protocol}//${window.location.host}/trpc`;
  }

  return `ws://localhost:${process.env.PORT ?? 3000}/trpc`;
};

export const defaultGetHeaders = (): HTTPHeaders => ({});

export function createTRPCClientLinks<TRouter extends AnyTRPCRouter>({
  logger,
  getBaseUrl = defaultGetBaseUrl,
  getWsUrl = defaultGetWsUrl,
  getHeaders = defaultGetHeaders,
  getWebSocketImpl,
  wsLazyEnabled = true,
  wsLazyCloseMs = 0,
  maxRetries = 10,
  enableLoggerLink = true,
  onWebSocketClose,
  onWebSocketOpen,
  mutationLink,
  extraLinks = [],
  includeSubscriptions = true,
}: CreateTRPCClientLinksOptions): TRPCLink<TRouter>[] {
  const transportLink = includeSubscriptions
    ? splitLink({
        condition: (op) => op.type === "subscription",
        true: wsLink({
          client: createWsClient(
            getWsUrl,
            getWebSocketImpl,
            wsLazyEnabled,
            wsLazyCloseMs,
            maxRetries,
            logger,
            onWebSocketOpen,
            onWebSocketClose,
          ),
          transformer: superjson as any,
        }),
        false: createHttpTransportLink(getBaseUrl, getHeaders),
      })
    : createHttpTransportLink(getBaseUrl, getHeaders);

  return [
    ...(enableLoggerLink
      ? [
          loggerLink({
            enabled: (opts) =>
              process.env.NODE_ENV === "development" ||
              (opts.direction === "down" && opts.result instanceof Error),
          }),
        ]
      : []),
    createOperationIdLink<TRouter>(),
    ...(mutationLink ? [mutationLink] : []),
    ...extraLinks,
    transportLink,
  ];
}

function createWsClient(
  getWsUrl: () => string,
  getWebSocketImpl: (() => typeof WebSocket | undefined) | undefined,
  wsLazyEnabled: boolean,
  wsLazyCloseMs: number,
  maxRetries: number,
  logger: TrpcLogger,
  onWebSocketOpen: (() => void) | undefined,
  onWebSocketClose: ((cause: unknown) => void) | undefined,
) {
  return createWSClient({
    url: getWsUrl,
    WebSocket: getWebSocketImpl?.(),
    lazy: {
      enabled: wsLazyEnabled,
      closeMs: wsLazyCloseMs,
    },
    retryDelayMs: (attemptIndex) => {
      if (attemptIndex >= maxRetries) {
        logger.warn({ attemptIndex }, "Max WebSocket retries reached, giving up");

        return Infinity;
      }

      const delay = Math.min(1000 * Math.pow(2, attemptIndex), 30000);

      logger.debug({ attemptIndex, delay }, "WebSocket reconnecting");

      return delay;
    },
    onOpen: () => {
      logger.info("WebSocket connected");
      onWebSocketOpen?.();
    },
    onClose: (cause) => {
      logger.info(`WebSocket closed: ${JSON.stringify(cause)}`);

      if (isNormalWebSocketClose(cause)) {
        return;
      }

      onWebSocketClose?.(cause);
    },
  });
}
