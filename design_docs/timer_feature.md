# Recipe Timer Feature: Architectural Design

## 1. Overview
The goal is to implement a "Smart Timer" system that automatically detects time durations in recipe instructions (e.g., "20 minutes", "30 seconds") and allows the user to start multiple concurrent timers with a single click.

## 2. Core Decisions
Based on the analysis of 31 recipes:
*   **Multi-Timer System**: 93.5% of recipes need multiple timers.
*   **Client-Side "Smart Parsing"**: We will parse the text dynamically on the client rather than storing fixed timer data in the database. This allows purely retroactive support for all existing recipes without database migrations.

## 3. Technical Architecture

### A. The Parsing Engine (SmartText Logic)
We will create a utility that processes the raw instruction text at render time.
*   **Output**: A React Node array where plain text is interspersed with `<TimerChip>` components.
*   **Logic**:
    1.  Receive raw text string.
    2.  Run Regex to identify time patterns.
    3.  Extract duration (value + unit) and convert to milliseconds.
    4.  Replace the matched text with an interactive component.

### B. State Management (The Brain)
We will use **Zustand** for a global `useTimerStore`. This is critical because timers must persist even if the user navigates away from the recipe page (e.g., to check the shopping list).

**Store Structure:**
```typescript
type Timer = {
  id: string;          // Unique ID
  recipeId: string;    // To associate back to the recipe
  label: string;       // e.g., "Step 4: Roast Chicken"
  durationMs: number;  // Total duration
  startedAt: number;   // Timestamp
  status: 'running' | 'paused' | 'completed';
}
```

**Persistence:**
*   Use `persist` middleware (localStorage) so running timers survive page reloads or browser crashes.

### C. UX / UI Components

#### 1. Inline Timer Chips
Inside the recipe instructions, specific text segments like "20 minutes" will appear as clickable chips.
*   **State: Idle**: Looks like a button/link. Text: "20 min".
*   **State: Running**: Shows a countdown. Color changes to indicate activity.
*   **State: Completed**: Flashing/Alert state.

#### 2. Floating Timer/Dynamic Island
Since a recipe can be long and the user might scroll away from Step 1, we need a global view.
*   **Position**: Fixed at bottom-right or "Dynamic Island" style at top.
*   **Behavior**:
    *   Shows the *soonest* ending timer.
    *   Expandable to show list of all active timers.
    *   Audio alert when a timer finishes.

## 4. Implementation Stages

### Phase 1: Foundation
1.  Setup `useTimerStore` with persistence.
2.  Implement audio "beep" logic.

### Phase 2: Smart Parsing
1.  Implement `extractTimeSegments` utility.
2.  Create `InstructionText` component that uses the utility to render Chips.

### Phase 3: Global UI
1.  Build the `FloatingTimerDock` to manage running timers from anywhere in the app.
