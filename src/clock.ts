import type { Clock } from "./ports";

export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
