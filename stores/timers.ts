
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TimerStatus = "running" | "paused" | "completed";

export type Timer = {
    id: string; // Composite ID: recipeId-stepIndex-occurrenceIndex
    recipeId: string;
    label: string; // "Top with cilantro..." truncated
    originalDurationMs: number;
    remainingMs: number;
    status: TimerStatus;
    lastTickAt: number | null; // Timestamp of last update to calculate drift
};

interface TimerState {
    timers: Timer[];

    // Actions
    addTimer: (id: string, recipeId: string, label: string, durationMs: number) => void;
    removeTimer: (id: string) => void;
    startTimer: (id: string) => void;
    pauseTimer: (id: string) => void;
    resetTimer: (id: string) => void;
    adjustTimer: (id: string, deltaMs: number) => void;

    // The tick loop to update times
    tick: () => void;
}

export const useTimerStore = create<TimerState>()(
    persist(
        (set, get) => ({
            timers: [],

            addTimer: (id, recipeId, label, durationMs) => {
                const existing = get().timers.find((t) => t.id === id);
                if (existing) return; // Don't duplicate

                set((state) => ({
                    timers: [
                        ...state.timers,
                        {
                            id,
                            recipeId,
                            label,
                            originalDurationMs: durationMs,
                            remainingMs: durationMs,
                            status: "paused",
                            lastTickAt: null,
                        },
                    ],
                }));
            },

            removeTimer: (id) => {
                set((state) => ({
                    timers: state.timers.filter((t) => t.id !== id),
                }));
            },

            startTimer: (id) => {
                set((state) => ({
                    timers: state.timers.map((t) =>
                        t.id === id
                            ? { ...t, status: "running", lastTickAt: Date.now() }
                            : t
                    ),
                }));
            },

            pauseTimer: (id) => {
                set((state) => ({
                    timers: state.timers.map((t) =>
                        t.id === id
                            ? { ...t, status: "paused", lastTickAt: null }
                            : t
                    ),
                }));
            },

            resetTimer: (id) => {
                set((state) => ({
                    timers: state.timers.map((t) =>
                        t.id === id
                            ? {
                                ...t,
                                status: "paused",
                                remainingMs: t.originalDurationMs,
                                lastTickAt: null,
                            }
                            : t
                    ),
                }));
            },

            adjustTimer: (id, deltaMs) => {
                set((state) => ({
                    timers: state.timers.map((t) => {
                        if (t.id !== id) return t;

                        const newRemaining = Math.max(0, t.remainingMs + deltaMs);
                        let newStatus = t.status;
                        let newLastTickAt = t.lastTickAt;

                        if (newRemaining === 0) {
                            newStatus = "completed";
                            newLastTickAt = Date.now();
                        } else if (t.status === "completed") {
                            // If adding time to a completed timer, restart it automatically
                            newStatus = "running";
                            newLastTickAt = Date.now();
                        }

                        return {
                            ...t,
                            remainingMs: newRemaining,
                            status: newStatus,
                            lastTickAt: newLastTickAt,
                        };
                    }),
                }));
            },

            tick: () => {
                const now = Date.now();
                set((state) => {
                    let hasChanges = false;
                    const newTimers = state.timers.map((t) => {
                        if (t.status !== "running" || t.lastTickAt === null) return t;

                        const delta = now - t.lastTickAt;
                        const newRemaining = Math.max(0, t.remainingMs - delta);

                        if (newRemaining === 0 && t.remainingMs > 0) {
                            // Timer just finished - we handle side effects (sound) in UI components
                            // explicitly marking as completed
                            hasChanges = true;
                            return { ...t, remainingMs: 0, status: "completed", lastTickAt: now };
                        }

                        hasChanges = true;
                        return { ...t, remainingMs: newRemaining, lastTickAt: now } as Timer;
                    });

                    return (hasChanges ? { timers: newTimers } : {}) as Partial<TimerState>;
                });
            },
        }),
        {
            name: "norish-timers", // localStorage key
        }
    )
);
