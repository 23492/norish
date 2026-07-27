import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTimerStore } from "./timers";

describe("useTimerStore", () => {
  beforeEach(() => {
    // Mock storage
    const storage = new Map();

    // Better approach for Vitest with Zustand persist:
    useTimerStore.persist.setOptions({
      storage: {
        getItem: (name) => storage.get(name) || null,
        setItem: (name, value) => storage.set(name, value),
        removeItem: (name) => storage.delete(name),
      },
    });

    useTimerStore.setState({ timers: [] });
    vi.useFakeTimers();
  });

  it("adds a timer", () => {
    const { addTimer } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000);

    const { timers } = useTimerStore.getState();

    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({
      id: "test-1",
      recipeId: "recipe-1",
      label: "Test Timer",
      originalDurationMs: 60000,
      remainingMs: 60000,
      status: "paused",
      lastTickAt: null,
    });
  });

  it("adds a timer with recipe name", () => {
    const { addTimer } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000, "My Recipe");

    const { timers } = useTimerStore.getState();

    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({
      id: "test-1",
      recipeId: "recipe-1",
      recipeName: "My Recipe",
      label: "Test Timer",
      originalDurationMs: 60000,
      remainingMs: 60000,
      status: "paused",
      lastTickAt: null,
    });
  });

  it("does not duplicate timers with same id", () => {
    const { addTimer } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000);
    addTimer("test-1", "recipe-1", "Test Timer", 60000);

    const { timers } = useTimerStore.getState();

    expect(timers).toHaveLength(1);
  });

  it("removes a timer", () => {
    const { addTimer, removeTimer } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000);
    removeTimer("test-1");

    const { timers } = useTimerStore.getState();

    expect(timers).toHaveLength(0);
  });

  it("starts a timer", () => {
    const { addTimer, startTimer } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000);
    startTimer("test-1");

    const { timers } = useTimerStore.getState();

    expect(timers[0].status).toBe("running");
    expect(timers[0].lastTickAt).not.toBeNull();
  });

  it("pauses a timer", () => {
    const { addTimer, startTimer, pauseTimer } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000);
    startTimer("test-1");
    pauseTimer("test-1");

    const { timers } = useTimerStore.getState();

    expect(timers[0].status).toBe("paused");
    expect(timers[0].lastTickAt).toBeNull();
  });

  it("resets a timer", () => {
    const { addTimer, startTimer, resetTimer, tick } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000);
    startTimer("test-1");

    // Advance time by 10 seconds
    vi.setSystemTime(Date.now() + 10000);
    tick();

    let { timers } = useTimerStore.getState();

    expect(timers[0].remainingMs).toBeLessThan(60000);

    resetTimer("test-1");

    timers = useTimerStore.getState().timers;
    expect(timers[0].remainingMs).toBe(60000);
    expect(timers[0].status).toBe("paused");
  });

  it("ticks correctly", () => {
    const { addTimer, startTimer, tick } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 60000);
    startTimer("test-1");

    // Advance time by 1 second
    const now = Date.now();

    vi.setSystemTime(now + 1000);
    tick();

    const { timers } = useTimerStore.getState();
    const expectedRemainingIds = 60000 - 1000;

    // Allow for slight execution delays
    expect(timers[0].remainingMs).toBeCloseTo(expectedRemainingIds, -2);
  });

  it("completes a timer", () => {
    const { addTimer, startTimer, tick } = useTimerStore.getState();

    addTimer("test-1", "recipe-1", "Test Timer", 1000);
    startTimer("test-1");

    // Advance time by 2 seconds (past duration)
    vi.setSystemTime(Date.now() + 2000);
    tick();

    const { timers } = useTimerStore.getState();

    expect(timers[0].remainingMs).toBe(0);
    expect(timers[0].status).toBe("completed");
  });

  it("uses high-attention notification options when timer completes in background", async () => {
    const showNotification = vi.fn();

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "granted" },
    });

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({ showNotification }),
      },
    });

    const { addTimer, startTimer, tick } = useTimerStore.getState();

    // Phase 27 W4 (D-27-W4-07): the notification `tag` is now the timer's
    // own id (was a fixed "timer-complete" string, which collapsed two
    // concurrently-completing timers into one OS notification). The id here
    // is chosen to equal the previously-hard-coded tag value so this
    // assertion's literal stays byte-for-byte unedited — see the dedicated
    // "raises a DISTINCT notification per concurrently completing timer"
    // case below for the actual per-timer-tag proof.
    addTimer("timer-complete", "recipe-1", "Test Timer", 1000);
    startTimer("timer-complete");

    vi.setSystemTime(Date.now() + 2000);
    tick();

    await Promise.resolve();

    expect(showNotification).toHaveBeenCalledWith(
      "Test Timer",
      expect.objectContaining({
        body: "Timer complete!",
        tag: "timer-complete",
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200],
      })
    );
  });

  it("raises a DISTINCT notification per concurrently completing timer (the pasta+sauce case, D-27-W4-07)", async () => {
    const showNotification = vi.fn();

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "granted" },
    });

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({ showNotification }),
      },
    });

    const { addTimer, startTimer, tick } = useTimerStore.getState();

    // Two named timers from the SAME step, ids shaped exactly like
    // `buildTokenTimerMap` (smart-markdown-renderer.tsx) and mobile's
    // `inline-token-renderer.tsx` actually emit them:
    // (`${recipeId}-s${stepIndex}-${tokenIndex}` — no `-t` infix).
    addTimer("recipe-1-s0-0", "recipe-1", "pasta", 1000);
    addTimer("recipe-1-s0-1", "recipe-1", "sauce", 1000);
    startTimer("recipe-1-s0-0");
    startTimer("recipe-1-s0-1");

    const { timers } = useTimerStore.getState();

    expect(timers).toHaveLength(2);
    expect(timers.every((timer) => timer.status === "running")).toBe(true);

    // One tick() decrements/completes BOTH — concurrency already exists at
    // the store level (D-27-W4-06); this proves it holds for two timers
    // sharing a recipeId/stepIndex prefix and differing only by token index.
    vi.setSystemTime(Date.now() + 2000);
    tick();

    await Promise.resolve();
    await Promise.resolve();

    const completed = useTimerStore.getState().timers;

    expect(completed.every((timer) => timer.status === "completed")).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(2);

    const tags = showNotification.mock.calls.map(([, options]) => options.tag);

    // DISTINCT tags — a shared/fixed tag would make the Notification API
    // replace the first with the second, collapsing "pasta done" and "sauce
    // done" into a single OS notification (the collapse D-27-W4-07 fixes).
    expect(new Set(tags).size).toBe(2);
    expect(tags).toEqual(expect.arrayContaining(["recipe-1-s0-0", "recipe-1-s0-1"]));

    const titles = showNotification.mock.calls.map(([title]) => title);

    expect(titles).toEqual(expect.arrayContaining(["pasta", "sauce"]));
  });

  it("adjusts timer duration", () => {
    const { addTimer, adjustTimer } = useTimerStore.getState();

    addTimer("test-adj", "recipe-1", "Adjust Timer", 60000);

    // Add 1 minute
    adjustTimer("test-adj", 60000);
    expect(useTimerStore.getState().timers[0].remainingMs).toBe(120000);

    // Subtract 30 seconds
    adjustTimer("test-adj", -30000);
    expect(useTimerStore.getState().timers[0].remainingMs).toBe(90000);

    // Subtract to zero -> verify completion
    adjustTimer("test-adj", -100000); // More than remaining
    let t = useTimerStore.getState().timers[0];

    expect(t.remainingMs).toBe(0);
    expect(t.status).toBe("completed");

    // Add time to completed timer -> verify restart
    adjustTimer("test-adj", 30000);
    t = useTimerStore.getState().timers[0];
    expect(t.remainingMs).toBe(30000);
    expect(t.status).toBe("running");
  });
});
