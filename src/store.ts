import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expand } from "./synonyms.js";
import type { ChecklistItem, Requirement, Section, SearchHit } from "./types.js";

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
    /** 正規化済みの見出し・本文（sections と同じ添字） */
    private readonly norm: { head: string; body: string }[],
  ) {
    this.avgLen = norm.reduce((n, x) => n + x.body.length, 0) / Math.max(1, norm.length);
  }

  private readonly avgLen: number;

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
    const norm = sections.map((s) => ({ head: normalize(s.heading), body: normalize(s.text) }));
    return new Store(sections, checklists, guidelines, byId, grams, norm);
  }

  get(id: string): Section | undefined {
    return this.byId.get(id);
  }

  /** "節 id#番号" で遵守事項 1 項目を引く */
  getRequirement(id: string): { section: Section; requirement: Requirement } | undefined {
    const m = /^(.+)#(\d+(?:\.\d+)?)$/.exec(id);
    if (!m) return undefined;
    const section = this.byId.get(m[1]!);
    const requirement = section && requirementsOf(section).find((r) => r.no === m[2]);
    return section && requirement ? { section, requirement } : undefined;
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
   * 空白区切りの語ごとに BM25 で採点し、見出しに語を含む節を加点する。
   * 語が原文にそのまま無い節も、bigram の被覆率が高ければ弱く拾う（表記揺れ・送り仮名の違い対策）。
   *
   * 埋め込みを使わないのは、オフラインで動くことと、
   * 返す根拠が原文の一致箇所そのものであることを優先するため。
   */
  search(query: string, opts: { guideline?: string; book?: string; k?: number } = {}): SearchHit[] {
    const terms = [
      ...new Set(
        query
          .split(/[\s\u3000]+/)
          .map(normalize)
          .filter((t) => t.length > 0),
      ),
    ];
    if (terms.length === 0) return [];

    // 語ごとに言い換えを束ねる（src/synonyms.ts）。束の中のどれかに当たればその語に当たったとみなす
    const groups = terms.map(expand);

    // 候補: いずれかの語の bigram を含む節
    const candidates = new Set<number>();
    for (const g of groups) {
      for (const v of g) for (const b of bigrams(v)) for (const i of this.grams.get(b) ?? []) candidates.add(i);
    }

    const n = this.sections.length;
    const idf = groups.map((g) => {
      const df = this.norm.filter((x) => g.some((v) => x.body.includes(v) || x.head.includes(v))).length;
      return Math.log(1 + (n - df + 0.5) / (df + 0.5));
    });

    const hits: SearchHit[] = [];
    for (const i of candidates) {
      const s = this.sections[i]!;
      if (opts.guideline && s.guideline !== opts.guideline) continue;
      if (opts.book && s.book !== opts.book) continue;
      if (!s.text) continue;

      const { head, body } = this.norm[i]!;
      let score = 0;
      let firstExact: string | undefined;
      groups.forEach((g, gi) => {
        const w = idf[gi]!;
        let tf = 0;
        for (const v of g) {
          const c = countOf(body, v);
          if (c > 0) firstExact ??= v;
          tf += c;
        }
        const inHead = g.some((v) => head.includes(v));
        if (tf > 0) {
          score += (w * (tf * (BM25_K1 + 1))) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * body.length) / this.avgLen));
        }
        if (inHead) score += w * HEADING_BOOST;
        if (tf === 0 && !inHead) {
          const c = coverage(g[0]!, body);
          if (c >= 0.5) score += w * PARTIAL_WEIGHT * c * c;
        }
      });
      if (score <= 0) continue;

      hits.push({
        id: s.id,
        guideline: s.guideline,
        book: s.book,
        heading: s.heading,
        quote: excerpt(s.text, firstExact ?? terms[0]!),
        score: Number(score.toFixed(3)),
        matchedRequirements: requirementsOf(s)
          .filter((r) => groups.some((g) => g.some((v) => normalize(r.text).includes(v))))
          .map((r) => r.id),
        sourceUrl: s.sourceUrl,
        page: s.page,
      });
    }
    return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, opts.k ?? 8);
  }
}

/** 節の遵守事項に id を振る */
export function requirementsOf(s: Section): Requirement[] {
  return s.requirements.map((r) => ({ id: `${s.id}#${r.no}`, ...r }));
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** 見出しに語を含むときの加点（idf に掛ける） */
const HEADING_BOOST = 1.5;
/** 語がそのまま無いときの bigram 被覆率による弱い加点 */
const PARTIAL_WEIGHT = 0.3;

function countOf(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** term の bigram のうち text に含まれる割合 */
function coverage(term: string, text: string): number {
  const g = bigrams(term);
  if (g.length === 0) return 0;
  return g.filter((x) => text.includes(x)).length / g.length;
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
