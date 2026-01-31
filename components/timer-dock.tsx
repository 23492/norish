"use client";

import React, { useEffect, useState } from "react";
import { useTimerStore } from "@/stores/timers";
import { XMarkIcon, ChevronUpIcon, ChevronDownIcon, PlayIcon, PauseIcon, TrashIcon } from "@heroicons/react/24/solid";
import { usePathname } from "next/navigation";
import useSound from "use-sound";
import { useTimersEnabledQuery } from "@/hooks/config";
import { useTranslations } from "next-intl";

// Global tick loop component
function TimerTicker() {
    const tick = useTimerStore((state) => state.tick);

    useEffect(() => {
        const interval = setInterval(() => {
            tick();
        }, 1000);
        return () => clearInterval(interval);
    }, [tick]);

    return null;
}

function formatTime(ms: number) {
    const totalSeconds = Math.ceil(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TimerDock() {
    const { timersEnabled } = useTimersEnabledQuery();
    const timers = useTimerStore((state) => state.timers);
    const activeTimers = timers.filter(t => t.status !== "paused" && t.status !== "completed");
    const pausedTimers = timers.filter(t => t.status === "paused");
    const completedTimers = timers.filter(t => t.status === "completed");

    const allActiveOrPaused = [...activeTimers, ...pausedTimers, ...completedTimers];
    const t = useTranslations("common");

    const [isExpanded, setIsExpanded] = useState(false);
    const [isClient, setIsClient] = useState(false);

    // Hydration fix
    useEffect(() => { setIsClient(true) }, []);

    // Audio Logic
    // loop: true ensures it keeps playing until dismissed
    const [play, { stop }] = useSound("/sounds/timer-done.mp3", { volume: 1.0, loop: true, interrupt: false });

    // Check if there are any completed timers
    const hasCompletedTimers = completedTimers.length > 0;

    // Track playing state locally to avoid TS errors if types are outdated
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        if (hasCompletedTimers) {
            // Only start playing if not already playing
            if (!isPlaying) {
                play();
                setIsPlaying(true);
            }
        } else {
            // Stop if no completed timers and currently playing
            if (isPlaying) {
                stop();
                setIsPlaying(false);
            }
        }

    }, [hasCompletedTimers, isPlaying, play, stop]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stop();
        };
    }, [stop]);

    if (!isClient || !timersEnabled) return null;
    if (allActiveOrPaused.length === 0) return <TimerTicker />;

    // Sort: completed first (to alert), then active by remaining time
    const sortedTimers = [...allActiveOrPaused].sort((a, b) => {
        if (a.status === "completed" && b.status !== "completed") return -1;
        if (b.status === "completed" && a.status !== "completed") return 1;
        return a.remainingMs - b.remainingMs;
    });

    const topTimer = sortedTimers[0];

    return (
        <>
            <TimerTicker />
            <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end space-y-2">
                {/* Expanded List */}
                {isExpanded && (
                    <div className="w-80 bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mb-2">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                            <span className="font-semibold text-sm">Timers ({allActiveOrPaused.length})</span>
                            <button onClick={() => setIsExpanded(false)} className="text-zinc-500 hover:text-zinc-700">
                                <ChevronDownIcon className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            {sortedTimers.map((timer) => (
                                <TimerRow key={timer.id} timer={timer} t={t} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Collapsed / Main Floater */}
                {!isExpanded && (
                    <button
                        onClick={() => setIsExpanded(true)}
                        className={`group flex items-center shadow-lg rounded-full px-4 py-3 transition-all ${topTimer.status === "completed"
                            ? "bg-red-600 text-white animate-pulse"
                            : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700"
                            }`}
                    >
                        <div className="flex flex-col items-start mr-3">
                            <span className="text-xs font-medium opacity-75 leading-none mb-1 max-w-[120px] truncate">
                                {topTimer.label}
                            </span>
                            <span className="font-mono text-lg font-bold leading-none">
                                {topTimer.status === "completed" ? t("timer.done") : formatTime(topTimer.remainingMs)}
                            </span>
                        </div>

                        {allActiveOrPaused.length > 1 && (
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-700 text-xs font-bold mr-2">
                                {allActiveOrPaused.length}
                            </div>
                        )}

                        <ChevronUpIcon className="w-5 h-5 opacity-50 group-hover:opacity-100" />
                    </button>
                )}
            </div>
        </>
    );
}

function TimerRow({ timer, t }: { timer: import("@/stores/timers").Timer, t: (key: string) => string }) {
    const pauseTimer = useTimerStore((state) => state.pauseTimer);
    const startTimer = useTimerStore((state) => state.startTimer);
    const removeTimer = useTimerStore((state) => state.removeTimer);

    const isCompleted = timer.status === "completed";
    const isRunning = timer.status === "running";

    return (
        <div className={`p-3 border-b last:border-0 flex items-center justify-between ${isCompleted ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
            <div className="flex-1 min-w-0 mr-3">
                <h4 className="text-sm font-medium truncate mb-0.5">{timer.label}</h4>
                <div className={`font-mono text-xl ${isCompleted ? 'text-red-600 font-bold' : ''}`}>
                    {isCompleted ? t("timer.done") : formatTime(timer.remainingMs)}
                </div>
            </div>

            <div className="flex items-center space-x-1">
                {!isCompleted && (
                    <button
                        onClick={() => isRunning ? pauseTimer(timer.id) : startTimer(timer.id)}
                        className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                    >
                        {isRunning ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
                    </button>
                )}

                <button
                    onClick={() => removeTimer(timer.id)}
                    className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500"
                >
                    <TrashIcon className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
