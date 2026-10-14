/**
 * 原本 PDF → data/sections/<guideline>.json
 *
 * 見出しは目次（TOC）を正として本文と順に照合する（scripts/lib/structure.ts）。
 * 条項 id は見出し番号ベース: <guideline>/<key>/<番号>
 *
 * 原本は data/raw/<guideline>__<key>.pdf（npm run fetch で取得）を優先し、
 * 無ければ sources.json の localFile（data/ からの相対パス）を使う。
 *
 * NOTE: 図表・脚注の上付き番号は落ちる。落ちることを NOTICE.md に書いてある。
 *       目次と照合できなかった見出しは標準出力に出すので、初回は必ず目視で確認すること。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readLines } from "./lib/pdf.js";
import { buildSections, parseToc, tocPages } from "./lib/structure.js";

const DATA = new URL("../data/", import.meta.url).pathname;
const RAW = join(DATA, "raw");
const OUT = join(DATA, "sections");

type Doc = { key: string; book: string; url: string | null; localFile?: string };
type Guideline = { id: string; edition: string; landingPage: string; documents: Doc[] };
const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

await mkdir(OUT, { recursive: true });
let failed = false;

for (const g of sources.guidelines) {
  const sections: unknown[] = [];

  for (const doc of g.documents) {
    const file = resolveSource(g.id, doc);
    if (!file) {
      console.warn(`skip (not fetched): ${g.id}/${doc.key}`);
      continue;
    }

    const { lines, numPages } = await readLines(file);
    const toc = parseToc(lines, tocPages(lines));
    if (toc.length === 0) {
      console.error(`! ${g.id}/${doc.key}: 目次を検出できませんでした`);
      failed = true;
      continue;
    }
    const { sections: built, report } = buildSections(lines, toc);

    for (const s of built) {
      sections.push({
        id: `${g.id}/${doc.key}/${s.num}`,
        guideline: g.id,
        edition: g.edition,
        book: doc.book,
        headingPath: s.path,
        heading: s.heading,
        ...(s.numberInferred ? { numberInferred: true } : {}),
        text: s.text,
        requirements: s.requirements,
        page: s.page,
        sourceUrl: doc.url ?? g.landingPage,
      });
    }

    console.log(
      `${g.id}/${doc.key}: ${numPages}p  toc=${report.tocEntries} matched=${report.matched}` +
        `  requirements=${built.reduce((n, s) => n + s.requirements.length, 0)}`,
    );
    for (const u of report.unmatched) console.log(`  ? 本文で見つからない見出し: ${u}`);
  }

  if (sections.length === 0) continue;
  await writeFile(join(OUT, `${g.id}.json`), JSON.stringify(sections, null, 2) + "\n");
  console.log(`-> data/sections/${g.id}.json  ${sections.length} sections`);
}

if (failed) process.exit(1);

function resolveSource(guideline: string, doc: Doc): string | null {
  const raw = join(RAW, `${guideline}__${doc.key}.pdf`);
  if (existsSync(raw)) return raw;
  if (doc.localFile && existsSync(join(DATA, doc.localFile))) return join(DATA, doc.localFile);
  return null;
}
