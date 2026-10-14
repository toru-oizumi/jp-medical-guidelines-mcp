/**
 * 検索の評価。test/fixtures/search-eval.json のクエリで hit@k と MRR を出す。
 *   npx tsx scripts/eval-search.ts [--verbose]
 */
import { readFile } from "node:fs/promises";
import { Store } from "../src/store.js";

export type EvalCase = { query: string; guideline?: string; expected: string[] };

export function evaluate(store: Store, cases: EvalCase[], k = 5) {
  const rows = cases.map((c) => {
    const hits = store.search(c.query, { guideline: c.guideline, k: 20 });
    const rank = hits.findIndex((h) => c.expected.includes(h.id)) + 1;
    return { ...c, rank, top: hits.slice(0, k).map((h) => h.id) };
  });
  const hitAtK = rows.filter((r) => r.rank > 0 && r.rank <= k).length / rows.length;
  const mrr = rows.reduce((s, r) => s + (r.rank > 0 ? 1 / r.rank : 0), 0) / rows.length;
  return { hitAtK, mrr, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { cases } = JSON.parse(
    await readFile(new URL("../test/fixtures/search-eval.json", import.meta.url), "utf8"),
  ) as { cases: EvalCase[] };
  const { hitAtK, mrr, rows } = evaluate(await Store.load(), cases);
  for (const r of rows) {
    const mark = r.rank === 1 ? "✓" : r.rank > 0 && r.rank <= 5 ? "~" : "✗";
    console.log(`${mark} rank=${r.rank || "-"}\t${r.query}`);
    if (process.argv.includes("--verbose") && r.rank !== 1) console.log(`    top: ${r.top.join(", ")}`);
  }
  console.log(`\nhit@5=${hitAtK.toFixed(3)}  MRR=${mrr.toFixed(3)}  (n=${rows.length})`);
}
