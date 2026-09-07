import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { claudeConfigDir, projectsDir } from "./config";

export type MemoryScope = "global" | "memory" | "project";

export type MemoryFile = {
  /** Identyfikator używany w API: `<scope>:<nazwa pliku>` albo `<scope>:<ścieżka projektu>`. */
  id: string;
  scope: MemoryScope;
  /** Nazwa do wyświetlenia. */
  name: string;
  path: string;
  size: number;
  modified: number;
  /** Pola z frontmattera pliku pamięci. */
  description?: string;
  type?: string;
};

/** Nazwa katalogu transkryptów dla danego cwd — myślniki zamiast separatorów. */
export function projectSlug(cwd: string): string {
  return path.resolve(cwd).replace(/[/.]/g, "-");
}

/** Katalog pamięci długoterminowej dla projektu. */
export function memoryDir(cwd: string): string {
  return path.join(projectsDir(), projectSlug(cwd), "memory");
}

function globalMemoryPath(): string {
  return path.join(claudeConfigDir(), "CLAUDE.md");
}

/** Wyciąga `description:` i `type:` z frontmattera, bez pełnego parsera YAML. */
function readFrontmatter(text: string): {
  description?: string;
  type?: string;
} {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const head = text.slice(3, end);
  const description = /^description:\s*(.+)$/m.exec(head)?.[1]?.trim();
  const type = /^\s*type:\s*(.+)$/m.exec(head)?.[1]?.trim();
  return { description, type };
}

async function statFile(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return undefined;
  }
}

/** Lista wszystkich plików pamięci widocznych dla danego katalogu roboczego. */
export async function listMemory(cwd?: string): Promise<MemoryFile[]> {
  const out: MemoryFile[] = [];

  const globalPath = globalMemoryPath();
  const globalStat = await statFile(globalPath);
  if (globalStat) {
    out.push({
      id: "global:CLAUDE.md",
      scope: "global",
      name: "CLAUDE.md (globalny)",
      path: globalPath,
      size: globalStat.size,
      modified: globalStat.mtimeMs,
      description: "Instrukcje stosowane we wszystkich projektach",
    });
  }

  if (cwd) {
    const projectClaude = path.join(path.resolve(cwd), "CLAUDE.md");
    const projectStat = await statFile(projectClaude);
    if (projectStat) {
      out.push({
        id: `project:${projectClaude}`,
        scope: "project",
        name: "CLAUDE.md (projekt)",
        path: projectClaude,
        size: projectStat.size,
        modified: projectStat.mtimeMs,
        description: `Instrukcje dla ${path.basename(path.resolve(cwd))}`,
      });
    }

    const dir = memoryDir(cwd);
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      names = [];
    }
    for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
      const full = path.join(dir, name);
      const st = await statFile(full);
      if (!st?.isFile()) continue;
      const text = await fs.readFile(full, "utf8").catch(() => "");
      const { description, type } = readFrontmatter(text);
      out.push({
        id: `memory:${name}`,
        scope: "memory",
        name,
        path: full,
        size: st.size,
        modified: st.mtimeMs,
        description,
        type: name === "MEMORY.md" ? "index" : type,
      });
    }
  }

  return out;
}

/** Zamienia identyfikator z API na bezpieczną ścieżkę na dysku. */
export function resolveMemoryPath(id: string, cwd?: string): string {
  const sep = id.indexOf(":");
  if (sep === -1) throw new Error("Nieprawidłowy identyfikator pamięci");
  const scope = id.slice(0, sep) as MemoryScope;
  const rest = id.slice(sep + 1);

  if (scope === "global") {
    if (rest !== "CLAUDE.md") throw new Error("Nieprawidłowy plik globalny");
    return globalMemoryPath();
  }

  if (scope === "memory") {
    if (!cwd) throw new Error("Pamięć projektu wymaga podania cwd");
    if (rest.includes("/") || rest.includes("..") || !rest.endsWith(".md")) {
      throw new Error("Nieprawidłowa nazwa pliku pamięci");
    }
    return path.join(memoryDir(cwd), rest);
  }

  if (scope === "project") {
    const resolved = path.resolve(rest);
    if (path.basename(resolved) !== "CLAUDE.md")
      throw new Error("Nieprawidłowy plik projektu");
    if (!resolved.startsWith(os.homedir() + path.sep)) {
      throw new Error("Plik poza katalogiem domowym");
    }
    return resolved;
  }

  throw new Error("Nieznany zakres pamięci");
}

export async function readMemory(id: string, cwd?: string): Promise<string> {
  return fs.readFile(resolveMemoryPath(id, cwd), "utf8").catch(() => "");
}

/**
 * Kopia wersji wpisu przed nadpisaniem. Pamięć bywa zmieniana także przez
 * sesje, więc bez historii łatwo stracić coś, czego nikt świadomie nie kasował.
 */
async function snapshot(target: string, content: string): Promise<void> {
  try {
    const dir = path.join(path.dirname(target), ".history");
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(
      path.join(dir, `${path.basename(target)}.${stamp}`),
      content,
      "utf8",
    );

    // Trzymamy dwadzieścia ostatnich wersji każdego wpisu.
    const all = (await fs.readdir(dir))
      .filter((f) => f.startsWith(path.basename(target)))
      .sort();
    for (const old of all.slice(0, Math.max(0, all.length - 20))) {
      await fs.rm(path.join(dir, old), { force: true });
    }
  } catch {
    /* brak historii nie może blokować zapisu */
  }
}

export async function writeMemory(
  id: string,
  cwd: string | undefined,
  content: string,
) {
  const target = resolveMemoryPath(id, cwd);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  await snapshot(target, content);
  const st = await fs.stat(target);
  return { path: target, size: st.size, modified: st.mtimeMs };
}

/**
 * Wpisy, które mówią o tym samym co inne. Nie rozstrzygamy, który ma rację:
 * pokazujemy pary do przejrzenia, bo sprzeczna pamięć jest gorsza niż jej brak.
 */
export async function findConflicts(cwd?: string): Promise<
  { a: string; b: string; shared: string[] }[]
> {
  const files = (await listMemory(cwd)).filter((m) => m.scope === 'memory')
  const words = new Map<string, Set<string>>()

  for (const f of files) {
    const text = (await fs.readFile(f.path, 'utf8').catch(() => '')).toLowerCase()
    const significant = new Set(
      text
        .replace(/[^\p{L}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 6)
    )
    words.set(f.name, significant)
  }

  const out: { a: string; b: string; shared: string[] }[] = []
  const names = [...words.keys()]
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = words.get(names[i])!
      const b = words.get(names[j])!
      const shared = [...a].filter((w) => b.has(w))
      // Duże pokrycie rzadkich słów zwykle znaczy, że wpisy dotyczą tej samej rzeczy.
      if (shared.length >= 12) {
        out.push({ a: names[i], b: names[j], shared: shared.slice(0, 8) })
      }
    }
  }
  return out.sort((x, y) => y.shared.length - x.shared.length).slice(0, 20)
}

export async function deleteMemory(id: string, cwd?: string) {
  const target = resolveMemoryPath(id, cwd);
  if (path.basename(target) === "CLAUDE.md") {
    throw new Error(
      "CLAUDE.md usuń ręcznie — to nie jest pojedyncze wspomnienie",
    );
  }
  await fs.unlink(target);
  return { ok: true };
}
