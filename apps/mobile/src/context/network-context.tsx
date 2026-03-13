import * as Network from 'expo-network';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { onlineManager } from '@tanstack/react-query';

import { createClientLogger } from '@norish/shared/lib/logger';

import { getBackendHealthUrl } from '@/lib/network/backend-base-url';
import {
  resetReachabilitySnapshot,
  setReachabilitySnapshot,
} from '@/lib/network/reachability-store';

const log = createClientLogger('network');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReachabilityMode = 'offline' | 'backend-unreachable' | 'online';

type RuntimeState = 'initializing' | 'ready';

type NetworkStatusValue = {
  deviceOnline: boolean;
  backendReachable: boolean;
  appOnline: boolean;
  mode: ReachabilityMode;
  runtimeState: RuntimeState;
};

/** Number of consecutive failed probes before marking backend unreachable. */
const FAILURE_THRESHOLD = 1;
/** Interval (ms) between background health checks while device-online and app foregrounded. */
const HEALTH_CHECK_INTERVAL_MS = 5_000;
/** Timeout (ms) for a single health probe request. */
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------------------
// Module-level disconnect notification
// ---------------------------------------------------------------------------

type DisconnectListener = () => void;

const disconnectListeners = new Set<DisconnectListener>();

function subscribeBackendDisconnect(listener: DisconnectListener): () => void {
  disconnectListeners.add(listener);

  return () => {
    disconnectListeners.delete(listener);
  };
}

/**
 * Call this from outside React (e.g. a WebSocket close handler) to hint
 * that the backend may have become unreachable. The `NetworkProvider`
 * will immediately run a health probe in response.
 */
export function notifyBackendDisconnect(): void {
  for (const listener of disconnectListeners) {
    listener();
  }
}

const NetworkContext = createContext<NetworkStatusValue | null>(null);

/**
 * Read the current reachability state.
 *
 * Must be called inside a `<NetworkProvider>`. Throws otherwise.
 */
export function useNetworkStatus(): NetworkStatusValue {
  const ctx = useContext(NetworkContext);

  if (!ctx) {
    throw new Error(
      'useNetworkStatus must be used inside a <NetworkProvider>',
    );
  }

  return ctx;
}

type NetworkProviderProps = {
  /** The configured backend base URL (null means no backend configured). */
  backendBaseUrl: string | null;
  children: React.ReactNode;
};

export function NetworkProvider({
  backendBaseUrl,
  children,
}: NetworkProviderProps) {
  // ---- state ----
  const [deviceOnline, setDeviceOnline] = useState(true); // assume online until we know otherwise
  const [backendReachable, setBackendReachable] = useState(false);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('initializing');

  // ---- refs for probing ----
  const consecutiveFailuresRef = useRef(0);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const backendBaseUrlRef = useRef(backendBaseUrl);
  backendBaseUrlRef.current = backendBaseUrl;

  // -------------------------------------------------------------------
  // Health-check probe
  // -------------------------------------------------------------------
  const probeBackend = useCallback(async (): Promise<boolean> => {
    const url = backendBaseUrlRef.current;

    if (!url) {
      return false;
    }

    const healthUrl = getBackendHealthUrl(url);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS,
      );

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return response.ok;
    } catch {
      return false;
    }
  }, []);

  // -------------------------------------------------------------------
  // Evaluate reachability after a probe result
  // -------------------------------------------------------------------
  const applyProbeResult = useCallback(
    (probeOk: boolean) => {
      if (!isMountedRef.current) {
        return;
      }

      if (probeOk) {
        // Immediate recovery on first successful probe
        consecutiveFailuresRef.current = 0;
        setBackendReachable(true);
      } else {
        consecutiveFailuresRef.current += 1;

        if (consecutiveFailuresRef.current >= FAILURE_THRESHOLD) {
          setBackendReachable(false);
        }
      }
    },
    [],
  );

  // -------------------------------------------------------------------
  // Run a full probe cycle (async)
  // -------------------------------------------------------------------
  const runProbe = useCallback(async () => {
    const ok = await probeBackend();

    applyProbeResult(ok);

    return ok;
  }, [applyProbeResult, probeBackend]);

  // -------------------------------------------------------------------
  // Device connectivity listener (expo-network)
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function checkDevice() {
      try {
        const state = await Network.getNetworkStateAsync();

        if (!cancelled) {
          setDeviceOnline(
            (state.isInternetReachable ?? state.isConnected) ?? false,
          );
        }
      } catch {
        if (!cancelled) {
          setDeviceOnline(false);
        }
      }
    }

    void checkDevice();

    // expo-network does not have a subscription API on all platforms,
    // so we also listen for AppState changes to re-check.
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void checkDevice();
      }
    });

    // Poll device state on a lightweight interval to catch connectivity changes
    const poll = setInterval(() => {
      void checkDevice();
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(poll);
    };
  }, []);

  // -------------------------------------------------------------------
  // Bootstrap: initial probe + settle runtime state
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!backendBaseUrl) {
        // No backend configured — skip probe, settle as ready.
        if (!cancelled) {
          setRuntimeState('ready');
        }

        return;
      }

      const ok = await probeBackend();

      if (cancelled) {
        return;
      }

      applyProbeResult(ok);
      setRuntimeState('ready');
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [applyProbeResult, backendBaseUrl, probeBackend]);

  // -------------------------------------------------------------------
  // Recurring health checks while device-online & app is foregrounded
  // -------------------------------------------------------------------
  useEffect(() => {
    function startInterval() {
      stopInterval();

      if (!deviceOnline || !backendBaseUrlRef.current) {
        return;
      }

      healthIntervalRef.current = setInterval(() => {
        void runProbe();
      }, HEALTH_CHECK_INTERVAL_MS);
    }

    function stopInterval() {
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
        healthIntervalRef.current = null;
      }
    }

    startInterval();

    // Re-probe on foreground
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && deviceOnline) {
        void runProbe();
        startInterval();
      } else if (nextState !== 'active') {
        stopInterval();
      }
    });

    return () => {
      stopInterval();
      sub.remove();
    };
  }, [deviceOnline, runProbe]);

  // -------------------------------------------------------------------
  // When device transitions offline → online, probe immediately
  // -------------------------------------------------------------------
  const prevDeviceOnlineRef = useRef(deviceOnline);

  useEffect(() => {
    const wasOffline = !prevDeviceOnlineRef.current;

    prevDeviceOnlineRef.current = deviceOnline;

    if (wasOffline && deviceOnline) {
      log.info('Device connectivity restored, probing backend');
      void runProbe();
    }

    if (!deviceOnline) {
      // If device goes offline, mark backend unreachable immediately
      setBackendReachable(false);
      consecutiveFailuresRef.current = FAILURE_THRESHOLD;
    }
  }, [deviceOnline, runProbe]);

  // -------------------------------------------------------------------
  // React to external disconnect hints (e.g. WebSocket close)
  // -------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = subscribeBackendDisconnect(() => {
      if (isMountedRef.current && deviceOnline) {
        log.info('Backend disconnect hint received, probing immediately');
        void runProbe();
      }
    });

    return unsubscribe;
  }, [deviceOnline, runProbe]);

  // -------------------------------------------------------------------
  // Wire TanStack Query onlineManager
  // -------------------------------------------------------------------
  const appOnline = deviceOnline && backendReachable;

  useEffect(() => {
    onlineManager.setOnline(appOnline);

    return onlineManager.setEventListener((setOnline) => {
      // The listener receives a setter from TanStack Query.
      // We keep it in sync with our appOnline state by calling it on mount.
      setOnline(appOnline);

      // Return cleanup — no-op since we re-run this effect on appOnline change
      return () => { };
    });
  }, [appOnline]);

  // -------------------------------------------------------------------
  // Derive mode
  // -------------------------------------------------------------------
  const mode: ReachabilityMode = !deviceOnline
    ? 'offline'
    : !backendReachable
      ? 'backend-unreachable'
      : 'online';

  // Log mode transitions
  const prevModeRef = useRef(mode);

  useEffect(() => {
    if (prevModeRef.current !== mode) {
      log.info(`Reachability mode: ${prevModeRef.current} → ${mode}`);
      prevModeRef.current = mode;
    }
  }, [mode]);

  // -------------------------------------------------------------------
  // Keep non-React reachability consumers in sync
  // -------------------------------------------------------------------
  useEffect(() => {
    setReachabilitySnapshot({ appOnline, mode, runtimeState });
  }, [appOnline, mode, runtimeState]);

  // -------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      resetReachabilitySnapshot();
    };
  }, []);

  const value = useMemo<NetworkStatusValue>(
    () => ({
      deviceOnline,
      backendReachable,
      appOnline,
      mode,
      runtimeState,
    }),
    [appOnline, backendReachable, deviceOnline, mode, runtimeState],
  );

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}
