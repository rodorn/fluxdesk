import fs from "node:fs/promises";
import path from "node:path";

import { claudeConfigDir } from "./config";
import { mutateStore, readStore } from "./store";

/**
 * Reguły zgód wspólne dla wszystkich sesji. Zgoda „zawsze" udzielona w jednej
 * sesji ginęła razem z nią; tutaj żyje dalej. Osobno trzymamy listę zakazaną,
 * która blokuje polecenia niezależnie od trybu uprawnień.
 */

export type Rules = {
  /** Reguły dopuszczone bez pytania, w postaci `Bash(git)` albo `Read`. */
  allow: string[];
  /** Wzorce, których nigdy nie dopuszczamy, nawet przy pominięciu pytań. */
  deny: string[];
};

/** Polecenia, które potrafią zniszczyć pracę albo system, zanim zdążysz zareagować. */
export const DEFAULT_DENY = [
  "rm -rf /",
  "rm -rf ~",
  "mkfs",
  "dd if=",
  "git push --force",
  "git reset --hard",
  ":(){:|:&};:",
];

type StoreWithRules = Awaited<ReturnType<typeof readStore>> & { rules?: Rules };

export async function readRules(): Promise<Rules> {
  const store = (await readStore()) as StoreWithRules;
  return {
    allow: store.rules?.allow ?? [],
    deny: store.rules?.deny ?? DEFAULT_DENY,
  };
}

export async function writeRules(patch: Partial<Rules>): Promise<Rules> {
  return mutateStore((data) => {
    const current = (data as StoreWithRules).rules ?? {
      allow: [],
      deny: DEFAULT_DENY,
    };
    const next: Rules = {
      allow: patch.allow ?? current.allow,
      deny: patch.deny ?? current.deny,
    };
    (data as StoreWithRules).rules = next;
    return next;
  });
}

export async function addAllowRule(rule: string): Promise<Rules> {
  const rules = await readRules();
  if (rules.allow.includes(rule)) return rules;
  return writeRules({ allow: [...rules.allow, rule] });
}

export async function removeAllowRule(rule: string): Promise<Rules> {
  const rules = await readRules();
  return writeRules({ allow: rules.allow.filter((r) => r !== rule) });
}

/**
 * Dopasowanie reguły do klucza. Obsługujemy gwiazdkę, bo tak zapisane są
 * reguły w ustawieniach Claude Code: `Bash(*)`, `Edit(~/Projekty/**)`.
 */
export function matchesRule(rule: string, key: string, raw?: string): boolean {
  if (rule === key) return true
  if (!rule.includes("*")) return false

  const pattern = new RegExp(
    "^" +
      rule
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  )
  return pattern.test(key) || (raw !== undefined && pattern.test(raw))
}

/** Czy któraś reguła dopuszcza tę prośbę bez pytania. */
export function isAllowed(
  rules: Rules,
  key: string,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  const raw =
    typeof input.command === "string"
      ? `${toolName}(${input.command})`
      : typeof input.file_path === "string"
        ? `${toolName}(${input.file_path})`
        : toolName
  return rules.allow.some((rule) => matchesRule(rule, key, raw))
}

/**
 * Czy prośba trafia na listę zakazaną. Sprawdzamy surową komendę, bo klucz
 * reguły jest zawężony do pierwszego słowa i przepuściłby `rm -rf /`.
 */
export function isDenied(
  rules: Rules,
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  const haystack = [
    toolName,
    typeof input.command === "string" ? input.command : "",
    typeof input.file_path === "string" ? input.file_path : "",
  ]
    .join(" ")
    .toLowerCase();

  return rules.deny.find((pattern) => haystack.includes(pattern.toLowerCase()));
}

/** Import allowlisty z ustawień Claude Code, żeby nie wpisywać jej drugi raz. */
export async function importFromSettings(): Promise<{ imported: string[] }> {
  const file = path.join(claudeConfigDir(), "settings.json");
  let allow: string[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as {
      permissions?: { allow?: string[] };
    };
    allow = raw.permissions?.allow ?? [];
  } catch {
    return { imported: [] };
  }

  const rules = await readRules();
  const fresh = allow.filter((r) => !rules.allow.includes(r));
  if (fresh.length) await writeRules({ allow: [...rules.allow, ...fresh] });
  return { imported: fresh };
}
