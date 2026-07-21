/**
 * Queue Helpers
 *
 * Shared utilities for BullMQ queue operations.
 */

import type { Queue } from "bullmq";

import type { PermissionLevel } from "@norish/config/zod/server-config";
import { OperationTimeoutError } from "@norish/shared/lib/error-extensions";
import { normalizeUrl } from "@norish/shared/lib/helpers";

export function sanitizeUrlForJobId(url: string): string {
  const normalized = normalizeUrl(url);

  return normalized.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]/g, "_");
}

/**
 * Generate a unique job ID for an import, scoped per-cookbook.
 * Note: BullMQ doesn't allow colons in job IDs, so we use underscores as delimiters.
 *
 * - "household": `import_${householdKey}_${sanitizedUrl}` - unique per cookbook
 * - "owner": `import_${userId}_${sanitizedUrl}` - unique per user
 *
 * IMPORT-DEDUP-ISO-01: there is deliberately NO "everyone" scope. It produced a GLOBAL
 * job id (`import_${sanitizedUrl}`), so two cookbooks importing the same URL collided on
 * one BullMQ job and the second was rejected as a duplicate — one household silently
 * blocking another's import. Job identity must be at least as narrow as dedup scope.
 */
export function generateJobId(
  url: string,
  userId: string,
  householdKey: string,
  viewPolicy: Exclude<PermissionLevel, "everyone">
): string {
  const sanitized = sanitizeUrlForJobId(url);

  switch (viewPolicy) {
    case "household":
      return `import_${householdKey}_${sanitized}`;
    case "owner":
      return `import_${userId}_${sanitized}`;
    default:
      // Unreachable given the narrowed type; fail CLOSED (cookbook-scoped) rather than
      // falling back to a global id if a future caller widens the type.
      return `import_${householdKey}_${sanitized}`;
  }
}

/**
 * Check if a job with the given ID is currently in the queue
 * (waiting, active, or delayed - not completed or failed)
 */
export async function isJobInQueue<T>(queue: Queue<T>, jobId: string): Promise<boolean> {
  const job = await queue.getJob(jobId);

  if (!job) return false;

  const state = await job.getState();

  return state === "waiting" || state === "active" || state === "delayed";
}

export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new OperationTimeoutError(operationName, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
