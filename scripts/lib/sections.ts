/**
 * 行の列 → 章節の分割。PDF に触らない純関数なので、ここだけテストがある。
 *
 * 見出し検出は PDF のレイアウト依存が強く、正解を机上で決められない。
 * だからこのモジュールは「決め打ちを減らす」方向に振ってある:
 *   - レイアウトに依存しない誤りだけを機械的に落とす（柱・ノンブル・目次行・重複 id）
 *   - 判断が要るものは落とさず report に積み、人が --report で見てから正規表現を触る
 */

/** 1 行。extract.ts が PDF から組み立てる。 */
export interface Line {
  text: string;
  /** 1 始まり */
  page: number;
  /** 行内の最大フォントサイズ（pt 相当）。0 は不明 */
  size: number;
  /** ページ内の縦位置。0 = 下端, 1 = 上端。柱・ノンブルの判定に使う */
  yRatio: number;
}

export interface RawSection {
  /** 見出し番号。例 "4.2.1" */
  num: string;
  /** 番号込みの見出し行。例 "4.2.1 リモートアクセス" */
  heading: string;
  /** 番号を除いた見出し */
  title: string;
  page: number;
  lines: string[];
}

export interface SplitOptions {
  /** 見出し行の正規表現。group 1 = 番号, group 2 = 見出し */
  heading?: RegExp;
  /** これ未満のフォントサイズの行は見出しにしない。0 で無効 */
  minHeadingSize?: number;
  /** 本文がこの文字数を超えた章節は「見出しを取りこぼした疑い」として report に載せる */
  hugeSectionChars?: number;
}

export interface SplitReport {
  pages: number;
  lines: number;
  /** 柱・ノンブルとして落とした行 */
  boilerplate: { text: string; pages: number }[];
  /** 目次行として落とした行数 */
  tocLines: number;
  /** 最初の見出しより前にあった本文行（前文・表紙）。捨てている */
  preamble: string[];
  /** 同じ番号が 2 回出た。本文が長い方を採用している */
  duplicates: { num: string; keptChars: number; droppedChars: number; pages: number[] }[];
  /** 番号の飛び。見出しの取りこぼしの兆候 */
  gaps: string[];
  /** 親の見出しがない番号。誤検出の兆候 */
  orphans: string[];
  /** 本文が空の章節 */
  emptySections: string[];
  /** 異常に長い章節 */
  hugeSections: { num: string; chars: number }[];
  /** 見出しに見えるが検出できなかった行（正規表現を直す手がかり） */
  headingLike: { text: string; page: number }[];
  /** 見出しと本文のフォントサイズ分布。しきい値を決める手がかり */
  sizes: { heading: number[]; body: number[] };
}

export interface SplitResult {
  sections: RawSection[];
  report: SplitReport;
}

/**
 * 既定の見出し行。
 *
 * 3 つの縛りで本文中の数値表現を外している。実データを見て緩める/締めるのはここ。
 *   1. 番号のあとに区切り（. ．半角/全角空白）が要る  → "4.2.1リモートアクセス" は取れない
 *   2. 番号の直後に数字が続いてはいけない            → "2025 年 3 月に" を "20" と読まない
 *   3. 見出しが助詞で始まってはいけない              → "3.11 の規定による" を拾わない
 *      （"1 はじめに" を残すため、は・と・も は除外していない）
 * 各成分は 1〜2 桁。3 桁以上の章番号はこのガイドラインには出てこない。
 */
export const DEFAULT_HEADING =
  /^(\d{1,2}(?:\.\d{1,2}){0,3})(?!\.?\d)[.．\s　]+(?![のをにへが])(\S.{0,80})$/;

/** ノンブルだけの行。"12" "- 12 -" "12 頁" */
const PAGE_NUMBER_ONLY = /^[-‐–—ー\s(（]*\d{1,4}\s*(?:頁|ページ|\/\s*\d{1,4})?[-‐–—ー\s)）]*$/;

/** 目次行。リーダ（……）＋末尾のページ番号 */
const TOC_LEADER = /[.．・…‥․・]{3,}\s*\d{1,4}\s*$/;

/** 見出しかもしれない形。検出できなかったものを report に出すためだけに使う */
const HEADING_LIKE: RegExp[] = [
  /^第\s*[0-9０-９]+\s*[章編節款]/,
  /^\d+(?:\.\d+){1,3}\S/, //  区切りなしで本文が続く形
  /^[（(][0-9０-９]{1,3}[）)]\s*\S/,
  /^[0-9０-９]{1,3}[）)]\s*\S/,
  /^[①-⑳]\s*\S/,
];

/**
 * 柱・ノンブルの判定に使うページ内の帯（上下端 10%）。
 * 実測: A4(842pt) の柱は y=780 あたり = 0.93。0.06 だと届かない。
 */
const MARGIN_BAND = 0.1;
/** 何ページに出たら柱とみなすか */
const BOILERPLATE_MIN_PAGES = 3;
const BOILERPLATE_PAGE_RATIO = 0.3;

export function splitSections(lines: Line[], opts: SplitOptions = {}): SplitResult {
  const heading = opts.heading ?? DEFAULT_HEADING;
  const minSize = opts.minHeadingSize ?? 0;
  const hugeChars = opts.hugeSectionChars ?? 6000;

  const pages = lines.reduce((max, l) => Math.max(max, l.page), 0);
  const boilerplate = findBoilerplate(lines, pages);
  const boilerplateKeys = new Set(boilerplate.map((b) => b.key));

  const report: SplitReport = {
    pages,
    lines: lines.length,
    boilerplate: boilerplate.map((b) => ({ text: b.text, pages: b.pages })),
    tocLines: 0,
    preamble: [],
    duplicates: [],
    gaps: [],
    orphans: [],
    emptySections: [],
    hugeSections: [],
    headingLike: [],
    sizes: { heading: [], body: [] },
  };

  const sections: RawSection[] = [];
  let current: RawSection | null = null;

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;

    if (PAGE_NUMBER_ONLY.test(text)) continue;
    if (inMargin(line) && boilerplateKeys.has(boilerplateKey(text))) continue;
    if (TOC_LEADER.test(text)) {
      report.tocLines++;
      continue;
    }

    // --heading で外から渡された正規表現でも落ちないように、group の有無は見る
    const m = heading.exec(text);
    const num = m?.[1];
    const title = (m?.[2] ?? "").trim();
    if (num && (minSize === 0 || line.size === 0 || line.size >= minSize)) {
      current = {
        num,
        heading: title ? `${num} ${title}` : num,
        title,
        page: line.page,
        lines: [],
      };
      sections.push(current);
      if (line.size) report.sizes.heading.push(line.size);
      continue;
    }

    if (line.size) report.sizes.body.push(line.size);
    // num があるのにここに来たのは minHeadingSize で落ちた行。見出し候補として残す。
    if (num || HEADING_LIKE.some((re) => re.test(text))) {
      report.headingLike.push({ text, page: line.page });
    }

    if (!current) {
      report.preamble.push(text);
      continue;
    }
    current.lines.push(text);
  }

  const deduped = dedupe(sections, report);
  audit(deduped, report, hugeChars);
  return { sections: deduped, report };
}

/**
 * 同じ番号が 2 回以上出たら本文が長い方を採る。
 * 目次を取りこぼしたとき、id が本文と衝突して静かに上書きされるのを防ぐ。
 */
function dedupe(sections: RawSection[], report: SplitReport): RawSection[] {
  const byNum = new Map<string, RawSection[]>();
  for (const s of sections) {
    const list = byNum.get(s.num);
    if (list) list.push(s);
    else byNum.set(s.num, [s]);
  }

  const winners = new Set<RawSection>();
  for (const [num, list] of byNum) {
    if (list.length === 1) {
      winners.add(list[0]!);
      continue;
    }
    const sorted = [...list].sort((a, b) => chars(b) - chars(a));
    const kept = sorted[0]!;
    winners.add(kept);
    report.duplicates.push({
      num,
      keptChars: chars(kept),
      droppedChars: sorted.slice(1).reduce((n, s) => n + chars(s), 0),
      pages: list.map((s) => s.page),
    });
  }
  return sections.filter((s) => winners.has(s));
}

function audit(sections: RawSection[], report: SplitReport, hugeChars: number): void {
  const nums = new Set(sections.map((s) => s.num));
  const seen = new Map<string, number>(); // 親 → 直前の末尾番号

  for (const s of sections) {
    const parts = s.num.split(".").map(Number);
    const parent = parts.slice(0, -1).join(".");
    const last = parts[parts.length - 1]!;

    if (parent && !nums.has(parent)) report.orphans.push(`${s.num} (親 ${parent} がない)`);

    const prev = seen.get(parent);
    if (prev === undefined) {
      if (last !== 1) report.gaps.push(`${s.num} が ${parent || "先頭"} の 1 番目`);
    } else if (last !== prev + 1) {
      report.gaps.push(`${parent ? parent + "." : ""}${prev} → ${s.num}`);
    }
    seen.set(parent, last);

    const n = chars(s);
    if (n === 0) report.emptySections.push(`${s.num} ${s.title}`);
    else if (n > hugeChars) report.hugeSections.push({ num: s.num, chars: n });
  }
}

function chars(s: RawSection): number {
  return s.lines.join("\n").trim().length;
}

function inMargin(line: Line): boolean {
  return line.yRatio >= 1 - MARGIN_BAND || line.yRatio <= MARGIN_BAND;
}

/** ページごとに変わる数字を落とした形。柱に紛れるノンブルを同一視する */
function boilerplateKey(text: string): string {
  return text.replace(/[0-9０-９]+/g, "#").replace(/\s+/g, "");
}

/**
 * 上下端に、多くのページで繰り返し出る行 = 柱（ランニングヘッダ）。
 * 位置と反復の両方を見る。片方だけだと本文を巻き込む。
 */
function findBoilerplate(
  lines: Line[],
  pages: number,
): { key: string; text: string; pages: number }[] {
  const seen = new Map<string, { text: string; pages: Set<number> }>();
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || !inMargin(line)) continue;
    if (PAGE_NUMBER_ONLY.test(text)) continue; // ノンブルは位置に関係なく落とす
    const key = boilerplateKey(text);
    if (key.replace(/[#\s]/g, "").length < 2) continue; // ノンブルだけの行は別で落とす
    const hit = seen.get(key);
    if (hit) hit.pages.add(line.page);
    else seen.set(key, { text, pages: new Set([line.page]) });
  }

  const threshold = Math.max(BOILERPLATE_MIN_PAGES, pages * BOILERPLATE_PAGE_RATIO);
  return [...seen.entries()]
    .filter(([, v]) => v.pages.size >= threshold)
    .map(([key, v]) => ({ key, text: v.text, pages: v.pages.size }))
    .sort((a, b) => b.pages - a.pages);
}

/** report を人が読む形にする。--report と、実行時のサマリの両方で使う。 */
export function formatReport(label: string, report: SplitReport, sections: RawSection[]): string {
  const out: string[] = [];
  const p = (s: string) => out.push(s);

  p(`--- ${label}: ${report.pages}p / ${report.lines} lines -> ${sections.length} sections`);
  if (report.boilerplate.length) {
    p(`  柱として落とした行:`);
    for (const b of report.boilerplate.slice(0, 6)) p(`    ${b.pages}p  "${b.text}"`);
  }
  if (report.tocLines) p(`  目次行として落とした: ${report.tocLines} 行`);
  if (report.preamble.length) p(`  最初の見出しより前（捨てた）: ${report.preamble.length} 行`);

  const s = report.sizes;
  if (s.heading.length && s.body.length) {
    p(`  フォントサイズ  見出し: ${stat(s.heading)}   本文: ${stat(s.body)}`);
  }

  warn(p, "重複した番号", report.duplicates.map((d) =>
    `${d.num}  p${d.pages.join(",")}  採用 ${d.keptChars}字 / 捨て ${d.droppedChars}字`));
  warn(p, "番号の飛び", report.gaps);
  warn(p, "親のない見出し", report.orphans);
  warn(p, "本文が空", report.emptySections);
  warn(p, "異常に長い（見出しの取りこぼし疑い）",
    report.hugeSections.map((h) => `${h.num}  ${h.chars}字`));
  warn(p, "見出しに見えるが取れなかった行",
    dedupeStrings(report.headingLike.map((h) => `p${h.page}  ${h.text}`)));

  return out.join("\n");
}

function warn(p: (s: string) => void, label: string, items: string[], limit = 12): void {
  if (items.length === 0) return;
  p(`  ! ${label}: ${items.length}`);
  for (const i of items.slice(0, limit)) p(`      ${i}`);
  if (items.length > limit) p(`      … 他 ${items.length - limit}`);
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function stat(xs: number[]): string {
  const sorted = [...xs].sort((a, b) => a - b);
  const q = (r: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * r))]!;
  return `min ${sorted[0]!.toFixed(1)} / p50 ${q(0.5).toFixed(1)} / p95 ${q(0.95).toFixed(1)} / max ${sorted[sorted.length - 1]!.toFixed(1)}`;
}
