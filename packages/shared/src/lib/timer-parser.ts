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

type TimerUnitCategory = keyof TimerKeywords;

const DEFAULT_HOUR_KEYWORDS = ["hour", "hours", "hr", "hrs", "h"];
const DEFAULT_MINUTE_KEYWORDS = ["minute", "minutes", "min", "mins", "m"];
const DEFAULT_SECOND_KEYWORDS = ["second", "seconds", "sec", "secs", "s"];

const DEFAULT_KEYWORDS_BY_CATEGORY: Record<TimerUnitCategory, string[]> = {
  hours: DEFAULT_HOUR_KEYWORDS,
  minutes: DEFAULT_MINUTE_KEYWORDS,
  seconds: DEFAULT_SECOND_KEYWORDS,
};

const SECONDS_PER_UNIT: Record<TimerUnitCategory, number> = {
  hours: 3600,
  minutes: 60,
  seconds: 1,
};

const TIMER_UNIT_CATEGORIES: TimerUnitCategory[] = ["hours", "minutes", "seconds"];

/**
 * Resolve a single time-unit keyword (e.g. "minutes", "uur") to its
 * seconds-per-unit multiplier, against the multilingual `timerKeywords`
 * config. Extracted from `parseTimerDurations`'s inline keyword->multiplier
 * map (Phase 27 W4, D-27-W4-12) so the Cooklang token render model
 * (`cookTimerDurationMs`) can resolve the SAME config without a second copy
 * of this table.
 *
 * Two resolution modes:
 * - `union: false` (default) — REPLACE semantics, exactly what
 *   `parseTimerDurations` has always done: a configured category list
 *   REPLACES the built-in English one wholesale. Correct for scanning
 *   prose, which is written in the deployment's configured language.
 * - `union: true` — the configured lists are UNIONED with the built-in
 *   English defaults (config wins on a collision). Required for a Cooklang
 *   token unit: `CookTimerToken.unit` is an unlocalized Cooklang TIME unit
 *   ("minutes", "hours"), not a norish canonical unit, and REPLACE
 *   semantics would make a `timerKeywords.hours` configured to non-English
 *   words silently miss every `~{n%hours}` token and fall back to the
 *   `?? 60` (minutes) default — a silent 60x error.
 *
 * Returns `undefined` when the unit matches no category in either mode;
 * callers apply their own fallback (`?? 60`, matching historical
 * behaviour).
 */
export function timerUnitSeconds(
  unit: string,
  keywords?: TimerKeywords,
  options?: { union?: boolean }
): number | undefined {
  const normalizedUnit = unit.toLowerCase();
  const map = new Map<string, number>();

  if (options?.union) {
    for (const category of TIMER_UNIT_CATEGORIES) {
      for (const kw of DEFAULT_KEYWORDS_BY_CATEGORY[category]) {
        map.set(kw.toLowerCase(), SECONDS_PER_UNIT[category]);
      }
    }
    // Configured keywords are applied SECOND, so they win any collision
    // with a built-in default (e.g. a deployment that maps "h" to minutes).
    for (const category of TIMER_UNIT_CATEGORIES) {
      for (const kw of keywords?.[category] ?? []) {
        map.set(kw.toLowerCase(), SECONDS_PER_UNIT[category]);
      }
    }
  } else {
    for (const category of TIMER_UNIT_CATEGORIES) {
      const list = keywords?.[category] ?? DEFAULT_KEYWORDS_BY_CATEGORY[category];

      for (const kw of list) {
        map.set(kw.toLowerCase(), SECONDS_PER_UNIT[category]);
      }
    }
  }

  return map.get(normalizedUnit);
}

/**
 * Parse timer durations from text using configurable keywords
 *
 * Strategy:
 * 1. Find all "number + unit" patterns (e.g., "15 minuten", "20 minutes")
 * 2. For each match, look backwards up to 2 words to find another number
 * 3. If found, it's a range - use the max value (e.g., "12 tot 15 minuten" => 15 minutes)
 * 4. This approach is language-agnostic and works with any range connector
 *
 * Examples handled:
 *   - "20 minutes" => 20 minutes
 *   - "12 to 15 minutes" => 15 minutes
 *   - "12 tot 15 minuten" => 15 minutes (Dutch)
 *   - "1-2 hours" => 2 hours
 *   - "bake for about 10 minutes" => 10 minutes
 *
 * @param text - The text to parse
 * @param keywords - Optional categorized time unit keywords
 * @returns Array of timer matches found in the text
 */
export function parseTimerDurations(text: string, keywords?: TimerKeywords): TimerMatch[] {
  const matches: TimerMatch[] = [];
  const matchedRanges: Array<{ start: number; end: number }> = [];

  // Build keyword groups (still needed for the regex and the colon-format
  // unit-after-check below; the multiplier LOOKUP itself now goes through
  // `timerUnitSeconds`, D-27-W4-12, so the token render path can reuse it).
  const hourKeywords = keywords?.hours ?? DEFAULT_HOUR_KEYWORDS;
  const minuteKeywords = keywords?.minutes ?? DEFAULT_MINUTE_KEYWORDS;
  const secondKeywords = keywords?.seconds ?? DEFAULT_SECOND_KEYWORDS;

  const allKeywords = [...hourKeywords, ...minuteKeywords, ...secondKeywords];
  const timeUnits = allKeywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

  // Helper function to check if a range overlaps with already-matched ranges
  const overlaps = (start: number, end: number): boolean => {
    return matchedRanges.some((range) => {
      return (
        (start >= range.start && start < range.end) ||
        (end > range.start && end <= range.end) ||
        (start <= range.start && end >= range.end)
      );
    });
  };

  // Pattern for HH:MM:SS or HH:MM or M:SS formats
  // Must check what unit (if any) follows to determine interpretation
  const colonPattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?/g;
  let colonMatch: RegExpExecArray | null = colonPattern.exec(text);

  while (colonMatch !== null) {
    const firstPart = colonMatch[1];
    const secondPart = colonMatch[2];

    if (!firstPart || !secondPart) {
      colonMatch = colonPattern.exec(text);
      continue;
    }

    const first = parseInt(firstPart, 10);
    const second = parseInt(secondPart, 10);
    const third = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0;
    const colonEnd = colonMatch.index + colonMatch[0].length;

    // Look ahead for time unit keyword after the colon pattern
    const afterText = text.substring(colonEnd, colonEnd + 20);
    const unitMatch = afterText.match(/^\s*([a-z]+)/i);
    const unitAfter = unitMatch?.[1]?.toLowerCase() ?? null;

    let durationSeconds: number;

    if (colonMatch[3]) {
      // HH:MM:SS format - always hours:minutes:seconds
      durationSeconds = first * 3600 + second * 60 + third;
    } else {
      // HH:MM or M:SS - check following unit keyword
      if (unitAfter && minuteKeywords.some((k) => k.toLowerCase() === unitAfter)) {
        // Unit is "minutes" or variant => interpret as minutes:seconds
        durationSeconds = first * 60 + second;
      } else if (unitAfter && hourKeywords.some((k) => k.toLowerCase() === unitAfter)) {
        // Unit is "hours" or variant => interpret as hours:minutes
        durationSeconds = first * 3600 + second * 60;
      } else {
        // NO unit or unrecognized => default to hours:minutes
        durationSeconds = first * 3600 + second * 60;
      }
    }

    // Construct the original text including the unit ONLY if it's a valid time keyword
    let fullMatch = colonMatch[0];
    let matchEndIndex = colonEnd;

    // Only include the unit if it's actually a recognized time keyword
    const isValidTimeUnit =
      unitAfter &&
      (hourKeywords.some((k) => k.toLowerCase() === unitAfter) ||
        minuteKeywords.some((k) => k.toLowerCase() === unitAfter) ||
        secondKeywords.some((k) => k.toLowerCase() === unitAfter));

    const unitWord = unitMatch?.[1];

    if (isValidTimeUnit && unitMatch && unitWord) {
      fullMatch += ` ${unitWord}`;
      matchEndIndex = colonEnd + unitMatch[0].length;
    }

    matches.push({
      originalText: fullMatch.trim(),
      durationSeconds,
      startIndex: colonMatch.index,
      endIndex: matchEndIndex,
      label: fullMatch.trim(),
    });

    // Track this matched range to prevent overlaps
    matchedRanges.push({ start: colonMatch.index, end: matchEndIndex });

    colonMatch = colonPattern.exec(text);
  }

  // Pattern to match "number + unit" (e.g., "15 minuten", "20 minutes")
  // Keywords should include all forms (singular, plural, abbreviations) directly
  const TIME_PATTERN = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(${timeUnits})(?=$|\\s|[.,!?;:()\\[\\]{}\"'])`,
    "gi"
  );

  let match: RegExpExecArray | null = TIME_PATTERN.exec(text);

  while (match !== null) {
    const primaryNumberRaw = match[1];
    const unitRaw = match[2];

    if (!primaryNumberRaw || !unitRaw) {
      match = TIME_PATTERN.exec(text);
      continue;
    }

    const primaryNumber = parseFloat(primaryNumberRaw);
    const unit = unitRaw.toLowerCase();
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    // Skip if this match overlaps with an already-matched colon pattern
    if (!overlaps(matchStart, matchEnd)) {
      // Look backwards from the match to find another number within ~2-3 words
      const beforeText = text.substring(Math.max(0, matchStart - 30), matchStart);

      // Pattern to find a number before this match (looks for last number in the preceding text)
      // This handles: "12 tot 15", "12-15", "12 to 15", "12 or 15", etc.
      // Exclude commas from range detection to avoid treating "10 mins, 5 hrs" as a range
      const priorNumberPattern = /(\d+(?:\.\d+)?)\s*[^\s,]*\s*$/;
      const priorMatch = beforeText.match(priorNumberPattern);

      let rangeStart: number | null = null;
      let fullMatchStart = matchStart;

      if (priorMatch) {
        const priorValue = priorMatch[1];
        const priorIndex = priorMatch.index;

        if (priorValue && priorIndex !== undefined) {
          rangeStart = parseFloat(priorValue);
          // Adjust the full match start to include the range start
          fullMatchStart = matchStart - (beforeText.length - priorIndex);
        }
      }

      // Look up the multiplier for this keyword (REPLACE semantics, unchanged)
      const multiplier = timerUnitSeconds(unit, keywords) ?? 60; // Default to minutes

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

      // Track this matched range to prevent overlaps
      matchedRanges.push({ start: fullMatchStart, end: matchEnd });
    }

    match = TIME_PATTERN.exec(text);
  }

  return matches;
}
