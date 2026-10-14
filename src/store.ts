import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChecklistItem, Section, SearchHit } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
/** dist/ からも src/ からも data/ を引けるようにする */
export const DATA_DIR = join(here, "..", "data");

export interface GuidelineInfo {
  id: string;
  title: string;
  publisher: string;
  edition: string;
  landingPage: string;
}

export class Store {
  private constructor(
    readonly sections: Section[],
    readonly checklists: ChecklistItem[],
    /** データが 1 件以上あるガイドラインだけ */
    readonly guidelines: GuidelineInfo[],
    private readonly byId: Map<string, Section>,
    private readonly grams: Map<string, Set<number>>,
  ) {}

  static async load(dataDir = DATA_DIR): Promise<Store> {
    const sections = await readJsonDir<Section>(join(dataDir, "sections"));
    const checklists = await readJsonDir<ChecklistItem>(join(dataDir, "checklists"));
    return Store.from(sections, checklists, await readGuidelines(dataDir));
  }

  static from(sections: Section[], checklists: ChecklistItem[] = [], info: GuidelineInfo[] = []): Store {
    const byId = new Map(sections.map((s) => [s.id, s]));
    const grams = new Map<string, Set<number>>();
    sections.forEach((s, i) => {
      for (const g of bigrams(normalize(s.heading + " " + s.text))) {
        let set = grams.get(g);
        if (!set) grams.set(g, (set = new Set()));
        set.add(i);
      }
    });
    const present = new Set([...sections, ...checklists].map((s) => s.guideline));
    const guidelines = info.filter((g) => present.has(g.id));
    for (const id of present) {
      if (!guidelines.some((g) => g.id === id)) {
        guidelines.push({ id, title: id, publisher: "", edition: "", landingPage: "" });
      }
    }
    return new Store(sections, checklists, guidelines, byId, grams);
  }

  get(id: string): Section | undefined {
    return this.byId.get(id);
  }

  /** 同じ親を持つ節（自分を含む） */
  siblings(s: Section): Section[] {
    const parent = s.headingPath.slice(0, -1).join("\u0000");
    return this.sections.filter(
      (x) =>
        x.guideline === s.guideline &&
        x.book === s.book &&
        x.headingPath.length === s.headingPath.length &&
        x.headingPath.slice(0, -1).join("\u0000") === parent,
    );
  }

  /** 直下の子節 */
  children(s: Section): Section[] {
    const depth = s.headingPath.length;
    return this.sections.filter(
      (x) =>
        x.guideline === s.guideline &&
        x.book === s.book &&
        x.headingPath.length === depth + 1 &&
        x.headingPath[depth - 1] === s.heading,
    );
  }

  /**
   * 日本語を素の bigram で引く。埋め込みを使わないのは、
   * オフラインで動くことと、返す根拠が原文の一致箇所そのものであることを優先するため。
   */
  search(query: string, opts: { guideline?: string; book?: string; k?: number } = {}): SearchHit[] {
    // 空白区切りの語ごとに評価する（「リモートアクセス 認証」を 1 語として扱わない）
    const terms = query
      .split(/[\s\u3000]+/)
      .map(normalize)
      .filter((t) => t.length > 0);
    if (terms.length === 0) return [];

    // 語ごとの bigram 被覆率（0〜1）＋その語が原文にそのまま含まれていれば 0.5 加点、の平均
    const score = new Map<number, number>();
    for (const term of terms) {
      const tGrams = bigrams(term);
      const cover = new Map<number, number>();
      for (const g of tGrams) {
        for (const i of this.grams.get(g) ?? []) cover.set(i, (cover.get(i) ?? 0) + 1);
      }
      for (const [i, n] of cover) score.set(i, (score.get(i) ?? 0) + n / tGrams.length);
    }

    const hits: SearchHit[] = [];
    for (const [i, cover] of score) {
      const s = this.sections[i];
      if (!s) continue;
      if (opts.guideline && s.guideline !== opts.guideline) continue;
      if (opts.book && s.book !== opts.book) continue;
      if (!s.text) continue;

      const norm = normalize(s.heading + s.text);
      const exact = terms.filter((t) => norm.includes(t));
      hits.push({
        id: s.id,
        guideline: s.guideline,
        book: s.book,
        heading: s.heading,
        quote: excerpt(s.text, exact[0] ?? terms[0]!),
        score: Number(((cover + exact.length * 0.5) / terms.length).toFixed(3)),
        sourceUrl: s.sourceUrl,
        page: s.page,
      });
    }
    return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, opts.k ?? 8);
  }
}

async function readGuidelines(dataDir: string): Promise<GuidelineInfo[]> {
  const file = join(dataDir, "sources.json");
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(await readFile(file, "utf8")) as { guidelines: GuidelineInfo[] };
  return parsed.guidelines.map(({ id, title, publisher, edition, landingPage }) => ({
    id,
    title,
    publisher,
    edition,
    landingPage,
  }));
}

async function readJsonDir<T>(dir: string): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const out: T[] = [];
  for (const f of files) {
    const parsed = JSON.parse(await readFile(join(dir, f), "utf8")) as T[];
    out.push(...parsed);
  }
  return out;
}

export function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function bigrams(s: string): string[] {
  if (s.length < 2) return s.length === 1 ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return [...new Set(out)];
}

/**
 * 正規化後の文字列で見つけた位置を、原文の位置に戻して抜粋する。
 * （NFKC と空白除去で文字数が変わるので、正規化後の index で原文を切るとずれる）
 */
export function excerpt(text: string, q: string, width = 240): string {
  let norm = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const n = normalize(ch);
    for (let k = 0; k < n.length; k++) origin.push(i);
    norm += n;
    i += ch.length;
  }
  const idx = norm.indexOf(q);
  if (idx < 0) return text.length > width ? text.slice(0, width) + "…" : text;
  const hit = origin[idx]!;
  const start = Math.max(0, hit - width / 4);
  const end = Math.min(text.length, start + width);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
