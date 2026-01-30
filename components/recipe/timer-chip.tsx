
"use client";

import React, { useEffect } from "react";
import { useTimerStore } from "@/stores/timers";
import { PlayIcon, PauseIcon, ArrowPathIcon } from "@heroicons/react/24/solid";
import useSound from "use-sound";

// Simple "beep" sound hosted or base64. 
// For this MVP we will use a reliable public URL or assuming a local asset. 
// I'll assume we haven't added assets yet, so I'll skip the actual file path 
// and logic will be ready for it.
// const beepUrl = "/sounds/timer-end.mp3"; 

interface TimerChipProps {
    id: string;
    recipeId: string;
    initialLabel: string;
    durationMs: number;
    originalText: string;
}

function formatTime(ms: number) {
    const totalSeconds = Math.ceil(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TimerChip({ id, recipeId, initialLabel, durationMs, originalText }: TimerChipProps) {
    const timer = useTimerStore((state) => state.timers.find((t) => t.id === id));
    const addTimer = useTimerStore((state) => state.addTimer);
    const startTimer = useTimerStore((state) => state.startTimer);
    const pauseTimer = useTimerStore((state) => state.pauseTimer);
    const resetTimer = useTimerStore((state) => state.resetTimer);

    // Ensuring the timer exists in the store if we render this chip
    // We utilize useEffect to synchronize, but avoid re-triggering constantly
    useEffect(() => {
        if (!timer) {
            // It's just a passive chip until interacted with OR we can pre-register it.
            // Pre-registering might fill the store with hundreds of timers. 
            // Better strategy: Only register when clicked? 
            // Implementation choice: Button behavior.
        }
    }, [timer]);

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!timer) {
            addTimer(id, recipeId, initialLabel, durationMs);
            startTimer(id);
        } else if (timer.status === "running") {
            pauseTimer(id);
        } else if (timer.status === "paused") {
            startTimer(id);
        } else if (timer.status === "completed") {
            resetTimer(id);
        }
    };

    if (!timer) {
        // IDLE STATE (Looks like a chip/link)
        return (
            <button
                onClick={handleClick}
                className="inline-flex items-center mx-1 px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 hover:bg-orange-200 font-medium transition-colors text-base align-baseline transform translate-y-[1px]"
            >
                <PlayIcon className="w-3 h-3 mr-1" />
                {originalText}
            </button>
        );
    }

    // ACTIVE / PAUSED STATES
    const isCompleted = timer.status === "completed";
    const isRunning = timer.status === "running";

    let styles = "bg-orange-100 text-orange-700";
    if (isRunning) styles = "bg-orange-600 text-white shadow-sm";
    if (isCompleted) styles = "bg-red-600 text-white animate-pulse";

    return (
        <button
            onClick={handleClick}
            className={`inline-flex items-center mx-1 px-2 py-0.5 rounded-md font-mono font-medium transition-all text-base align-baseline transform translate-y-[1px] ${styles}`}
        >
            {isCompleted ? (
                <>
                    <ArrowPathIcon className="w-3 h-3 mr-1" />
                    DONE
                </>
            ) : (
                <>
                    {isRunning ? <PauseIcon className="w-3 h-3 mr-1" /> : <PlayIcon className="w-3 h-3 mr-1" />}
                    {formatTime(timer.remainingMs)}
                </>
            )}
        </button>
    );
}
