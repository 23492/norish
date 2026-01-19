import { router } from "../../trpc";

import { calendarSubscriptions } from "./subscriptions";

export { calendarEmitter } from "./emitter";
export type { CalendarSubscriptionEvents } from "./types";

export const calendarRouter = router({
  ...calendarSubscriptions._def.procedures,
});
