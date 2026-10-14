/**
 * PDF から取り出した「行」を、目次（TOC）を正として章節に組み立てる純粋関数群。
 * pdfjs には依存しない（テストで行を直接与えられるようにするため）。
 *
 * 方針:
 * - 見出しは本文から推測しない。目次に並んだ見出しを、本文中で**順番どおりに**照合する。
 *   本文の行頭が数字で始まるだけの行（「15 年法律…」等）を見出しと誤認しないため。
 * - 総務省・経産省 GL は章番号と一部の 3 階層目の番号がテキスト層に無い（描画のみ）。
 *   目次の並びから番号を補い、補ったことを numberInferred で残す。
 */

export interface Line {
  page: number;
  /** ベースライン y（PDF 座標。上ほど大きい） */
  y: number;
  /** 行頭の x */
  x: number;
  /** 行内の最大フォント高 */
  h: number;
  /** NFKC 前の原文 */
  text: string;
}

export interface TocEntry {
  /** 見出し番号（"1" / "1.2" / "1.2.3"）。番号の無い前付・付録は "0" / "appendix-N" */
  num: string;
  level: number;
  /** 番号を除いた見出し文字列（原文） */
  title: string;
  numberInferred: boolean;
}

export interface BuiltSection {
  num: string;
  path: string[];
  heading: string;
  title: string;
  numberInferred: boolean;
  page: number;
  text: string;
  requirements: string[];
}

export interface BuildReport {
  tocEntries: number;
  matched: number;
  /** 目次にあるのに本文で見つからなかった見出し */
  unmatched: string[];
}

/** 目次のリーダー＋ページ番号。「……… 3」「....-12-」「..-12-」 */
const LEADER = /(?:[.・…‥･]{4,}\s*-?\s*\d+\s*-?|[.・…‥･]{2,}\s*-\s*\d+\s*-)\s*$/;
const NUM_PREFIX = /^(\d+(?:\.\d+)*)\.?\s*/;

export function nfkc(s: string): string {
  return s.normalize("NFKC");
}

/** 照合用。空白と記号の揺れを潰す。 */
export function compact(s: string): string {
  return nfkc(s)
    .replace(/\s+/g, "")
    .replace(/[・･]/g, "")
    .toLowerCase();
}

/**
 * 行頭の見出し番号を取り出す。「１．1．１」「３．２．」「1.1.」などの揺れを吸収する。
 * rest は原文のまま返す（番号部分の文字は NFKC で 1 文字→1 文字なので、長さで切ってよい）。
 */
export function splitNumber(raw: string): { num: string | null; rest: string } {
  const r = raw.trim();
  const s = nfkc(r);
  const m = NUM_PREFIX.exec(s);
  if (!m) return { num: null, rest: r };
  const rest = s.slice(m[0].length);
  // 単独の数字は末尾ドット必須（「1 社で提供」「15 年法律」を番号と読まない）
  const single = !m[1]!.includes(".");
  if (single && !/^\d+\./.test(s)) return { num: null, rest: r };
  // 番号の直後に数字が続くものは番号ではない（「2023 年」等）
  if (/^\d/.test(rest) || rest.length === 0) return { num: null, rest: r };
  return { num: m[1]!, rest: r.slice(m[0].length) };
}

/** 本文の代表フォント高（最頻値） */
export function bodyHeight(lines: Line[]): number {
  const freq = new Map<number, number>();
  for (const l of lines) freq.set(Math.round(l.h), (freq.get(Math.round(l.h)) ?? 0) + 1);
  return [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
}

/** ページ番号（「- 3 -」「iv」「12」）。ページ下端の行だけを対象にする。 */
export function isPageNumber(l: Line, pageBottom: number): boolean {
  if (l.y > pageBottom + 30) return false;
  return /^[-\s]*(?:\d+|[ivxlc]+|[ⅰ-ⅻ]+)[-\s]*$/i.test(nfkc(l.text).trim());
}

/**
 * 目次ページを判定する。リーダー（……… 3）を伴う行が 3 行以上あるページ。
 */
export function tocPages(lines: Line[]): Set<number> {
  const count = new Map<number, number>();
  for (const l of lines) if (LEADER.test(nfkc(l.text))) count.set(l.page, (count.get(l.page) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n >= 3).map(([p]) => p));
}

/**
 * 目次ページの行から見出し列を作る。
 * リーダーの無い行は、次のリーダー付き行の前半（折り返し）として結合する。
 */
export function parseToc(lines: Line[], pages: Set<number>): TocEntry[] {
  const raw: { text: string; x: number; h: number }[] = [];
  let pending: { text: string; x: number; h: number } | null = null;
  for (const l of lines) {
    if (!pages.has(l.page)) continue;
    const t = nfkc(l.text).trim();
    if (t === "目次" || /^[-\s]*(?:\d+|[ivxlc]+)[-\s]*$/i.test(t)) continue;
    if (LEADER.test(t)) {
      const text = ((pending?.text ?? "") + t.replace(LEADER, "")).trim();
      raw.push({ text, x: pending?.x ?? l.x, h: pending?.h ?? l.h });
      pending = null;
    } else {
      if (pending) pending.text += t;
      else pending = { text: t, x: l.x, h: l.h };
    }
  }
  return numberEntries(raw);
}

/**
 * 目次の各行に番号と階層を与える。
 * - 番号のある行: 番号の段数が階層
 * - 番号の無い行で、目次中の最大フォント: 第 1 階層。
 *   字下げされていれば番号が描画のみの章（総務省 GL）→ 直前の章 +1。
 *   字下げされていなければ前付・付録（【はじめに】・用語集 等）。
 * - それ以外の番号の無い行: 直近の「番号の分かっている」見出しの子
 */
export function numberEntries(raw: { text: string; x: number; h: number }[]): TocEntry[] {
  const parsed = raw.map((r) => ({ ...r, ...splitNumber(r.text) }));
  const maxH = Math.max(...parsed.map((p) => Math.round(p.h)));
  const topX = Math.min(...parsed.filter((p) => Math.round(p.h) === maxH).map((p) => p.x));

  const out: TocEntry[] = [];
  let chapter = 0;
  let sawChapter = false;
  let appendix = 0;
  let anchor: { num: string; level: number } | null = null;
  const childCount = new Map<string, number>();

  for (const p of parsed) {
    if (p.num) {
      const level = p.num.split(".").length;
      if (level === 1) {
        chapter = Number(p.num);
        sawChapter = true;
      }
      out.push({ num: p.num, level, title: p.rest, numberInferred: false });
      anchor = { num: p.num, level };
      continue;
    }

    if (Math.round(p.h) === maxH) {
      if (p.x > topX + 5) {
        chapter += 1;
        sawChapter = true;
        const num = String(chapter);
        out.push({ num, level: 1, title: p.rest, numberInferred: true });
        anchor = { num, level: 1 };
      } else {
        const num = sawChapter ? `appendix-${++appendix}` : "0";
        out.push({ num, level: 1, title: p.rest, numberInferred: false });
        anchor = null;
      }
      continue;
    }

    if (!anchor) continue;
    const n = (childCount.get(anchor.num) ?? 0) + 1;
    childCount.set(anchor.num, n);
    out.push({ num: `${anchor.num}.${n}`, level: anchor.level + 1, title: p.rest, numberInferred: true });
  }
  return out;
}

/**
 * 本文の行を目次の見出し列と順に照合し、章節を組み立てる。
 * 見出しが見つからない場合に全体が止まらないよう、先の数件まで先読みする。
 */
export function buildSections(
  lines: Line[],
  toc: TocEntry[],
  opts: { lookahead?: number } = {},
): { sections: BuiltSection[]; report: BuildReport } {
  const lookahead = opts.lookahead ?? 4;
  const skip = tocPages(lines);
  const firstBody = Math.max(0, ...skip) + 1;
  const bodyH = bodyHeight(lines.filter((l) => l.page >= firstBody));
  const bottom = new Map<number, number>();
  for (const l of lines) bottom.set(l.page, Math.min(bottom.get(l.page) ?? Infinity, l.y));

  const body = lines.filter(
    (l) =>
      l.page >= firstBody &&
      // 脚注番号の上付き・図中の小さい文字は落とす
      l.h >= bodyH * 0.75 &&
      !isPageNumber(l, bottom.get(l.page)!),
  );

  const sections: BuiltSection[] = [];
  const unmatched: string[] = [];
  let next = 0;
  let cur: { entry: TocEntry; title: string; page: number; lines: Line[] } | null = null;
  const stack: string[] = [];

  const flush = () => {
    if (!cur) return;
    const text = toParagraphs(cur.lines);
    sections.push({
      num: cur.entry.num,
      path: [...stack],
      heading: headingOf(cur.entry.num, cur.title),
      title: cur.title,
      numberInferred: cur.entry.numberInferred,
      page: cur.page,
      text,
      requirements: splitRequirements(text),
    });
  };

  for (let i = 0; i < body.length; i++) {
    const hit = next < toc.length ? matchHeading(body, i, toc, next, lookahead, bodyH) : null;
    if (hit) {
      flush();
      for (let k = next; k < hit.index; k++) unmatched.push(tocHeading(toc[k]!));
      const entry = toc[hit.index]!;
      stack.length = Math.max(0, entry.level - 1);
      stack.push(headingOf(entry.num, hit.title));
      cur = { entry, title: hit.title, page: body[i]!.page, lines: [] };
      next = hit.index + 1;
      i += hit.consumed - 1;
      continue;
    }
    cur?.lines.push(body[i]!);
  }
  flush();
  for (let k = next; k < toc.length; k++) unmatched.push(tocHeading(toc[k]!));

  return { sections, report: { tocEntries: toc.length, matched: sections.length, unmatched } };
}

/** 見出しの表示用文字列。本文側の原文タイトルに番号を前置する（前付・付録は番号なし） */
function headingOf(num: string, title: string): string {
  return /^\d/.test(num) && num !== "0" ? `${num} ${title}` : title;
}

function tocHeading(e: TocEntry): string {
  return headingOf(e.num, e.title);
}

/**
 * body[i] から始まる 1〜3 行が toc[from..from+lookahead] のどれかの見出しに一致するか。
 * 見出しは折り返すことがあるので、後続行を結合しながら比べる。
 */
function matchHeading(
  body: Line[],
  i: number,
  toc: TocEntry[],
  from: number,
  lookahead: number,
  bodyH: number,
): { index: number; consumed: number; title: string } | null {
  const line = body[i]!;
  const first = splitNumber(line.text);
  for (let k = from; k < Math.min(toc.length, from + lookahead + 1); k++) {
    const e = toc[k]!;
    const textNumbered = /^\d/.test(e.num) && !e.numberInferred && e.num !== "0";
    // 本文側に番号があるなら、目次の番号と一致しなければならない。番号の無い見出しに番号付きの行は当てない
    if (first.num && (!textNumbered || first.num !== e.num)) continue;
    if (!first.num && textNumbered) continue;

    const want = compact(e.title);
    let got = compact(first.rest);
    let consumed = 1;
    // 折り返した見出しを結合する
    while (got.length < want.length && consumed < 3) {
      const nl = body[i + consumed];
      if (!nl || nl.page !== line.page) break;
      const c = compact(nl.text);
      if (!want.startsWith(got + c.slice(0, 2)) && !want.endsWith(c.slice(-4))) break;
      got += c;
      consumed++;
    }
    // 先読み（目次の見出しを飛ばす）時は完全一致か番号一致を要求する
    const strict = k > from && !first.num;
    // 番号が一致している、または本文より大きい字の行は見出しである蓋然性が高い
    const strong = !!first.num || line.h > bodyH + 0.5;
    if (titlesMatch(got, want, { strict, strong })) {
      const title = [first.rest, ...body.slice(i + 1, i + consumed).map((l) => l.text.trim())].join("");
      return { index: k, consumed, title };
    }
  }
  return null;
}

/**
 * 目次と本文で表記がわずかに違う（誤字・略称・括弧の閉じ忘れ等）ことがあるので、
 * 前方一致＋長さ、または（見出しらしい行に限り）bigram の包含率で判定する。
 */
export function titlesMatch(
  got: string,
  want: string,
  opts: { strict?: boolean; strong?: boolean } = {},
): boolean {
  if (got === want) return true;
  if (opts.strict || want.length < 2) return false;
  const n = Math.min(want.length, 12);
  const tol = Math.max(1, Math.floor(want.length * 0.25));
  if (got.slice(0, n) === want.slice(0, n) && Math.abs(got.length - want.length) <= Math.min(tol, 4)) return true;
  return !!opts.strong && got.length <= want.length * 2 && containment(want, got) >= 0.7;
}

/** want の bigram のうち got に含まれる割合 */
export function containment(want: string, got: string): number {
  const g = new Set<string>();
  for (let i = 0; i < got.length - 1; i++) g.add(got.slice(i, i + 2));
  const w = new Set<string>();
  for (let i = 0; i < want.length - 1; i++) w.add(want.slice(i, i + 2));
  if (w.size === 0) return 0;
  let hit = 0;
  for (const b of w) if (g.has(b)) hit++;
  return hit / w.size;
}

/**
 * 日本語の折り返しを戻して段落にする。
 * - 箇条記号・【】で始まる行は段落の頭
 * - 段落の頭より右にある行は、ぶら下げインデントの続き（①… の 2 行目以降）
 * - 左端より右にある行は字下げ＝段落の頭
 * - それ以外は前の行の続き
 */
export function toParagraphs(lines: Line[]): string {
  if (lines.length === 0) return "";
  const left = new Map<number, number>();
  for (const l of lines) left.set(l.page, Math.min(left.get(l.page) ?? Infinity, l.x));

  const paras: string[] = [];
  let startX = Infinity;
  let startPage = -1;
  for (const l of lines) {
    const t = l.text.trim();
    const bullet = /^(?:[①-⑳㉑-㉟]|[【＜<\[［•●⚫※]|[(（]\d+[)）])/.test(t);
    const hanging = l.page === startPage && l.x > startX + 4;
    const indented = l.x > left.get(l.page)! + 4;
    if (paras.length === 0 || bullet || (!hanging && indented)) {
      paras.push(t);
      startX = l.x;
      startPage = l.page;
    } else {
      paras[paras.length - 1] += t;
    }
  }
  return paras.join("\n");
}

/** 【遵守事項】の ①②… を 1 項目ずつに分ける */
export function splitRequirements(text: string): string[] {
  const start = text.indexOf("【遵守事項】");
  if (start < 0) return [];
  const after = text.slice(start + "【遵守事項】".length);
  const out: string[] = [];
  for (const para of after.split("\n")) {
    const t = para.trim();
    if (!t) continue;
    if (/^[①-⑳㉑-㉟]/.test(t)) out.push(t);
    else if (out.length > 0 && /^【/.test(t)) break;
    else if (out.length > 0) break;
  }
  return out;
}
