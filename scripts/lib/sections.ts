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
  /**
   * 行の中で、隣り合う文字の間隔がいちばん空いたところ（文字の高さを 1 とした比）。
   * 表の行は複数の列が 1 行に束ねられるので、ここが大きくなる。実測では
   * 本文が 1.0 以下、表の行が 2.0〜28。
   */
  gap: number;
}

export interface RawSection {
  /** 見出し番号。例 "4.2.1" */
  num: string;
  /** 番号込みの見出し行。例 "4.2.1 リモートアクセス" */
  heading: string;
  /** 番号を除いた見出し */
  title: string;
  page: number;
  /** 見出し行のフォントサイズ。重複したときにどちらが本物かを決めるのに使う */
  size: number;
  lines: string[];
  /** この章節から落とした表の行数。0 でなければ、原本の表がここにある */
  tableLines: number;
  /** 見出しが目次と完全に一致したか。表の中の切れ端と本物を見分けるのに使う */
  tocExact: boolean;
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
  /** 目次のページ。ここからは章節を作らない */
  tocPages: number[];
  /** 目次から拾った見出しの数。0 なら目次が見つからず、見出しの検証をしていない */
  tocEntries: number;
  /** 目次にないので見出しにしなかった行 */
  notInToc: { page: number; num: string; text: string }[];
  /** 目次行として落とした行数 */
  tocLines: number;
  /** 表の行として落とした行。列が 1 行に束ねられていて、原文としては読めない */
  tableLines: { page: number; text: string }[];
  /** 最初の見出しより前にあった本文行（前文・表紙）。捨てている */
  preamble: string[];
  /** 同じ番号が 2 回出た。本文が長い方を採用している */
  duplicates: { num: string; keptChars: number; droppedChars: number; pages: number[] }[];
  /** 目次にあるのに本文で見つからなかった見出し。取りこぼしそのもの */
  missing: string[];
  /** 番号の飛び。目次が読めなかったときだけ見る、取りこぼしの代理指標 */
  gaps: string[];
  /** 親の見出しがない番号。誤検出の兆候（親が目次にもないなら、番号のない章なので数えない） */
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
 * 既定の見出し行。**NFKC 正規化した行**に対して当てる（原本の見出しは "７．２．１" と全角）。
 *
 * 原本（第6.0版・提供事業者GL）の見出しは、番号と見出しの間に区切りがない:
 *   "１．情報セキュリティの基本的な考え方[Ⅰ～Ⅳ]"  → 1 / 情報セキュリティ…
 *   "１．１安全管理に関する法制度等による要求事項"  → 1.1 / 安全管理…
 *   "７．２．１医療機関等の職員による外部からのアクセス" → 7.2.1 / 医療機関等…
 * 区切りを必須にできないぶん、本文中の数値表現は次の 3 つで外している:
 *   1. 各成分は 1〜2 桁。3 桁以上の章番号はこのガイドラインに出てこない
 *   2. 番号の直後に数字が続いてはいけない  → "2025年3月" を "20" と読まない
 *   3. 見出しが助詞で始まってはいけない    → "3.11の規定による" を拾わない
 *      （"1 はじめに" を残すため、は・と・も は除外していない）
 */
export const DEFAULT_HEADING =
  /^(\d{1,2}(?:\.\d{1,2}){0,3})(?!\.?\d)\.?[\s　]*(?![のをにへが号年月日条項時分回名頁円人件個%％])(\S.{0,80})$/;

/** 助詞・助数詞の縛りを外したもの。縛りで落とした行を report に出すためだけに使う */
const DEFAULT_HEADING_LOOSE = /^(\d{1,2}(?:\.\d{1,2}){0,3})(?!\.?\d)\.?[\s　]*(\S.{0,80})$/;

/**
 * 目次のページと、そこに載っている見出しを読む。
 *
 * 原本の目次はリーダ（……）＋ページ番号で終わる。それが 1 ページに何行もあるなら目次のページ。
 * 目次のページからは章節を作らない（作ると本文と id が衝突する）。
 */
function readToc(
  lines: Line[],
  heading: RegExp,
): { pages: Set<number>; toc: Map<string, string[]> } {
  const leaderCount = new Map<number, number>();
  for (const line of lines) {
    if (TOC_LEADER.test(line.text.trim())) {
      leaderCount.set(line.page, (leaderCount.get(line.page) ?? 0) + 1);
    }
  }
  const pages = new Set(
    [...leaderCount.entries()].filter(([, n]) => n >= TOC_PAGE_MIN_LINES).map(([p]) => p),
  );

  const toc = new Map<string, string[]>();
  for (const line of lines) {
    if (!pages.has(line.page)) continue;
    const text = line.text.trim();
    // リーダとページ番号を落としてから見出しとして読む。
    // 折り返した目次行はリーダを持たないが、番号があれば同じように拾える。
    const stripped = text.replace(/[.．・…‥․]{3,}.*$/, "").trim();
    const m = heading.exec(foldWidth(stripped));
    if (!m?.[1]) continue;
    const title = stripped.replace(HEADING_NUMBER_PREFIX, "").trim();
    if (!title) continue;
    const titles = toc.get(m[1]);
    if (titles) titles.push(title);
    else toc.set(m[1], [title]);
  }
  return { pages, toc };
}

/**
 * 目次の見出しと突き合わせる。目次側は折り返しで切れていることがあるので、既定では頭だけ見る。
 * exact を立てると完全一致だけを見る（表の中の切れ端は見出しの後ろに隣の列がくっつくので、
 * 頭だけ見ると通ってしまう。本物と並んだときにどちらを採るかはこれで決める）。
 */
function matchesToc(
  toc: Map<string, string[]>,
  num: string,
  title: string,
  exact = false,
): boolean {
  const titles = toc.get(num);
  if (!titles) return false;
  const strip = (s: string) => s.replace(/[\s　]/g, "");
  const want = strip(title);
  if (exact) return titles.some((t) => strip(t) === want);
  const head = (s: string) => strip(s).slice(0, TITLE_MATCH_CHARS);
  return titles.some((t) => head(title).startsWith(head(t)) || head(t).startsWith(head(title)));
}

/** 見出し番号の並び。原文から見出しだけを切り出すのに使う */
const HEADING_NUMBER_PREFIX = /^[0-9０-９.．\s　]+/;

/**
 * 全角の数字と句点だけを半角に寄せる。
 * NFKC を使ってはいけない: ① が 1 になり、【遵守事項】の箇条書きが全部見出しになる。
 * Ⅰ～Ⅳ も I~IV に潰れる。原本で踏んだ。
 */
function foldWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".");
}

/** ノンブルだけの行。"12" "- 12 -" "12 頁" */
const PAGE_NUMBER_ONLY = /^[-‐–—ー\s(（]*\d{1,4}\s*(?:頁|ページ|\/\s*\d{1,4})?[-‐–—ー\s)）]*$/;

/**
 * 目次行。リーダ（……）＋末尾のページ番号。
 * ページ番号は "41" のほか "-3-" の形でも打たれる（原本がこの形）。
 */
const TOC_LEADER = /[.．・…‥․]{3,}\s*[-‐–—]?\s*\d{1,4}\s*[-‐–—]?\s*$/;

/** 見出しかもしれない形。検出できなかったものを report に出すためだけに使う */
const HEADING_LIKE: RegExp[] = [
  /^第\s*[0-9０-９]+\s*[章編節款]/,
  /^[（(][0-9０-９]{1,3}[）)]\s*\S/,
  /^[0-9０-９]{1,3}[）)]\s*\S/,
  // ①②③ は【遵守事項】の中の箇条書きで、見出しではない。原本で確認済みなので候補に挙げない
];

/**
 * これを超える間隔が行の中にあれば、複数の列が束ねられた表の行とみなす。
 * 実測: 本文の最大が 1.0em（全角スペース 1 つ）、表の行は 2.0em 以上。
 */
const MAX_LINE_GAP = 1.5;

/**
 * 柱・ノンブルの判定に使うページ内の帯（上下端 10%）。
 * 実測: A4(842pt) の柱は y=780 あたり = 0.93。0.06 だと届かない。
 */
const MARGIN_BAND = 0.1;
/** 何ページに出たら柱とみなすか */
const BOILERPLATE_MIN_PAGES = 3;
const BOILERPLATE_PAGE_RATIO = 0.3;

/** 1 ページに目次行がこれだけあれば、そのページは目次とみなす */
const TOC_PAGE_MIN_LINES = 3;
/** 目次の見出しと本文の見出しを突き合わせるときに見る文字数 */
const TITLE_MATCH_CHARS = 6;

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
    tocPages: [],
    tocEntries: 0,
    notInToc: [],
    tocLines: 0,
    tableLines: [],
    preamble: [],
    duplicates: [],
    missing: [],
    gaps: [],
    orphans: [],
    emptySections: [],
    hugeSections: [],
    headingLike: [],
    sizes: { heading: [], body: [] },
  };

  const { pages: tocPages, toc } = readToc(lines, heading);
  report.tocPages = [...tocPages].sort((a, b) => a - b);
  report.tocEntries = toc.size;

  const sections: RawSection[] = [];
  let current: RawSection | null = null;

  for (const line of lines) {
    if (tocPages.has(line.page)) {
      report.tocLines++;
      continue;
    }
    const text = line.text.trim();
    if (!text) continue;

    if (PAGE_NUMBER_ONLY.test(text)) continue;
    if (inMargin(line) && boilerplateKeys.has(boilerplateKey(text))) continue;
    if (TOC_LEADER.test(text)) {
      report.tocLines++;
      continue;
    }
    // 見出し番号は全角なので、判定は数字と句点を半角に寄せた行に対して行う。
    // 出力は原文ママにしたいので、見出しの文字列は生の行から番号を落として作る。
    // --heading で外から渡された正規表現でも落ちないように、group の有無は見る。
    const folded = foldWidth(text);
    const m = heading.exec(folded);
    const num = m?.[1];
    const title = text.replace(HEADING_NUMBER_PREFIX, "").trim();
    // 目次が読めたなら、目次にある見出しだけを採る。
    // 前提1（id は人が原本の目次から引ける文字列であること）をそのまま検査にしたもの。
    // これがないと、表の中の法令一覧「１.医師法（昭和23年法律第201号）…」が章節になる。
    const inToc = toc.size === 0 || (num !== undefined && matchesToc(toc, num, title));
    if (num && !inToc) report.notInToc.push({ page: line.page, num, text });
    // 間隔の空いた行は表の行のことが多い。目次で裏が取れているときだけ見出しとして通す
    const gapOk = line.gap <= MAX_LINE_GAP || toc.size > 0;
    if (num && inToc && gapOk && (minSize === 0 || line.size === 0 || line.size >= minSize)) {
      current = {
        num,
        heading: title ? `${num} ${title}` : num,
        title,
        page: line.page,
        size: line.size,
        lines: [],
        tableLines: 0,
        tocExact: matchesToc(toc, num, title, true),
      };
      sections.push(current);
      if (line.size) report.sizes.heading.push(line.size);
      continue;
    }

    // 見出しでないなら表の行かどうかを見る。先に表を落とすと、章見出し（番号と見出しの間が
    // 2em 空いている）まで落ちてしまう。原本で踏んだ。
    if (line.gap > MAX_LINE_GAP) {
      // 列が横に連結されていて、そのまま並べると原文にない文が出来上がる。
      // 引用の根拠にできないので落とすが、落としたことは report と tableLines に残す。
      report.tableLines.push({ page: line.page, text });
      if (current) current.tableLines++;
      continue;
    }

    if (line.size) report.sizes.body.push(line.size);
    // num があるのにここに来たのは minHeadingSize で落ちた行。
    // LOOSE だけが当たる行は、助詞・助数詞の縛りで落とした行（法令番号の折り返しなど）。
    if (num || DEFAULT_HEADING_LOOSE.test(folded) || HEADING_LIKE.some((re) => re.test(text))) {
      report.headingLike.push({ text, page: line.page });
    }

    if (!current) {
      report.preamble.push(text);
      continue;
    }
    current.lines.push(text);
  }

  const deduped = dedupe(sections, report);
  audit(deduped, report, hugeChars, toc);
  return { sections: deduped, report };
}

/**
 * 同じ番号が 2 回以上出たときに、どれが本物かを決める。
 *
 * 目次と完全に一致する見出しを優先し、次にフォントサイズが大きい方、最後に本文が長い方を採る。
 * 原本には章の頭に「＜構成と概要＞」として同じ番号・同じ見出しを小さい字で並べたページがあり、
 * 本文の少ない章だとそちらが勝ってしまう（章見出し 12.0pt に対して概要の一覧は 10.6pt）。
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
    const sorted = [...list].sort(
      (a, b) =>
        Number(b.tocExact) - Number(a.tocExact) || b.size - a.size || chars(b) - chars(a),
    );
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

function audit(
  sections: RawSection[],
  report: SplitReport,
  hugeChars: number,
  toc: Map<string, string[]>,
): void {
  const nums = new Set(sections.map((s) => s.num));
  const seen = new Map<string, number>(); // 親 → 直前の末尾番号

  // 目次が読めているなら、取りこぼしは「目次にあって本文にない」で直接わかる。
  // 番号の飛びを見るのは、目次が読めなかったときの代わりでしかない。
  for (const num of toc.keys()) {
    if (!nums.has(num)) report.missing.push(`${num} ${toc.get(num)![0] ?? ""}`.trim());
  }

  for (const s of sections) {
    const parts = s.num.split(".").map(Number);
    const parent = parts.slice(0, -1).join(".");
    const last = parts[parts.length - 1]!;

    // 親が目次にもないなら、番号のない章の下にぶら下がっているだけ（提供事業者GLがこの形）
    if (parent && !nums.has(parent) && (toc.size === 0 || toc.has(parent))) {
      report.orphans.push(`${s.num} (親 ${parent} がない)`);
    }

    if (toc.size === 0) {
      const prev = seen.get(parent);
      if (prev === undefined) {
        if (last !== 1) report.gaps.push(`${s.num} が ${parent || "先頭"} の 1 番目`);
      } else if (last !== prev + 1) {
        report.gaps.push(`${parent ? parent + "." : ""}${prev} → ${s.num}`);
      }
      seen.set(parent, last);
    }

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
  if (report.tocEntries) {
    p(`  目次: p${report.tocPages.join(",")} から ${report.tocEntries} 件（${report.tocLines} 行を除外）`);
  } else {
    p(`  ! 目次が見つからないので、見出しを目次と突き合わせていない`);
  }
  if (report.tableLines.length) {
    const pages = [...new Set(report.tableLines.map((t) => t.page))];
    p(`  表の行として落とした: ${report.tableLines.length} 行（p${pages.join(",")}）`);
    for (const t of report.tableLines.slice(0, 4)) p(`    p${t.page}  ${t.text.slice(0, 50)}`);
  }
  if (report.preamble.length) p(`  最初の見出しより前（捨てた）: ${report.preamble.length} 行`);

  const s = report.sizes;
  if (s.heading.length && s.body.length) {
    p(`  フォントサイズ  見出し: ${stat(s.heading)}   本文: ${stat(s.body)}`);
  }

  warn(p, "重複した番号", report.duplicates.map((d) =>
    `${d.num}  p${d.pages.join(",")}  採用 ${d.keptChars}字 / 捨て ${d.droppedChars}字`));
  warn(p, "目次にあるのに本文で見つからなかった見出し", report.missing);
  warn(p, "番号の飛び", report.gaps);
  warn(p, "親のない見出し", report.orphans);
  warn(p, "本文が空", report.emptySections);
  warn(p, "異常に長い（見出しの取りこぼし疑い）",
    report.hugeSections.map((h) => `${h.num}  ${h.chars}字`));
  warn(p, "目次にないので見出しにしなかった行",
    dedupeStrings(report.notInToc.map((n) => `p${n.page}  [${n.num}] ${n.text.slice(0, 60)}`)));
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
