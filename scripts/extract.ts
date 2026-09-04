/**
 * data/raw/*.pdf → data/sections/*.json
 *
 * 見出し番号（1 / 1.2 / 1.2.3）で章節に切る。ページ番号は参考値としてしか持たない。
 * 条項 id は見出し番号ベース: <guideline>/<key>/<番号>
 *
 * NOTE: PDF のレイアウト依存が強い処理なので、初回は必ず出力を目視で確認すること。
 *       図表・脚注は落ちる。落ちたことを NOTICE.md に書いてある。
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DATA = new URL("../data/", import.meta.url).pathname;
const RAW = join(DATA, "raw");
const OUT = join(DATA, "sections");

const HEADING = /^(\d+(?:\.\d+){0,3})[.\s　]+(\S.{0,80})$/;

type Doc = { key: string; book: string; url: string };
type Guideline = { id: string; edition: string; documents: Doc[] };
const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

await mkdir(OUT, { recursive: true });
const rawFiles = await readdir(RAW);

for (const g of sources.guidelines) {
  const sections: unknown[] = [];

  for (const doc of g.documents) {
    const file = rawFiles.find((f) => f === `${g.id}__${doc.key}.pdf`);
    if (!file) {
      console.warn(`skip (not fetched): ${g.id}/${doc.key}`);
      continue;
    }

    const data = new Uint8Array(await readFile(join(RAW, file)));
    const pdf = await getDocument({ data, useSystemFonts: true }).promise;

    let current: { id: string; heading: string; path: string[]; page: number; lines: string[] } | null = null;
    const flush = () => {
      if (!current || current.lines.length === 0) return;
      sections.push({
        id: current.id,
        guideline: g.id,
        edition: g.edition,
        book: doc.book,
        headingPath: current.path,
        heading: current.heading,
        text: current.lines.join("\n").trim(),
        page: current.page,
        sourceUrl: doc.url,
      });
    };

    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      const lines = groupByLine(content.items as TextItem[]);

      for (const line of lines) {
        const m = HEADING.exec(line);
        if (m) {
          flush();
          const num = m[1]!;
          current = {
            id: `${g.id}/${doc.key}/${num}`,
            heading: `${num} ${m[2]!.trim()}`,
            path: num.split(".").map((_, i, a) => a.slice(0, i + 1).join(".")),
            page: p,
            lines: [],
          };
        } else if (current) {
          current.lines.push(line);
        }
      }
    }
    flush();
    console.log(`${g.id}/${doc.key}: ${pdf.numPages}p`);
  }

  await writeFile(join(OUT, `${g.id}.json`), JSON.stringify(sections, null, 2) + "\n");
  console.log(`-> data/sections/${g.id}.json  ${sections.length} sections`);
}

type TextItem = { str: string; transform: number[] };

/** y 座標が近いものを 1 行として束ねる。PDF のテキストは行単位で来ないため。 */
function groupByLine(items: TextItem[]): string[] {
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]!);
    const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    (rows.get(key) ?? rows.set(key, []).get(key)!).push({ x: it.transform[4]!, str: it.str });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, cells]) =>
      cells
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}
