import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excerpt, Store } from "../src/store.js";
import type { Section } from "../src/types.js";

const sec = (id: string, path: string[], text: string, extra: Partial<Section> = {}): Section => ({
  id,
  guideline: "g-1.0",
  edition: "1.0",
  book: "本編",
  headingPath: path,
  heading: path.at(-1)!,
  text,
  requirements: [],
  page: 1,
  sourceUrl: "https://example.invalid/g.pdf",
  ...extra,
});

describe("excerpt", () => {
  it("全角英数・空白を含む原文でも、一致箇所の位置がずれない", () => {
    const text = "あ".repeat(200) + "ＶＰＮ 接続 を利用する場合" + "い".repeat(200);
    const out = excerpt(text, "vpn接続", 40);
    assert.match(out, /ＶＰＮ 接続/);
  });

  it("一致しなければ先頭を返す", () => {
    assert.equal(excerpt("短い本文", "存在しない"), "短い本文");
  });
});

describe("Store", () => {
  const store = Store.from([
    sec("g-1.0/main/1", ["1 責任"], ""),
    sec("g-1.0/main/1.1", ["1 責任", "1.1 委託"], "外部委託における責任分界を定める。"),
    sec("g-1.0/main/1.2", ["1 責任", "1.2 提供"], "第三者提供の責任。"),
    sec("g-1.0/main/2", ["2 認証"], "利用者認証は多要素認証とする。"),
    sec("h-2.0/main/1.1", ["1 x", "1.1 委託"], "外部委託", { guideline: "h-2.0" }),
  ]);

  it("収録ガイドラインはデータから決まる", () => {
    assert.deepEqual(
      store.guidelines.map((g) => g.id),
      ["g-1.0", "h-2.0"],
    );
  });

  it("search は本文の無い節を返さず、ガイドラインで絞れる", () => {
    const hits = store.search("責任", { guideline: "g-1.0" });
    assert.deepEqual(hits.map((h) => h.id).sort(), ["g-1.0/main/1.1", "g-1.0/main/1.2"]);
  });

  it("完全一致を部分一致より上に出す", () => {
    const hits = store.search("外部委託", { guideline: "g-1.0" });
    assert.equal(hits[0]!.id, "g-1.0/main/1.1");
  });

  it("siblings / children は同じガイドライン・同じ親に限る", () => {
    const s = store.get("g-1.0/main/1.1")!;
    assert.deepEqual(
      store.siblings(s).map((x) => x.id),
      ["g-1.0/main/1.1", "g-1.0/main/1.2"],
    );
    assert.deepEqual(
      store.children(store.get("g-1.0/main/1")!).map((x) => x.id),
      ["g-1.0/main/1.1", "g-1.0/main/1.2"],
    );
  });
});
