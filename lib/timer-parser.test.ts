import { parseTimerDurations } from "./timer-parser";
import { describe, it, expect } from "vitest";

describe("parseTimerDurations", () => {
    it("detects simple minutes", () => {
        const matches = parseTimerDurations("Bake for 20 minutes");
        expect(matches).toHaveLength(1);
        expect(matches[0].durationSeconds).toBe(20 * 60);
        expect(matches[0].originalText).toBe("20 minutes");
    });

    it("detects simple hours", () => {
        const matches = parseTimerDurations("Cook for 2 hours");
        expect(matches).toHaveLength(1);
        expect(matches[0].durationSeconds).toBe(2 * 3600);
    });

    it("detects ranges like '5-10 minutes'", () => {
        const matches = parseTimerDurations("Simmer for 5-10 minutes");
        expect(matches).toHaveLength(1);
        expect(matches[0].durationSeconds).toBe(5 * 60); // Uses lower bound
        expect(matches[0].originalText).toBe("5-10 minutes");
    });

    it("detects ranges like '5 to 10 minutes'", () => {
        const matches = parseTimerDurations("Rest for 5 to 10 minutes");
        expect(matches).toHaveLength(1);
        expect(matches[0].durationSeconds).toBe(5 * 60);
    });

    it("detects 'more minutes' pattern", () => {
        const matches = parseTimerDurations("cook for 5 to 10 more minutes");
        expect(matches).toHaveLength(1);
        expect(matches[0].durationSeconds).toBe(5 * 60);
        expect(matches[0].originalText).toMatch(/5 to 10 more minutes/i);
    });

    it("detects multiple timers in one string", () => {
        const matches = parseTimerDurations(
            "Bake for 20 minutes then let cool for 1 hour"
        );
        expect(matches).toHaveLength(2);
        expect(matches[0].durationSeconds).toBe(20 * 60);
        expect(matches[1].durationSeconds).toBe(3600);
    });

    it("handles abbreviations", () => {
        const matches = parseTimerDurations("10 mins, 5 hrs");
        expect(matches).toHaveLength(2);
        expect(matches[0].durationSeconds).toBe(600);
        expect(matches[1].durationSeconds).toBe(5 * 3600);
    });
});
