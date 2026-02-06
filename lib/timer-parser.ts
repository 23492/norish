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

  const TIME_PATTERN = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:-|to)?\\s*(\\d+(?:\\.\\d+)?)?\\s*(?:more)?\\s*(${timeUnits})s?`,
    "gi"
  );

  let match: RegExpExecArray | null = TIME_PATTERN.exec(text);

  while (match !== null) {
    const fullMatch = match[0];
    const value1 = parseFloat(match[1]);
    const value2 = match[2] ? parseFloat(match[2]) : null;
    const unit = match[3].toLowerCase();

    // Look up the multiplier for this keyword
    const multiplier = keywordToMultiplier.get(unit) ?? 60; // Default to minutes
    const durationSeconds = value1 * multiplier;

    matches.push({
      originalText: fullMatch,
      durationSeconds,
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
      label: fullMatch,
    });

    match = TIME_PATTERN.exec(text);
  }

  return matches;
}
