/**
 * data/raw/*.pdf → data/sections/*.json
 *
 * 見出し番号（1 / 1.2 / 1.2.3）で章節に切る。条項 id は <guideline>/<key>/<番号>。
 * ページ番号は参考値としてしか持たない（改定で動くため）。
 *
 * 分割そのものは scripts/lib/sections.ts（純関数・テストあり）。
 * ここは PDF から行を組み立てるところと、出力の書き出しだけを持つ。
 *
 * 見出し検出は PDF のレイアウト依存が強い。**正規表現を触る前に必ず目視すること。**
 *   npx tsx scripts/extract.ts --report                 # 書き出さずに監査結果だけ出す
 *   npx tsx scripts/extract.ts --report --only=operations
 *   npx tsx scripts/extract.ts --report --min-size=12   # フォントサイズで見出しを絞る
 *   npx tsx scripts/extract.ts --heading='^(\d+(?:\.\d+){0,3})\s*(\S.{0,80})$'
 *
 * 図表・脚注は落ちる。落ちることは data/NOTICE.md に書いてある。
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DEFAULT_HEADING, formatReport, splitSections, type Line } from "./lib/sections.js";

const DATA = new URL("../data/", import.meta.url).pathname;
const RAW = join(DATA, "raw");
const OUT = join(DATA, "sections");

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const report = argv.includes("--report");
const only = flag("only");
const headingSrc = flag("heading");
const minHeadingSize = Number(flag("min-size") ?? 0);

const heading = headingSrc ? new RegExp(headingSrc) : DEFAULT_HEADING;
if (headingSrc) console.log(`heading = ${heading}`);
if (minHeadingSize) console.log(`min-size = ${minHeadingSize}`);

type Doc = { key: string; book: string; url: string };
type Guideline = { id: string; edition: string; documents: Doc[] };
const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

await mkdir(OUT, { recursive: true });
const rawFiles = await readdir(RAW).catch(() => [] as string[]);
if (rawFiles.length === 0) {
  console.error(`data/raw/ が空です。npm run fetch を実行するか、原本を手で置いてください。`);
  console.error(`  ファイル名: <guideline-id>__<key>.pdf  例 mhlw-7.0__operations.pdf`);
  process.exit(1);
}

let warnings = 0;
let skipped = 0;

for (const g of sources.guidelines) {
  const sections: unknown[] = [];
  let extracted = 0;

  for (const doc of g.documents) {
    if (only && !`${g.id}/${doc.key}`.includes(only)) continue;

    const file = `${g.id}__${doc.key}.pdf`;
    if (!rawFiles.includes(file)) {
      console.warn(`skip (not fetched): ${g.id}/${doc.key}`);
      skipped++;
      continue;
    }

    const lines = await readLines(join(RAW, file));
    const result = splitSections(lines, { heading, minHeadingSize });
    extracted++;

    for (const s of result.sections) {
      sections.push({
        id: `${g.id}/${doc.key}/${s.num}`,
        guideline: g.id,
        edition: g.edition,
        book: doc.book,
        headingPath: s.num.split(".").map((_, i, a) => a.slice(0, i + 1).join(".")),
        heading: s.heading,
        text: s.lines.join("\n").trim(),
        page: s.page,
        sourceUrl: doc.url,
      });
    }

    const r = result.report;
    const flagged =
      r.duplicates.length + r.gaps.length + r.orphans.length + r.hugeSections.length;
    warnings += flagged;

    if (report) {
      console.log(formatReport(`${g.id}/${doc.key} (${doc.book})`, r, result.sections));
      console.log("");
    } else {
      console.log(
        `${g.id}/${doc.key}: ${r.pages}p -> ${result.sections.length} sections` +
          (flagged ? `  (要確認 ${flagged} 件)` : ""),
      );
    }
  }

  if (extracted === 0) continue;
  if (report) continue;
  await writeFile(join(OUT, `${g.id}.json`), JSON.stringify(sections, null, 2) + "\n");
  console.log(`-> data/sections/${g.id}.json  ${sections.length} sections`);
}

if (report) {
  console.log("（--report は書き出しません）");
} else {
  if (warnings) {
    console.log(`\n要確認 ${warnings} 件。内訳は npx tsx scripts/extract.ts --report で見られます。`);
  }
  if (skipped && !only) {
    // 一部の編だけで data/sections/ を作ると、欠けに気づかないまま同梱されてしまう
    console.error(`\n${skipped} 件の原本が data/raw/ にありません。npm run fetch を実行してください。`);
    process.exit(1);
  }
}

type TextItem = { str: string; transform: number[]; height: number };

/** PDF → 行の列。テキストは行単位で来ないので y 座標で束ねる。 */
async function readLines(path: string): Promise<Line[]> {
  const data = new Uint8Array(await readFile(path));
  const task = getDocument({ data, useSystemFonts: true });
  const pdf = await task.promise;
  const out: Line[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const height = page.getViewport({ scale: 1 }).height || 1;
    const content = await page.getTextContent();
    out.push(...groupByLine(content.items as TextItem[], p, height));
    page.cleanup();
  }

  await task.destroy();
  return out;
}

/**
 * y 座標が近いものを 1 行として束ねる。許容差は文字の高さに比例させる
 * （固定値だと本文と見出しでずれ方が違う）。
 */
function groupByLine(items: TextItem[], page: number, pageHeight: number): Line[] {
  type Cell = { x: number; y: number; size: number; str: string };
  const cells: Cell[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    cells.push({
      x: it.transform[4]!,
      y: it.transform[5]!,
      size: Math.abs(it.transform[3]!) || it.height || 0,
      str: it.str,
    });
  }
  if (cells.length === 0) return [];

  cells.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Cell[][] = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(1, (row?.[0]?.size ?? c.size) * 0.4);
    if (row && Math.abs(row[0]!.y - c.y) <= tolerance) row.push(c);
    else rows.push([c]);
  }

  return rows
    .map((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const text = sorted
        .map((c) => c.str)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      return {
        text,
        page,
        size: Math.max(...row.map((c) => c.size)),
        yRatio: row[0]!.y / pageHeight,
      };
    })
    .filter((l) => l.text.length > 0);
}
