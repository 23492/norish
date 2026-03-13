export type ReachabilityMode = "offline" | "backend-unreachable" | "online";
export type ReachabilityRuntimeState = "initializing" | "ready";

type ReachabilitySnapshot = {
  appOnline: boolean;
  mode: ReachabilityMode;
  runtimeState: ReachabilityRuntimeState;
};

const DEFAULT_REACHABILITY_SNAPSHOT: ReachabilitySnapshot = {
  appOnline: false,
  mode: "offline",
  runtimeState: "initializing",
};

let snapshot: ReachabilitySnapshot = { ...DEFAULT_REACHABILITY_SNAPSHOT };

export function setReachabilitySnapshot(next: ReachabilitySnapshot): void {
  snapshot = next;
}

export function resetReachabilitySnapshot(): void {
  snapshot = { ...DEFAULT_REACHABILITY_SNAPSHOT };
}

export function getReachabilitySnapshot(): ReachabilitySnapshot {
  return snapshot;
}

export function isAppReachableForLiveWork(): boolean {
  return snapshot.runtimeState === "ready" && snapshot.appOnline;
}

// ---------------------------------------------------------------------------
// Localized mutation-blocked message
// ---------------------------------------------------------------------------

type MessageResolver = (mode: ReachabilityMode, runtimeState: ReachabilityRuntimeState) => string;

let resolveMessage: MessageResolver | null = null;

/**
 * Set by the React layer (e.g. a context provider) so that
 * `getMutationBlockedMessage` can return localized strings.
 */
export function setMutationMessageResolver(resolver: MessageResolver | null): void {
  resolveMessage = resolver;
}

export function getMutationBlockedMessage(): string {
  if (resolveMessage) {
    return resolveMessage(snapshot.mode, snapshot.runtimeState);
  }

  // Fallback (should never be reached once the React layer mounts)
  if (snapshot.runtimeState !== "ready") {
    return "Norish is still restoring cached data. Please try again in a moment.";
  }

  if (snapshot.mode === "backend-unreachable") {
    return "Can't reach the Norish server. Reconnect before making changes.";
  }

  return "You're offline. Reconnect before making changes.";
}
