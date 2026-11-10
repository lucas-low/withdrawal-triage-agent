import { truncate } from "../util";

export const NOTE_MAX_CHARS = 500;

interface Pattern {
  id: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  // English: override and bypass
  {
    id: "ignore_instructions",
    re: /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|rules?|prompts?)\b/i,
  },
  {
    id: "bypass_controls",
    re: /\b(ignore|disregard|skip|bypass|override)\b.{0,40}\b(rules?|instructions?|checks?|polic(?:y|ies)|limits?|guardrails?)\b/i,
  },
  { id: "new_instructions", re: /\bnew (instructions?|rules?|polic(?:y|ies))\s*:/i },
  { id: "policy_change", re: /\bpolic(?:y|ies)\s+(update|override|change)\b/i },
  { id: "note_to_ai", re: /\bnote to (the )?(ai|assistant|model|agent|llm)\b/i },
  { id: "test_mode", re: /\bfor (testing|debugging|test) purposes\b/i },
  // commands about this withdrawal
  { id: "approve_command", re: /\b(approve|release|allow|whitelist)\b\s+(this|the)\s+(withdrawal|transaction|transfer|request)\b/i },
  {
    id: "authority_claim",
    re: /\b(compliance|security|risk)\s+(director|officer|team|manager)\b.{0,60}\b(approved|authori[sz]ed|release)\b/i,
  },
  { id: "authorized_by", re: /\bauthori[sz]ed by\b.{0,20}\b(ceo|cto|cfo|director|admin|manager)\b/i },
  { id: "pre_approved", re: /\bpre-?(approved|cleared)\b/i },
  { id: "already_approved", re: /\balready (been )?(approved|authori[sz]ed)\b/i },
  { id: "no_escalate", re: /\bdo not (escalate|hold|flag)\b/i },
  { id: "permission_claim", re: /\byou are (allowed|permitted|authori[sz]ed) to\b/i },
  { id: "compliance_plea", re: /\bbe a good (assistant|ai|bot)\b/i },
  // persona and role tags
  { id: "persona_switch", re: /\byou are (now|actually)\b/i },
  { id: "role_tag", re: /(^|\n)\s*(system|assistant|developer)\s*[:>\]]/i },
  { id: "role_markup", re: /<\|?im_(start|end)\|?>|\[(system|inst)\]/i },
  { id: "turn_spoof", re: /\n\s*(assistant|user)\s*:/i },
  // tool and format hijacking
  { id: "tool_name", re: /\b(proposeAction|getAccount|checkAddress|getWithdrawal|getRecentActivity)\b/ },
  { id: "tool_json", re: /["'](tool|action|instructions?)["']\s*:/i },
  { id: "action_assignment", re: /\baction\s*[:=]\s*(release|approve|hold|escalate)\b/i },
  { id: "output_hijack", re: /\b(respond|reply|answer|output|return)\s+(only\s+)?(with\s*)?:?\s*["']?(release|approve)\b/i },
  { id: "answer_must_be", re: /\b(final )?answer\s+(must|should) be\b/i },
  // delimiter escape
  { id: "delimiter_escape", re: /<\/?(untrusted|system|instructions?)[^>]*>/i },
  { id: "field_escape", re: /["']untrusted["']\s*:/i },
  // other languages
  { id: "zh_ignore", re: /(忽略|无视|忽视|無視).{0,10}(之前|以前|上面|所有|先前).{0,10}(指令|指示|规则|規則)/ },
  { id: "zh_approve", re: /(批准|通过|放行|批准).{0,6}(此|这笔|該|该|這筆).{0,4}(提款|提现|提現|转账|轉帳|出金)/ },
  { id: "ms_ignore", re: /\babaikan\b.{0,30}\barahan\b/i },
  { id: "ms_approve", re: /\bluluskan\b.{0,20}\b(pengeluaran|pemindahan)\b/i },
  { id: "es_ignore", re: /\bignora\b.{0,30}\binstrucciones\b/i },
  { id: "es_approve", re: /\baprueba\b.{0,20}\b(retiro|transferencia)\b/i },
  { id: "fr_ignore", re: /\bignorez\b.{0,30}\binstructions\b/i },
  { id: "fr_approve", re: /\bapprouvez\b.{0,20}\bretrait\b/i },
  { id: "ja_ignore", re: /(以前|前)の指示.{0,10}無視/ },
  { id: "ja_approve", re: /(出金|引き出し).{0,6}承認/ },
];

const HOMOGLYPHS: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  һ: "h",
  ӏ: "l",
  Α: "A",
  Β: "B",
  Ε: "E",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Χ: "X",
  ο: "o",
  ν: "v",
  ι: "i",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠﻿]/g;

export interface InjectionResult {
  detected: boolean;
  matches: string[];
}

/** Lowercase text with width forms folded, invisible characters removed and lookalike letters mapped to Latin. */
export function normalize(text: string): string {
  const folded = text.normalize("NFKC").replace(INVISIBLE, "");
  return Array.from(folded, (c) => HOMOGLYPHS[c] ?? c).join("");
}

function decodedBase64(text: string): string[] {
  const out: string[] = [];
  for (const token of text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      // keep only text that is mostly printable, so random tokens are not scanned as prose
      if (decoded.length >= 8 && /^[\p{L}\p{N}\p{P}\p{Z}\n]+$/u.test(decoded)) out.push(decoded);
    } catch {
      /* not base64 */
    }
  }
  return out;
}

/**
 * Heuristic only. It raises a finding for review and never decides alone: the policy floor and
 * the human gate still apply. Each text is checked as written, with leetspeak undone, and with
 * any base64 token decoded. Known gaps (rot13, split words) are listed in the red-team dataset.
 */
export function detectInjection(text: string | null): InjectionResult {
  if (!text) return { detected: false, matches: [] };
  const base = normalize(text);
  const leet = Array.from(base, (c) => LEET[c] ?? c).join("");
  const variants: { label: string; text: string }[] = [
    { label: "", text: base },
    { label: "leet:", text: leet },
    ...decodedBase64(base).map((d) => ({ label: "base64:", text: normalize(d) })),
  ];
  const matches = new Set<string>();
  for (const v of variants) {
    for (const p of PATTERNS) if (p.re.test(v.text)) matches.add(`${v.label}${p.id}`);
  }
  return { detected: matches.size > 0, matches: [...matches] };
}

/** Strips control and zero-width characters and bounds the length before text reaches the model. */
export function sanitizeUntrusted(text: string | null): { text: string | null; truncated: boolean } {
  if (text === null) return { text: null, truncated: false };
  const cleaned = text.replace(INVISIBLE, "").trim();
  return { text: truncate(cleaned, NOTE_MAX_CHARS), truncated: cleaned.length > NOTE_MAX_CHARS };
}
