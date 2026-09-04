import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChecklistItem, Section, SearchHit } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
/** dist/ からも src/ からも data/ を引けるようにする */
export const DATA_DIR = join(here, "..", "data");

export class Store {
  private constructor(
    readonly sections: Section[],
    readonly checklists: ChecklistItem[],
    private readonly byId: Map<string, Section>,
    private readonly grams: Map<string, Set<number>>,
  ) {}

  static async load(): Promise<Store> {
    const sections = await readJsonDir<Section>(join(DATA_DIR, "sections"));
    const checklists = await readJsonDir<ChecklistItem>(join(DATA_DIR, "checklists"));

    const byId = new Map(sections.map((s) => [s.id, s]));
    const grams = new Map<string, Set<number>>();
    sections.forEach((s, i) => {
      for (const g of bigrams(normalize(s.heading + " " + s.text))) {
        let set = grams.get(g);
        if (!set) grams.set(g, (set = new Set()));
        set.add(i);
      }
    });
    return new Store(sections, checklists, byId, grams);
  }

  get(id: string): Section | undefined {
    return this.byId.get(id);
  }

  /**
   * 日本語を素の bigram で引く。埋め込みを使わないのは、
   * オフラインで動くことと、返す根拠が原文の一致箇所そのものであることを優先するため。
   */
  search(query: string, opts: { guideline?: string; book?: string; k?: number } = {}): SearchHit[] {
    const q = normalize(query);
    const qGrams = bigrams(q);
    if (qGrams.length === 0) return [];

    const score = new Map<number, number>();
    for (const g of qGrams) {
      const set = this.grams.get(g);
      if (!set) continue;
      for (const i of set) score.set(i, (score.get(i) ?? 0) + 1);
    }

    const hits: SearchHit[] = [];
    for (const [i, raw] of score) {
      const s = this.sections[i];
      if (!s) continue;
      if (opts.guideline && s.guideline !== opts.guideline) continue;
      if (opts.book && s.book !== opts.book) continue;

      const normText = normalize(s.text);
      const exact = normText.includes(q) ? 1.5 : 1;
      hits.push({
        id: s.id,
        guideline: s.guideline,
        book: s.book,
        heading: s.heading,
        quote: excerpt(s.text, q),
        score: Number(((raw / qGrams.length) * exact).toFixed(3)),
        sourceUrl: s.sourceUrl,
        page: s.page,
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.k ?? 8);
  }
}

async function readJsonDir<T>(dir: string): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const out: T[] = [];
  for (const f of files) {
    const parsed = JSON.parse(await readFile(join(dir, f), "utf8")) as T[];
    out.push(...parsed);
  }
  return out;
}

function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function bigrams(s: string): string[] {
  if (s.length < 2) return s.length === 1 ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return [...new Set(out)];
}

function excerpt(text: string, q: string, width = 240): string {
  const idx = normalize(text).indexOf(q);
  if (idx < 0) return text.slice(0, width);
  const start = Math.max(0, idx - width / 4);
  return (start > 0 ? "…" : "") + text.slice(start, start + width) + "…";
}
