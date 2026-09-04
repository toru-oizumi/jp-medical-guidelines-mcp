/**
 * data/raw/*.xlsx（チェックリスト）→ data/checklists/*.json
 *
 * 実際の列構成を見ずに書けないので、まず --inspect で先頭行を出して COLUMNS を合わせること。
 *   npx tsx scripts/xlsx.ts --inspect
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";

const DATA = new URL("../data/", import.meta.url).pathname;
const RAW = join(DATA, "raw");
const OUT = join(DATA, "checklists");
const inspect = process.argv.includes("--inspect");

/** 原本を見て合わせる。1 始まりの列番号。 */
const COLUMNS = { category: 2, item: 3, note: 4 };
const HEADER_ROWS = 1;

type Check = { key: string; url: string; target?: "hospital" | "vendor"; kind?: string };
type Guideline = { id: string; checklists: Check[] };
const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

await mkdir(OUT, { recursive: true });

for (const g of sources.guidelines) {
  const items: unknown[] = [];

  for (const c of g.checklists) {
    if (c.kind !== "xlsx" || !c.target) continue;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(RAW, `${g.id}__${c.key}.xlsx`));

    for (const ws of wb.worksheets) {
      if (inspect) {
        console.log(`--- ${c.key} / sheet: ${ws.name} (${ws.rowCount} rows)`);
        for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
          console.log(r, ws.getRow(r).values);
        }
        continue;
      }

      let category = "";
      for (let r = HEADER_ROWS + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const cat = cell(row, COLUMNS.category);
        const item = cell(row, COLUMNS.item);
        if (cat) category = cat;
        if (!item) continue;
        items.push({
          id: `${g.id}/checklist/${c.target}/${ws.name}/${r}`,
          guideline: g.id,
          target: c.target,
          category,
          item,
          note: cell(row, COLUMNS.note) || null,
          sourceUrl: c.url,
        });
      }
    }
  }

  if (inspect) continue;
  await writeFile(join(OUT, `${g.id}.json`), JSON.stringify(items, null, 2) + "\n");
  console.log(`-> data/checklists/${g.id}.json  ${items.length} items`);
}

function cell(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v == null) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
  return String(v).replace(/\s+/g, " ").trim();
}
