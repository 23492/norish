# Norish Agent Guide

Use this file for lightweight repo context.

## Product

- Norish is a household-first recipe app for planning meals, sharing groceries, and cooking together.
- Main domains are recipes, groceries, meal planning, household collaboration, auth, imports, and AI-assisted parsing.

## Stack

- Node.js 22 + TypeScript
- pnpm workspaces + Turborepo
- `apps/web`: Next.js 16 App Router, React 19, HeroUI v3 (`@heroui/react`), Tailwind CSS v4, Motion, TanStack Query, custom Node server bundle via tsdown
- `apps/mobile`: Expo SDK 55, Expo Router, React Native 0.83, React 19, HeroUI Native v1 RC3 (`heroui-native`), Uniwind, Tailwind CSS v4 theme tokens, TanStack Query
- tRPC, PostgreSQL + Drizzle, Redis + BullMQ, Better Auth

## Repo Shape

- `apps/web` - web app and server bundle entry
- `apps/mobile` - Expo app
- `packages/api` - server domain logic
- `packages/trpc` - tRPC routers and API surface
- `packages/db` - schema and repositories
- `packages/shared-react` - shared hooks and contexts
- `packages/shared`, `packages/shared-server`, `packages/ui`, `packages/config`, `packages/i18n`, `packages/auth`, `packages/queue` - shared package layer
- `tooling/` - shared lint, format, TypeScript, Tailwind, GitHub, and monorepo tooling

## Working Conventions

- Keep root scripts and config minimal; workspace ownership should stay inside the owning app, package, or tooling workspace.
- Prefer existing shared abstractions before adding new ones.
- Use `@/` imports where the workspace already supports them.
- Use the existing logger patterns instead of `console.log`.
- Avoid `as any`, `@ts-ignore`, and `@ts-expect-error`.
- Route database access through repositories instead of direct router-level queries.
- Keep repo guidance concise; prefer practical conventions over long project narratives.

## Realtime scoping (REALTIME-ISO-01)

- A recipe-bearing realtime event is scoped by the **recipe's own cookbook**, never by the
  server-wide default and never by the actor's active cookbook. New emit sites must get
  their `viewPolicy` + `ctx` from `resolveRecipeRealtimeScope(recipeId, actorCtx)`
  (or `resolveHouseholdRealtimeScope(householdId, actorCtx)` for events that fire before
  the recipe row exists). Resolve once per job/procedure and reuse.
- `view: "everyone"` does **not** mean socket broadcast. `emitByPolicy` never calls
  `emitter.broadcast()`; `everyone` stops at the cookbook boundary. "Anyone may fetch this"
  is `canAccessResource`'s call, not a licence to push the resource to every open socket.
- `TypedRedisEmitter.broadcast()` stays valid for genuinely global, non-resource events
  (server-config changes, connection invalidation) — just not for anything policy-scoped.
- Events about a failed action (`failed`, `ratingFailed`) are `owner`-scoped: they concern
  only the user who attempted it.
- Every authenticated connection subscribes to the broadcast channel
  (`createPolicyAwareIterables`, `packages/trpc/src/helpers.ts`), which is exactly why the
  invariant lives on the send side. Guarded by
  `packages/shared-server/__tests__/realtime/fan-out-isolation.test.ts` and
  `packages/trpc/__tests__/realtime/router-fan-out-isolation.test.ts`.
