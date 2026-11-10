import { truncate } from "../util";

export const NOTE_MAX_CHARS = 500;

const PATTERNS: { id: string; re: RegExp }[] = [
  {
    id: "ignore_instructions",
    re: /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|rules?|prompts?)\b/i,
  },
  { id: "role_tag", re: /(^|\n)\s*(system|assistant|developer)\s*[:>\]]/i },
  { id: "approve_command", re: /\b(approve|release|allow|whitelist)\b\s+(this|the)\s+(withdrawal|transaction|transfer|request)\b/i },
  { id: "persona_switch", re: /\byou are (now|actually)\b/i },
  { id: "tool_name", re: /\b(proposeAction|getAccount|checkAddress|getWithdrawal)\b/ },
  { id: "delimiter_escape", re: /<\/?(untrusted|system|instructions?)[^>]*>/i },
];

export interface InjectionResult {
  detected: boolean;
  matches: string[];
}

/** Heuristic only. It raises a finding for review and never decides anything alone. */
export function detectInjection(text: string | null): InjectionResult {
  if (!text) return { detected: false, matches: [] };
  const matches = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  return { detected: matches.length > 0, matches };
}

/** Strips control and zero-width characters and bounds the length before text reaches the model. */
export function sanitizeUntrusted(text: string | null): { text: string | null; truncated: boolean } {
  if (text === null) return { text: null, truncated: false };
  const cleaned = text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠﻿]/g, "")
    .trim();
  return { text: truncate(cleaned, NOTE_MAX_CHARS), truncated: cleaned.length > NOTE_MAX_CHARS };
}
