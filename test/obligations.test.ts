import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, extractObligations, splitSentences, subjectOf } from "../scripts/lib/obligations.js";

describe("splitSentences", () => {
  it("括弧の中の「。」では切らない", () => {
    assert.deepEqual(splitSentences("「A。B」を参照すること。次の文。"), ["「A。B」を参照すること。", "次の文。"]);
  });
});

describe("classify", () => {
  it("文末表現で強さを分ける", () => {
    assert.equal(classify("対象事業者は、合意を形成すること。"), "must");
    assert.equal(classify("情報の返却を実施しなければならない。"), "must");
    assert.equal(classify("多要素認証を可能な限り早期に採用すべきである。"), "should");
    assert.equal(classify("適切な情報提供が必要である。"), "should");
    assert.equal(classify("合意形成を図ることが求められる。"), "should");
    assert.equal(classify("プライバシーマーク認定を取得していることが望ましい。"), "recommended");
  });

  it("義務でない「こと」で終わる文は採らない", () => {
    assert.equal(classify("委託先に移転することができること。"), null);
    assert.equal(classify("本ガイドラインの構成を示す。"), null);
  });
});

describe("subjectOf", () => {
  it("主題の「は」を「が」より優先する", () => {
    assert.equal(
      subjectOf("医療機関等は、漏えい等事案が生じた旨を対象事業者が通知する体制を確保することが必要である。"),
      "医療機関等",
    );
    assert.equal(subjectOf("対象事業者Bは対象事業者Aに報告すること。"), "対象事業者");
    assert.equal(subjectOf("情報流を特定すること。"), null);
  });
});

describe("extractObligations", () => {
  it("改ページ・図表で切れた断片と、引用の中の文を除く", () => {
    const text = [
      "対象事業者は、全体構成図を作成すること。説明の文である。",
      "用管理規程に含めること。",
      "し、ネットワーク経路を適切に選択することが必要である。",
      "したがって、対象事業者は、役割分担を定めること。",
      "真正性とは「作成に係る責任の所在を明らかにしていること。」をいう。",
    ].join("\n");
    assert.deepEqual(extractObligations(text), [
      { no: "o1", level: "must", subject: "対象事業者", text: "対象事業者は、全体構成図を作成すること。" },
      { no: "o2", level: "must", subject: "対象事業者", text: "したがって、対象事業者は、役割分担を定めること。" },
    ]);
  });
});
