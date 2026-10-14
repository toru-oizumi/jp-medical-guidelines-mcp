import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Store } from "../src/store.js";

/** 生成済みの data/sections の不変条件。抽出ロジックを変えたときの退行検知用 */
describe("data/sections", async () => {
  const store = await Store.load();

  it("データがある", () => {
    assert.ok(store.sections.length > 0, "npm run extract を実行してください");
  });

  it("id が一意", () => {
    const ids = store.sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("編の中でページが単調増加する（見出しの誤照合があると崩れる）", () => {
    const bad: string[] = [];
    for (let i = 1; i < store.sections.length; i++) {
      const [a, b] = [store.sections[i - 1]!, store.sections[i]!];
      if (a.guideline === b.guideline && a.book === b.book && (b.page ?? 0) < (a.page ?? 0)) {
        bad.push(`${a.id} p${a.page} -> ${b.id} p${b.page}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it("headingPath の末尾は自分の見出し", () => {
    for (const s of store.sections) assert.equal(s.headingPath.at(-1), s.heading, s.id);
  });

  it("遵守事項は丸数字で始まり、本文に含まれる", () => {
    for (const s of store.sections) {
      for (const r of s.requirements) {
        assert.match(r, /^[①-⑳㉑-㉟]/, s.id);
        assert.ok(s.text.includes(r), s.id);
      }
    }
  });

  it("出典 URL を持つ", () => {
    for (const s of store.sections) assert.match(s.sourceUrl, /^https:\/\//, s.id);
  });
});
