
"use client";

import React, { useMemo } from "react";
import { useTimerStore } from "@/stores/timers";
import { TimerChip } from "@/components/recipe/timer-chip";
import { v4 as uuidv4 } from "uuid";

interface SmartInstructionProps {
    text: string;
    recipeId: string;
    stepIndex: number;
}

import { parseTimerDurations } from "@/lib/timer-parser";

interface SmartInstructionProps {
    text: string;
    recipeId: string;
    stepIndex: number;
}

import { useTimersEnabledQuery } from "@/hooks/config";

export function SmartInstruction({ text, recipeId, stepIndex }: SmartInstructionProps) {
    const { timersEnabled } = useTimersEnabledQuery();

    // We use useMemo so this parsing only happens when text/IDs change
    const segments = useMemo(() => {
        if (timersEnabled === false) {
            return [text];
        }

        const parts: React.ReactNode[] = [];
        let lastIndex = 0;

        // Use the robust parser from lib
        const matches = parseTimerDurations(text);

        matches.forEach((match, occurrenceIndex) => {
            // 1. Text before the match
            if (match.startIndex > lastIndex) {
                parts.push(text.slice(lastIndex, match.startIndex));
            }

            // 2. The match itself -> turned into a TimerChip
            const durationMs = match.durationSeconds * 1000;

            // Create a deterministic ID for this timer
            // recipeId-stepIndex-occurrenceIndex
            const timerId = `${recipeId}-s${stepIndex}-${occurrenceIndex}`;

            // Create a label from context? For now just use the matched text or truncated step
            const label = `Step ${stepIndex + 1} Timer`;

            parts.push(
                <TimerChip
                    key={timerId}
                    id={timerId}
                    recipeId={recipeId}
                    initialLabel={label}
                    durationMs={durationMs}
                    originalText={match.originalText}
                />
            );

            lastIndex = match.endIndex;
        });

        // 3. Remaining text
        if (lastIndex < text.length) {
            parts.push(text.slice(lastIndex));
        }

        return parts;
    }, [text, recipeId, stepIndex]);

    return <span>{segments}</span>;
}
