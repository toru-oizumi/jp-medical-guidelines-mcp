import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { type EvalCase, evaluate } from "../scripts/eval-search.js";
import { Store } from "../src/store.js";

/**
 * 検索品質の退行検知。閾値は導入時の実測（hit@5=1.000, MRR=0.948）から少し余裕を持たせた値。
 * 採点を変えて上がったら閾値も上げること。
 */
it("評価用クエリ集で hit@5 と MRR が閾値を下回らない", async () => {
  const { cases } = JSON.parse(
    await readFile(new URL("./fixtures/search-eval.json", import.meta.url), "utf8"),
  ) as { cases: EvalCase[] };
  const { hitAtK, mrr, rows } = evaluate(await Store.load(), cases);
  const misses = rows.filter((r) => r.rank === 0 || r.rank > 5).map((r) => `${r.query} -> ${r.top.join(", ")}`);
  assert.ok(hitAtK >= 0.95, `hit@5=${hitAtK}\n${misses.join("\n")}`);
  assert.ok(mrr >= 0.9, `MRR=${mrr}`);
});
