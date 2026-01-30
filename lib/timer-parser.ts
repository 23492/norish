export type TimerMatch = {
    originalText: string;
    durationSeconds: number;
    startIndex: number;
    endIndex: number;
    label: string;
};

// Regex to capture:
// 1. Numbers (including decimals and ranges like 5-10 or 5 to 10)
// 2. Units (h, hr, hour, m, min, minute) - case insensitive
// 3. Optional "more" keyword handles "5 to 10 more minutes"
const TIME_PATTERN =
    /(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(?:more)?\s*(min(?:ute)?s?|hours?|hrs?)/gi;

export function parseTimerDurations(text: string): TimerMatch[] {
    const matches: TimerMatch[] = [];
    let match;

    // Reset lastIndex because we're using the global flag
    TIME_PATTERN.lastIndex = 0;

    while ((match = TIME_PATTERN.exec(text)) !== null) {
        const fullMatch = match[0];
        const value1 = parseFloat(match[1]);
        const value2 = match[2] ? parseFloat(match[2]) : null;
        const unit = match[3].toLowerCase();

        let durationSeconds = 0;

        // Determine base multiplier
        let multiplier = 60; // default to minutes
        if (unit.startsWith("h")) {
            multiplier = 3600;
        }

        // For ranges (e.g. 5-10 mins), usage often implies the lower bound for a "minimum" timer,
        // or we could support the average. For a safety timer, the lower bound is usually better to check.
        // However, if it's "check after 5 to 10 minutes", 5 is the safe bet.
        // We will use the first number (lower bound) for the duration.
        durationSeconds = value1 * multiplier;

        matches.push({
            originalText: fullMatch,
            durationSeconds,
            startIndex: match.index,
            endIndex: match.index + fullMatch.length,
            label: fullMatch, // The text to display on the chip
        });
    }

    return matches;
}
