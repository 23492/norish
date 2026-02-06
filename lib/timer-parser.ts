export type TimerMatch = {
  originalText: string;
  durationSeconds: number;
  startIndex: number;
  endIndex: number;
  label: string;
};

export type TimerKeywords = {
  hours?: string[];
  minutes?: string[];
  seconds?: string[];
};

/**
 * Parse timer durations from text using configurable keywords
 *
 * Strategy:
 * 1. Find all "number + unit" patterns (e.g., "15 minuten", "20 minutes")
 * 2. For each match, look backwards up to 2 words to find another number
 * 3. If found, it's a range - use the max value (e.g., "12 tot 15 minuten" → 15 minutes)
 * 4. This approach is language-agnostic and works with any range connector
 *
 * Examples handled:
 *   - "20 minutes" → 20 minutes
 *   - "12 to 15 minutes" → 15 minutes
 *   - "12 tot 15 minuten" → 15 minutes (Dutch)
 *   - "1-2 hours" → 2 hours
 *   - "bake for about 10 minutes" → 10 minutes
 *
 * @param text - The text to parse
 * @param keywords - Optional categorized time unit keywords
 * @returns Array of timer matches found in the text
 */
export function parseTimerDurations(text: string, keywords?: TimerKeywords): TimerMatch[] {
  const matches: TimerMatch[] = [];

  // Build keyword groups with their multipliers
  const hourKeywords = keywords?.hours ?? ["hour", "hours", "hr", "hrs", "h"];
  const minuteKeywords = keywords?.minutes ?? ["minute", "minutes", "min", "mins", "m"];
  const secondKeywords = keywords?.seconds ?? ["second", "seconds", "sec", "secs", "s"];

  // Combine all keywords and create a mapping to multipliers
  const keywordToMultiplier = new Map<string, number>();

  hourKeywords.forEach((kw) => {
    keywordToMultiplier.set(kw.toLowerCase(), 3600);
  });
  minuteKeywords.forEach((kw) => {
    keywordToMultiplier.set(kw.toLowerCase(), 60);
  });
  secondKeywords.forEach((kw) => {
    keywordToMultiplier.set(kw.toLowerCase(), 1);
  });

  const allKeywords = [...hourKeywords, ...minuteKeywords, ...secondKeywords];
  const timeUnits = allKeywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

  // Pattern to match "number + unit" (e.g., "15 minuten", "20 minutes")
  // Handles optional plural 's' and suffixes like "en" in "minuten"
  const TIME_PATTERN = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${timeUnits})(?:en|s)?\\b`, "gi");

  let match: RegExpExecArray | null = TIME_PATTERN.exec(text);

  while (match !== null) {
    const primaryNumber = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    // Look backwards from the match to find another number within ~2-3 words
    const beforeText = text.substring(Math.max(0, matchStart - 30), matchStart);

    // Pattern to find a number before this match (looks for last number in the preceding text)
    // This handles: "12 tot 15", "12-15", "12 to 15", "12 or 15", etc.
    const priorNumberPattern = /(\d+(?:\.\d+)?)\s*\S*\s*$/;
    const priorMatch = beforeText.match(priorNumberPattern);

    let rangeStart: number | null = null;
    let fullMatchStart = matchStart;

    if (priorMatch) {
      rangeStart = parseFloat(priorMatch[1]);
      // Adjust the full match start to include the range start
      fullMatchStart = matchStart - (beforeText.length - priorMatch.index!);
    }

    // Look up the multiplier for this keyword
    const multiplier = keywordToMultiplier.get(unit) ?? 60; // Default to minutes

    // Use the maximum value if it's a range, otherwise use the primary number
    const duration = rangeStart !== null ? Math.max(rangeStart, primaryNumber) : primaryNumber;
    const durationSeconds = duration * multiplier;

    // Construct the original text (include range if found)
    const originalText = text.substring(fullMatchStart, matchEnd);

    matches.push({
      originalText: originalText.trim(),
      durationSeconds,
      startIndex: fullMatchStart,
      endIndex: matchEnd,
      label: originalText.trim(),
    });

    match = TIME_PATTERN.exec(text);
  }

  return matches;
}
