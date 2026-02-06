"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

import { parseTimerDurations } from "@/lib/timer-parser";
import { useTimersEnabledQuery, useTimerKeywordsQuery } from "@/hooks/config";

import { TimerChip } from "@/components/recipe/timer-chip";

interface SmartInstructionProps {
  text: string;
  recipeId: string;
  recipeName?: string;
  stepIndex: number;
}

export function SmartInstruction({ text, recipeId, recipeName, stepIndex }: SmartInstructionProps) {
  const { timersEnabled } = useTimersEnabledQuery();
  const { timerKeywords } = useTimerKeywordsQuery();

  const segments = useMemo(() => {
    if (timersEnabled === false || !timerKeywords.enabled) {
      return [{ type: "text" as const, content: text }];
    }

    const parts: Array<{ type: "text" | "timer"; content: string; timerData?: any }> = [];
    let lastIndex = 0;

    const matches = parseTimerDurations(text, timerKeywords.keywords);

    matches.forEach((match, occurrenceIndex) => {
      if (match.startIndex > lastIndex) {
        parts.push({ type: "text", content: text.slice(lastIndex, match.startIndex) });
      }

      const durationMs = match.durationSeconds * 1000;
      const timerId = `${recipeId}-s${stepIndex}-${occurrenceIndex}`;
      const label = `Step ${stepIndex + 1} Timer`;

      parts.push({
        type: "timer",
        content: match.originalText,
        timerData: {
          timerId,
          recipeId,
          recipeName,
          label,
          durationMs,
          originalText: match.originalText,
        },
      });

      lastIndex = match.endIndex;
    });

    if (lastIndex < text.length) {
      parts.push({ type: "text", content: text.slice(lastIndex) });
    }

    return parts;
  }, [text, recipeId, recipeName, stepIndex, timersEnabled, timerKeywords]);

  const processedText = useMemo(() => {
    return preprocessMarkdown(text);
  }, [text]);

  return (
    <span>
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <span className="text-foreground mt-2 mb-1 block text-lg font-semibold">
              {children}
            </span>
          ),
          h2: ({ children }) => (
            <span className="text-foreground mt-2 mb-1 block text-lg font-semibold">
              {children}
            </span>
          ),
          a: ({ href, children }) => {
            if (href?.startsWith("/recipes/")) {
              return (
                <Link
                  className="text-foreground decoration-default-400 hover:decoration-default-600 font-medium underline underline-offset-2 transition-colors"
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                >
                  {children}
                </Link>
              );
            }

            return (
              <a
                className="text-foreground decoration-default-400 hover:decoration-default-600 underline underline-offset-2 transition-colors"
                href={href}
                rel="noopener noreferrer"
                target="_blank"
                onClick={(e) => e.stopPropagation()}
              >
                {children}
              </a>
            );
          },
          p: ({ children }) => {
            if (timersEnabled && timerKeywords.enabled) {
              return <span>{renderWithTimers(children, segments)}</span>;
            }
            return <span>{children}</span>;
          },
        }}
      >
        {processedText}
      </ReactMarkdown>
    </span>
  );
}

function preprocessMarkdown(text: string): string {
  if (!text) return "";

  let processed = text
    .split("\n")
    .map((line) => {
      if (line.startsWith("#") && !line.startsWith("##")) {
        const content = line.slice(1).trim();
        return `## ${content}`;
      }
      return line;
    })
    .join("\n");

  processed = processed.replace(
    /\[([^\]]+)\]\(id:([a-zA-Z0-9-]+)\)/g,
    (_, recipeName, recipeId) => {
      return `[${recipeName}](/recipes/${recipeId})`;
    }
  );

  return processed;
}

function renderWithTimers(children: any, segments: any[]): React.ReactNode {
  if (!children || typeof children === "string") {
    return insertTimers(children || "", segments);
  }

  if (Array.isArray(children)) {
    return children.map((child, idx) => {
      if (typeof child === "string") {
        return (
          <React.Fragment key={`frag-${idx}-${child.substring(0, 10)}`}>
            {insertTimers(child, segments)}
          </React.Fragment>
        );
      }
      return <React.Fragment key={`child-${idx}`}>{child}</React.Fragment>;
    });
  }

  return children;
}

function insertTimers(text: string, segments: any[]): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let processedText = text;

  segments.forEach((segment) => {
    if (segment.type === "timer" && processedText.includes(segment.content)) {
      const parts = processedText.split(segment.content);
      if (parts[0]) result.push(parts[0]);

      result.push(
        <TimerChip
          key={`timer-${segment.timerData.timerId}`}
          id={segment.timerData.timerId}
          recipeId={segment.timerData.recipeId}
          recipeName={segment.timerData.recipeName}
          initialLabel={segment.timerData.label}
          durationMs={segment.timerData.durationMs}
          originalText={segment.timerData.originalText}
        />
      );

      processedText = parts.slice(1).join(segment.content);
    }
  });

  if (processedText) result.push(processedText);

  return result.length > 0 ? result : [text];
}
