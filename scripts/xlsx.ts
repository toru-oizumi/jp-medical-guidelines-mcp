/**
 * data/raw/*.xlsx（厚労省チェックリスト）→ data/checklists/*.json
 *
 * 実際の列構成を見ずには書けない。まず --inspect で原本の先頭行と列の当たりを出し、
 * その出力を見て下の COLUMNS / HEADER_ROWS を合わせること。
 *   npx tsx scripts/xlsx.ts --inspect
 *   npx tsx scripts/xlsx.ts --inspect --rows=20
 *
 * ここで返すのは項目そのものだけ。○×や達成率は付けない（CLAUDE.md の前提 2）。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const DATA = new URL("../data/", import.meta.url).pathname;
const RAW = join(DATA, "raw");
const OUT = join(DATA, "checklists");

const argv = process.argv.slice(2);
const inspect = argv.includes("--inspect");
const inspectRows = Number(argv.find((a) => a.startsWith("--rows="))?.slice(7) ?? 8);
/** ヘッダ語の推定が外れているとき、COLUMNS の食い違いを無視して書き出す */
const force = argv.includes("--force");

/**
 * 原本を見て合わせる。1 始まりの列番号。
 * no を入れると条項 id にその番号を使う（行番号は改定で動くので、番号列があるならそちらが良い）。
 */
const COLUMNS: { category: number; item: number; note: number; no?: number } = {
  category: 2,
  item: 3,
  note: 4,
};
/** この行数までをヘッダとして読み飛ばす */
const HEADER_ROWS = 1;

/** --inspect が COLUMNS の当たりを出すときに見るヘッダ語 */
const HEADER_HINTS: Record<keyof typeof COLUMNS, RegExp> = {
  no: /^(no|番号|項番|項目番号|#)/i,
  category: /(分類|大項目|区分|カテゴリ|章)/,
  item: /(確認項目|チェック項目|遵守事項|内容|項目)/,
  note: /(備考|参考|補足|解説|根拠|該当)/,
};

type Check = { key: string; url: string; target?: "hospital" | "vendor"; kind?: string };
type Guideline = { id: string; checklists: Check[] };
const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

await mkdir(OUT, { recursive: true });
let missing = 0;
const mismatches: string[] = [];

for (const g of sources.guidelines) {
  const items: unknown[] = [];
  let read = 0;

  for (const c of g.checklists) {
    if (c.kind !== "xlsx") continue;
    const path = join(RAW, `${g.id}__${c.key}.xlsx`);
    if (!existsSync(path)) {
      console.warn(`skip (not fetched): ${g.id}/${c.key}`);
      missing++;
      continue;
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    read++;

    for (const ws of wb.worksheets) {
      if (inspect) {
        dump(c, ws);
        continue;
      }
      if (!c.target) continue; // target のない xlsx は行単位に落とせない

      mismatches.push(...checkColumns(`${c.key}/${ws.name}`, ws));

      let category = "";
      ws.eachRow((row, r) => {
        if (r <= HEADER_ROWS) return;
        const cat = cell(row, COLUMNS.category);
        const item = cell(row, COLUMNS.item);
        if (cat) category = cat; // 大分類は結合セルで、先頭行にしか入っていないことがある
        if (!item) return;

        const no = COLUMNS.no ? cell(row, COLUMNS.no) : "";
        items.push({
          id: `${g.id}/checklist/${c.target}/${ws.name}/${no || `row${r}`}`,
          guideline: g.id,
          target: c.target,
          category,
          item,
          note: cell(row, COLUMNS.note) || null,
          sourceUrl: c.url,
        });
      });
    }
  }

  if (inspect || read === 0) continue;
  if (mismatches.length && !force) continue; // 下でまとめて止める
  await writeFile(join(OUT, `${g.id}.json`), JSON.stringify(items, null, 2) + "\n");
  console.log(`-> data/checklists/${g.id}.json  ${items.length} items`);
}

if (mismatches.length) {
  console.error(`\nCOLUMNS が原本のヘッダと食い違っています。書き出していません。`);
  for (const m of mismatches) console.error(`  ! ${m}`);
  console.error(`\n  npx tsx scripts/xlsx.ts --inspect  で原本の列を確認し、`);
  console.error(`  scripts/xlsx.ts の COLUMNS / HEADER_ROWS を直してください。`);
  console.error(`  ヘッダ語の推定が外れている場合は --force で無視できます。`);
  if (!force) process.exit(1);
}

if (missing) {
  // 一部だけで data/checklists/ を作ると、欠けに気づかないまま同梱されてしまう
  console.error(
    `\n${missing} 件の原本が data/raw/ にありません。npm run fetch を実行するか、` +
      `<guideline-id>__<key>.xlsx の名前で手で置いてください。`,
  );
  process.exit(1);
}

/** --inspect: 先頭行をそのまま出し、ヘッダ語から COLUMNS の当たりを出す。 */
function dump(c: Check, ws: ExcelJS.Worksheet): void {
  console.log(
    `\n--- ${c.key} / sheet: "${ws.name}"  ${ws.actualRowCount}/${ws.rowCount} rows x ${ws.actualColumnCount} cols` +
      `  target=${c.target ?? "-"}`,
  );
  const limit = Math.min(inspectRows, ws.rowCount);
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let col = 1; col <= Math.max(1, ws.actualColumnCount); col++) {
      const v = cell(row, col);
      if (v) cells.push(`[${col}] ${truncate(v)}`);
    }
    console.log(`  ${String(r).padStart(3)}: ${cells.join("  ") || "(empty)"}`);
  }
  console.log(`  guess: ${formatGuess(guessColumns(ws))}`);
}

type Guess = { headerRows: number; columns: Partial<Record<keyof typeof COLUMNS, number>> };

/**
 * ヘッダらしい行を探して COLUMNS の候補を出す。
 * 誤ると全項目が静かにずれるので、これで COLUMNS を自動的に書き換えることはしない。
 * 採用は人が決める。食い違ったときは書き出さずに止める（checkColumns）。
 */
function guessColumns(ws: ExcelJS.Worksheet): Guess | null {
  const width = Math.max(1, ws.actualColumnCount);
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const columns: Guess["columns"] = {};
    const claimed = new Set<number>();
    // 「大項目」と「確認項目」のように語が重なるので、先に取られた列は飛ばす
    for (const [name, re] of Object.entries(HEADER_HINTS)) {
      for (let col = 1; col <= width; col++) {
        if (claimed.has(col) || !re.test(cell(row, col))) continue;
        columns[name as keyof typeof COLUMNS] = col;
        claimed.add(col);
        break;
      }
    }
    if (Object.keys(columns).length >= 2) return { headerRows: r, columns };
  }
  return null;
}

function formatGuess(guess: Guess | null): string {
  if (!guess) return "ヘッダ行が見つからない。上の出力を見て手で合わせること";
  const cols = Object.entries(guess.columns).map(([k, v]) => `${k}: ${v}`);
  return `HEADER_ROWS = ${guess.headerRows}, COLUMNS = { ${cols.join(", ")} }`;
}

/**
 * COLUMNS が原本のヘッダと食い違っていたら、書き出さずに止める。
 * 列が 1 つずれただけで、全項目が別の列の文字列になった JSON が静かに出来上がるため。
 */
function checkColumns(label: string, ws: ExcelJS.Worksheet): string[] {
  const guess = guessColumns(ws);
  if (!guess) return [];
  const diff: string[] = [];
  if (guess.headerRows !== HEADER_ROWS) {
    diff.push(`HEADER_ROWS=${HEADER_ROWS} だが、ヘッダは ${guess.headerRows} 行目に見える`);
  }
  for (const [name, col] of Object.entries(guess.columns)) {
    const configured = COLUMNS[name as keyof typeof COLUMNS];
    if (name === "no" && configured === undefined) continue; // no は任意
    if (configured !== col) diff.push(`${name}: COLUMNS=${configured} だが ${col} 列に見える`);
  }
  return diff.length ? [`${label}: ${diff.join(" / ")}`] : [];
}

function truncate(s: string, n = 28): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function cell(row: ExcelJS.Row, col: number): string {
  const c = row.getCell(col);
  // 結合セルは左上以外が空になる。大分類の列でよく起きるので master を見る。
  const v = c.value ?? (c.isMerged ? c.master.value : null);
  if (v == null) return "";
  if (typeof v === "object" && "richText" in v) return flat(v.richText.map((t) => t.text).join(""));
  if (typeof v === "object" && "text" in v) return flat(String(v.text)); // ハイパーリンク
  if (typeof v === "object" && "result" in v) return flat(String(v.result ?? "")); // 数式
  return flat(String(v));
}

/** セル内改行をつぶす。原文の文言は変えない（空白の正規化まで） */
function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
