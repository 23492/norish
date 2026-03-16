"use client";

import type { HTTPHeaders } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import type { ReactNode } from "react";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TRPCClientError,
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  httpLink,
  loggerLink,
  splitLink,
  type TRPCLink,
  wsLink,
} from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { normalizeSubscriptionData } from "@norish/shared/lib/operation-helpers";
import superjson from "superjson";

import { createOperationIdLink } from "./operation-id-link";
import {
  createBatchRequestHeadersResolver,
  createRequestHeadersResolver,
} from "./request-headers";

type TrpcLogger = {
  info: (message: string) => void;
  warn: (meta: unknown, message: string) => void;
  debug: (meta: unknown, message: string) => void;
};

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

type ConnectionContextValue = {
  status: ConnectionStatus;
  isConnected: boolean;
};

export type MutationGuardContext = {
  path: string;
  input: unknown;
};

type CreateTRPCProviderBundleOptions = {
  logger: TrpcLogger;
  getBaseUrl?: () => string;
  getWsUrl?: () => string;
  getHeaders?: () => HTTPHeaders;
  getWebSocketImpl?: () => typeof WebSocket | undefined;
  maxRetries?: number;
  /** Set to false to disable tRPC loggerLink (defaults to true) */
  enableLoggerLink?: boolean;
  /** Optional callback that returns a pre-configured QueryClient (e.g. with persistence). */
  getQueryClient?: () => QueryClient;
  /** Optional guard used to block mutations before they hit the network. */
  shouldAllowMutation?: (context: MutationGuardContext) => boolean;
  /** Optional message used when a mutation is blocked by the guard. */
  getMutationBlockMessage?: (context: MutationGuardContext) => string;
  /** Called when the tRPC WebSocket closes (for any reason). */
  onWebSocketClose?: () => void;
  /** Called when the tRPC WebSocket opens successfully. */
  onWebSocketOpen?: () => void;
};

type SubscriptionObserverOptions = {
  onData?: (data: unknown) => void;
};

export function wrapSubscriptionObserverOptions(options: unknown): unknown {
  if (!options || typeof options !== "object") {
    return options;
  }

  const observerOptions = options as SubscriptionObserverOptions;

  if (typeof observerOptions.onData !== "function") {
    return options;
  }

  return {
    ...observerOptions,
    onData: (data: unknown) => observerOptions.onData?.(normalizeSubscriptionData(data)),
  };
}

export function wrapTrpcProxy<T>(value: T, cache: WeakMap<object, unknown>): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }

  const cached = cache.get(value as object);

  if (cached) {
    return cached as T;
  }

  const proxy = new Proxy(value as object, {
    get(target, prop, receiver) {
      const result = Reflect.get(target, prop, receiver);

      if (prop === "subscriptionOptions" && typeof result === "function") {
        return (...args: unknown[]) => {
          if (args.length === 0) {
            return Reflect.apply(result, target, args);
          }

          const wrappedArgs = [...args];
          const lastArgIndex = wrappedArgs.length - 1;

          wrappedArgs[lastArgIndex] = wrapSubscriptionObserverOptions(wrappedArgs[lastArgIndex]);

          return Reflect.apply(result, target, wrappedArgs);
        };
      }

      return wrapTrpcProxy(result, cache);
    },
  });

  cache.set(value as object, proxy);

  return proxy as T;
}

function createNormalizedUseTRPC<TRouter extends AnyTRPCRouter>(useRawTRPC: () => unknown) {
  return function useNormalizedTRPC() {
    const trpc = useRawTRPC();

    return useMemo(() => wrapTrpcProxy(trpc, new WeakMap()), [trpc]);
  };
}

const DEFAULT_MUTATION_BLOCK_MESSAGE =
  "You're offline. Reconnect before making changes.";

export function createMutationGuardLink<TRouter extends AnyTRPCRouter>(opts: {
  shouldAllowMutation: (context: MutationGuardContext) => boolean;
  getMutationBlockMessage?: (context: MutationGuardContext) => string;
}): TRPCLink<TRouter> {
  return () => {
    return ({ op, next }) => {
      if (op.type !== "mutation") {
        return next(op);
      }

      const context: MutationGuardContext = {
        path: op.path,
        input: op.input,
      };

      if (opts.shouldAllowMutation(context)) {
        return next(op);
      }

      const message =
        opts.getMutationBlockMessage?.(context) ?? DEFAULT_MUTATION_BLOCK_MESSAGE;

      return observable((observer) => {
        observer.error(
          new TRPCClientError(message, {
            cause: new Error(`Mutation blocked by reachability guard: ${op.path}`),
            meta: {
              guard: "mutation-reachability",
              mutationPath: op.path,
            },
          }),
        );
      });
    };
  };
}

function createHttpMutationLink(getBaseUrl: () => string, getHeaders: () => HTTPHeaders): TRPCLink<any> {
  return httpLink({
    url: `${getBaseUrl()}/api/trpc`,
    headers: createRequestHeadersResolver(getHeaders),
    transformer: {
      serialize: (data: unknown) => data,
      deserialize: superjson.deserialize,
    } as any,
  });
}

const defaultGetBaseUrl = () => {
  if (typeof window !== "undefined") {
    return "";
  }

  return `http://localhost:${process.env.PORT ?? 3000}`;
};

const defaultGetWsUrl = () => {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    return `${protocol}//${window.location.host}/trpc`;
  }

  return `ws://localhost:${process.env.PORT ?? 3000}/trpc`;
};

const defaultGetHeaders = (): HTTPHeaders => ({});

export function createTRPCProviderBundle<TRouter extends AnyTRPCRouter>({
  logger,
  getBaseUrl = defaultGetBaseUrl,
  getWsUrl = defaultGetWsUrl,
  getHeaders = defaultGetHeaders,
  getWebSocketImpl,
  maxRetries = 10,
  enableLoggerLink = true,
  getQueryClient: externalGetQueryClient,
  shouldAllowMutation,
  getMutationBlockMessage,
  onWebSocketClose,
  onWebSocketOpen,
}: CreateTRPCProviderBundleOptions) {
  const { TRPCProvider, useTRPC: useRawTRPC } = createTRPCContext<TRouter>();
  const useTRPC = createNormalizedUseTRPC<TRouter>(useRawTRPC);
  const ConnectionContext = createContext<ConnectionContextValue>({
    status: "idle",
    isConnected: false,
  });

  function useConnectionStatus() {
    return useContext(ConnectionContext);
  }

  function TRPCProviderWrapper({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<ConnectionStatus>("idle");
    const previousStatusRef = useRef<ConnectionStatus>("idle");
    const queryClientRef = useRef<QueryClient | null>(null);

    const [{ queryClient, trpcClient }] = useState(() => {
      const qc = externalGetQueryClient
        ? externalGetQueryClient()
        : new QueryClient({
            defaultOptions: {
              queries: {
                staleTime: 1000 * 60 * 5,
                gcTime: 1000 * 60 * 10,
                refetchOnWindowFocus: true,
                refetchOnMount: "always",
                retry: 1,
              },
            },
          });

      queryClientRef.current = qc;

      const wsClient = createWSClient({
        url: getWsUrl,
        WebSocket: getWebSocketImpl?.(),
        lazy: {
          enabled: true,
          closeMs: 0,
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
          setStatus("connected");
          onWebSocketOpen?.();
        },
        onClose: (cause) => {
          logger.info(`WebSocket closed: ${JSON.stringify(cause)}`);
          setStatus("disconnected");
          onWebSocketClose?.();
        },
      });

      const tc = createTRPCClient<TRouter>({
        links: [
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
          ...(shouldAllowMutation
            ? [
                createMutationGuardLink<TRouter>({
                  shouldAllowMutation,
                  getMutationBlockMessage,
                }),
              ]
            : []),
          splitLink({
            condition: (op) => op.type === "subscription",
            true: wsLink({ client: wsClient, transformer: superjson as any }),
            false: splitLink({
              condition: (op) => op.type === "mutation",
              true: createHttpMutationLink(getBaseUrl, getHeaders),
              false: httpBatchLink({
                url: `${getBaseUrl()}/api/trpc`,
                headers: createBatchRequestHeadersResolver(getHeaders),
                transformer: superjson as any,
              }),
            }),
          }),
        ],
      });

      return { queryClient: qc, trpcClient: tc };
    });

    useEffect(() => {
      const wasDisconnected = previousStatusRef.current !== "connected";

      previousStatusRef.current = status;

      if (status === "connected" && wasDisconnected && queryClientRef.current) {
        logger.info("Connection restored, invalidating queries");
        queryClientRef.current.invalidateQueries();
      }
    }, [logger, status]);

    const connectionValue: ConnectionContextValue = {
      status,
      isConnected: status === "connected",
    };

    return (
      <ConnectionContext.Provider value={connectionValue}>
        <QueryClientProvider client={queryClient}>
          <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
            {children}
          </TRPCProvider>
        </QueryClientProvider>
      </ConnectionContext.Provider>
    );
  }

  return {
    TRPCProvider,
    TRPCProviderWrapper,
    useTRPC,
    useConnectionStatus,
  };
}
