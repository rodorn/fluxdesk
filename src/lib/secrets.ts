import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { dataDir } from "./store";

/**
 * Sejf na tokeny i hasła. Plik jest szyfrowany AES-256-GCM kluczem leżącym obok
 * (oba z prawami 0600), co chroni przed wyciekiem przez kopię zapasową albo
 * przypadkowy commit — ale nie przed kimś, kto ma dostęp do tego konta.
 */

export type SecretMeta = {
  name: string;
  /** Do czego to jest — widoczne w panelu, nigdy nie zawiera wartości. */
  description?: string;
  /** Zmienna środowiskowa, pod którą sekret trafia do sesji (gdy `exposed`). */
  envVar?: string;
  /** Czy podawać ten sekret sesjom i terminalom uruchamianym z panelu. */
  exposed: boolean;
  createdAt: number;
  updatedAt: number;
  /** Podgląd bez ujawniania: kilka ostatnich znaków. */
  hint: string;
};

type SecretRecord = SecretMeta & { value: string };
type Vault = { version: 1; secrets: SecretRecord[] };

const ALGO = "aes-256-gcm";

function vaultPath(): string {
  return path.join(dataDir(), "secrets.enc");
}

function keyPath(): string {
  return path.join(dataDir(), "secrets.key");
}

async function loadKey(): Promise<Buffer> {
  const file = keyPath();
  try {
    const raw = await fs.readFile(file, "utf8");
    return Buffer.from(raw.trim(), "base64");
  } catch {
    const key = crypto.randomBytes(32);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, key.toString("base64") + "\n", { mode: 0o600 });
    return key;
  }
}

async function readVault(): Promise<Vault> {
  try {
    const blob = await fs.readFile(vaultPath());
    const key = await loadKey();
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const data = blob.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plain) as Vault;
  } catch {
    return { version: 1, secrets: [] };
  }
}

async function writeVault(vault: Vault): Promise<void> {
  const key = await loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(vault), "utf8"),
    cipher.final(),
  ]);
  const blob = Buffer.concat([iv, cipher.getAuthTag(), data]);
  await fs.mkdir(path.dirname(vaultPath()), { recursive: true });
  await fs.writeFile(vaultPath(), blob, { mode: 0o600 });
}

function hintOf(value: string): string {
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export async function listSecrets(): Promise<SecretMeta[]> {
  const vault = await readVault();
  return vault.secrets
    .map(({ value: _value, ...meta }) => meta)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function revealSecret(name: string): Promise<string> {
  const vault = await readVault();
  const found = vault.secrets.find((s) => s.name === name);
  if (!found) throw new Error("Nie ma takiego sekretu");
  return found.value;
}

export async function saveSecret(input: {
  name: string;
  value?: string;
  description?: string;
  envVar?: string;
  exposed?: boolean;
}): Promise<SecretMeta[]> {
  const name = input.name.trim();
  if (!name) throw new Error("Podaj nazwę sekretu");

  const vault = await readVault();
  const existing = vault.secrets.find((s) => s.name === name);
  const now = Date.now();

  if (existing) {
    if (input.value !== undefined && input.value !== "") {
      existing.value = input.value;
      existing.hint = hintOf(input.value);
    }
    if (input.description !== undefined)
      existing.description = input.description;
    if (input.envVar !== undefined) existing.envVar = input.envVar;
    if (input.exposed !== undefined) existing.exposed = input.exposed;
    existing.updatedAt = now;
  } else {
    if (!input.value) throw new Error("Nowy sekret potrzebuje wartości");
    vault.secrets.push({
      name,
      value: input.value,
      description: input.description,
      envVar: input.envVar,
      exposed: input.exposed ?? false,
      createdAt: now,
      updatedAt: now,
      hint: hintOf(input.value),
    });
  }

  await writeVault(vault);
  return listSecrets();
}

export async function deleteSecret(name: string): Promise<SecretMeta[]> {
  const vault = await readVault();
  const before = vault.secrets.length;
  vault.secrets = vault.secrets.filter((s) => s.name !== name);
  if (vault.secrets.length === before)
    throw new Error("Nie ma takiego sekretu");
  await writeVault(vault);
  return listSecrets();
}

/**
 * Zmienne środowiskowe dla nowej sesji: tylko sekrety wprost oznaczone jako
 * udostępniane i mające nazwę zmiennej.
 */
export async function sessionEnv(): Promise<Record<string, string>> {
  const vault = await readVault();
  const out: Record<string, string> = {};
  for (const s of vault.secrets) {
    if (s.exposed && s.envVar) out[s.envVar] = s.value;
  }
  return out;
}
