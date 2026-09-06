/**
 * node --import tsx --test scripts/lib/sections.test.ts
 *
 * 実データが手元にないところを補うためのテスト。ここで守っているのは
 * 「レイアウトに依存しない誤りは機械的に落ちる」「判断が要るものは report に出る」の 2 点だけで、
 * 見出し検出そのものの正しさは実データの目視（--report）でしか決まらない。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HEADING, splitSections, type Line } from "./sections.js";

/** "p1 body 見出しテキスト" のような書き方で行を組む */
function lines(spec: [page: number, kind: "head" | "body" | "top" | "bottom", text: string][]): Line[] {
  return spec.map(([page, kind, text]) => ({
    text,
    page,
    size: kind === "head" ? 14 : 10.5,
    // A4(842pt) の実測値に寄せる: 柱 y=780 → 0.93, ノンブル y=40 → 0.05
    yRatio: kind === "top" ? 0.93 : kind === "bottom" ? 0.05 : 0.5,
    gap: 0,
  }));
}

test("見出し番号で章節に切り、id 用の番号と見出しを持つ", () => {
  const { sections } = splitSections(
    lines([
      [1, "head", "4 情報システムの運用管理"],
      [1, "body", "本編では運用管理について示す。"],
      [1, "head", "4.1 責任分界"],
      [1, "body", "委託先との責任分界を明確にすること。"],
      [2, "head", "4.1.1 契約における取り決め"],
      [2, "body", "契約書に定めること。"],
    ]),
  );

  assert.deepEqual(
    sections.map((s) => s.num),
    ["4", "4.1", "4.1.1"],
  );
  assert.equal(sections[1]!.heading, "4.1 責任分界");
  assert.equal(sections[1]!.title, "責任分界");
  assert.equal(sections[2]!.lines.join(""), "契約書に定めること。");
});

test("全角空白・番号末尾の句点で区切られた見出しも取る", () => {
  const { sections } = splitSections(
    lines([
      [1, "head", "5.2　外部委託"],
      [1, "body", "あ"],
      [1, "head", "5.3. 監査"],
      [1, "body", "い"],
    ]),
  );
  assert.deepEqual(sections.map((s) => s.title), ["外部委託", "監査"]);
});

test("目次行（リーダ＋ページ番号）は章節にしない", () => {
  const { sections, report } = splitSections(
    lines([
      [1, "body", "目次"],
      [1, "body", "4 情報システムの運用管理 ………………………… 41"],
      [1, "body", "4.1 責任分界 ...................................... 42"],
      [2, "head", "4 情報システムの運用管理"],
      [2, "body", "本文。"],
    ]),
  );
  assert.deepEqual(sections.map((s) => s.num), ["4"]);
  assert.equal(sections[0]!.lines.join(""), "本文。");
  assert.equal(report.tocLines, 2);
});

test("同じ番号が 2 回出たら、見出しが大きい方（＝本物の章見出し）を残す", () => {
  // 原本の「＜構成と概要＞」ページは、章見出しと同じ文字列を小さい字で並べている
  const { sections, report } = splitSections([
    { text: "１．安全管理に関する責任・責務", page: 5, size: 10.6, yRatio: 0.81, gap: 0 },
    { text: "・法令上の遵守事項や義務など、概要の箇条書きが続く。", page: 5, size: 10.6, yRatio: 0.79, gap: 0 },
    { text: "１．安全管理に関する責任・責務", page: 6, size: 12.0, yRatio: 0.91, gap: 0 },
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0]!.page, 6);
  assert.equal(report.duplicates.length, 1);
});

test("見出しの大きさが同じなら本文が長い方を残し、report に出す", () => {
  const { sections, report } = splitSections(
    lines([
      [1, "head", "4.1 責任分界"],
      [1, "body", "短い"],
      [9, "head", "4.1 責任分界"],
      [9, "body", "こちらが本文で、はるかに長い記述が続く。".repeat(3)],
    ]),
  );
  assert.equal(sections.length, 1);
  assert.match(sections[0]!.lines.join(""), /はるかに長い/);
  assert.equal(report.duplicates.length, 1);
  assert.deepEqual(report.duplicates[0]!.pages, [1, 9]);
});

test("上下端で繰り返す柱とノンブルは本文に混ぜない", () => {
  const spec: [number, "head" | "body" | "top" | "bottom", string][] = [
    [1, "head", "1 総則"],
  ];
  for (let p = 1; p <= 10; p++) {
    spec.push([p, "top", "医療情報システムの安全管理に関するガイドライン 第7.0版"]);
    spec.push([p, "body", `p${p} の本文。`]);
    spec.push([p, "bottom", `- ${p} -`]);
  }
  const { sections, report } = splitSections(lines(spec));

  const body = sections[0]!.lines.join("\n");
  assert.doesNotMatch(body, /第7\.0版/);
  assert.doesNotMatch(body, /- 3 -/);
  assert.equal(report.boilerplate.length, 1);
  assert.equal(report.boilerplate[0]!.pages, 10);
});

test("同じ文字列でも本文の位置にあるなら落とさない", () => {
  const spec: [number, "head" | "body" | "top" | "bottom", string][] = [[1, "head", "1 総則"]];
  for (let p = 1; p <= 10; p++) spec.push([p, "body", "参考: 別途定めるところによる。"]);
  const { sections, report } = splitSections(lines(spec));
  assert.equal(sections[0]!.lines.length, 10);
  assert.equal(report.boilerplate.length, 0);
});

test("本文が空の見出しも落とさない（階層が欠けると id が引けなくなる）", () => {
  const { sections, report } = splitSections(
    lines([
      [1, "head", "6 経営者の責務"],
      [1, "head", "6.1 方針の策定"],
      [1, "body", "方針を定めること。"],
    ]),
  );
  assert.deepEqual(sections.map((s) => s.num), ["6", "6.1"]);
  assert.deepEqual(report.emptySections, ["6 経営者の責務"]);
});

test("目次にあるのに本文で見つからなかった見出しを report に出す", () => {
  const { report } = splitSections(
    lines([
      [1, "body", "１．総則............1"],
      [1, "body", "１．１適用範囲............1"],
      [1, "body", "１．２用語の定義............2"],
      [2, "head", "１．総則"],
      [2, "head", "１．１適用範囲"],
      [2, "body", "本文。"],
    ]),
  );
  assert.deepEqual(report.missing, ["1.2 用語の定義"]);
});

test("番号の飛びと親のない見出しを report に出す（目次が読めないとき）", () => {
  const { report } = splitSections(
    lines([
      [1, "head", "1 総則"],
      [1, "body", "あ"],
      [1, "head", "3 適用範囲"],
      [1, "body", "い"],
      [1, "head", "8.4.2 委託先の管理"],
      [1, "body", "う"],
    ]),
  );
  assert.equal(report.gaps.length, 2); // 1 -> 3 と、8.4.2 が 8.4 の 1 番目でない
  assert.deepEqual(report.orphans, ["8.4.2 (親 8.4 がない)"]);
});

test("最初の見出しより前の行は捨てて report に残す", () => {
  const { sections, report } = splitSections(
    lines([
      [1, "body", "医療情報システムの安全管理に関するガイドライン"],
      [1, "body", "令和8年6月"],
      [2, "head", "1 総則"],
      [2, "body", "本文。"],
    ]),
  );
  assert.equal(sections.length, 1);
  assert.equal(report.preamble.length, 2);
});

test("見出しに見えて取れなかった行を report に出す（正規表現を直す手がかり）", () => {
  const { report } = splitSections(
    lines([
      [1, "head", "1 総則"],
      [1, "body", "第2章 医療機関等の責務"],
      [1, "body", "(3) 認証方式の選択"],
      // ①②③ は【遵守事項】の箇条書きで見出しではない。候補に挙げない（原本で確認済み）
      [1, "body", "① 多要素認証を用いること。"],
      [1, "body", "これは普通の本文である。"],
    ]),
  );
  assert.deepEqual(report.headingLike.map((h) => h.text), [
    "第2章 医療機関等の責務",
    "(3) 認証方式の選択",
  ]);
});

test("全角の見出し番号を、区切りなしでも半角の id にして取る", () => {
  // 原本の形。"１．" は末尾に句点があり、"１．１" 以下は番号と見出しが地続き
  const { sections } = splitSections(
    lines([
      [1, "head", "１．情報セキュリティの基本的な考え方[Ⅰ～Ⅳ]"],
      [1, "body", "【遵守事項】"],
      [1, "head", "１．１安全管理に関する法制度等による要求事項"],
      [1, "body", "システム運用担当者は、技術的対策を講じる必要がある。"],
      [2, "head", "７．２．１医療機関等の職員による外部からのアクセス"],
      [2, "body", "本文。"],
    ]),
  );
  assert.deepEqual(sections.map((s) => s.num), ["1", "1.1", "7.2.1"]);
  // id は半角に寄せるが、見出しの文言は原文ママ
  assert.equal(sections[0]!.title, "情報セキュリティの基本的な考え方[Ⅰ～Ⅳ]");
  assert.equal(sections[2]!.title, "医療機関等の職員による外部からのアクセス");
});

test("目次のページ番号が -3- の形でも目次行として落とす", () => {
  const { sections, report } = splitSections(
    lines([
      [1, "body", "１．情報セキュリティの基本的な考え方[Ⅰ～Ⅳ]..................................................-3-"],
      [1, "body", "１．１安全管理に関する法制度等による要求事項..............................................................-3-"],
      [2, "head", "１．情報セキュリティの基本的な考え方[Ⅰ～Ⅳ]"],
      [2, "body", "本文。"],
    ]),
  );
  assert.deepEqual(sections.map((s) => s.num), ["1"]);
  assert.equal(report.tocLines, 2);
});

test("既定の見出し正規表現は本文中の数値表現を拾わない", () => {
  for (const s of [
    "3.11 の規定による",
    "第7.0版において",
    "2025 年 3 月に改定された",
  ]) {
    const m = DEFAULT_HEADING.exec(s);
    // 拾ってしまう形があるなら、それは実データで確認して直す前提の既知の穴。
    if (m) assert.fail(`本文を見出しとして拾った: ${s} -> ${m[1]}`);
  }
});

test("minHeadingSize でフォントサイズの小さい行を見出しから外せる", () => {
  const src: Line[] = [
    { text: "4 運用管理", page: 1, size: 14, yRatio: 0.5, gap: 0 },
    { text: "4.9 これは本文中の列挙", page: 1, size: 10.5, yRatio: 0.5, gap: 0 },
  ];
  const off = splitSections(src);
  assert.equal(off.sections.length, 2);

  const on = splitSections(src, { minHeadingSize: 12 });
  assert.deepEqual(on.sections.map((s) => s.num), ["4"]);
  assert.equal(on.sections[0]!.lines.length, 1);
  assert.equal(on.report.headingLike.length, 1);
});

test("本文の先頭行の高さにある繰り返しは柱と見なさない", () => {
  // 帯の外（0.88）なら、何ページに出ても本文として残す
  const src: Line[] = [{ text: "1 総則", page: 1, size: 14, yRatio: 0.95, gap: 0 }];
  for (let p = 1; p <= 10; p++) {
    src.push({ text: "各項の冒頭に置かれる定型文。", page: p, size: 10.5, yRatio: 0.88, gap: 0 });
  }
  const { sections, report } = splitSections(src);
  assert.equal(report.boilerplate.length, 0);
  assert.equal(sections[0]!.lines.length, 10);
});

test("hugeSectionChars を超える章節を report に出す", () => {
  const { report } = splitSections(
    lines([
      [1, "head", "1 総則"],
      [1, "body", "あ".repeat(500)],
    ]),
    { hugeSectionChars: 100 },
  );
  assert.deepEqual(report.hugeSections, [{ num: "1", chars: 500 }]);
});

test("目次で裏が取れていれば、番号と見出しの間が空いた章見出しも取る", () => {
  // 原本の章見出しは "１．" と見出しの間が 2em 空いていて、表の行と間隔では区別できない
  const { sections } = splitSections([
    { text: "１．情報セキュリティの基本的な考え方[Ⅰ～Ⅳ]..............-3-", page: 2, size: 12, yRatio: 0.8, gap: 2.0 },
    { text: "１．１安全管理に関する法制度等による要求事項..............-3-", page: 2, size: 11, yRatio: 0.75, gap: 1.0 },
    { text: "２．システム設計・運用に必要な規程類と文書体系..............-4-", page: 2, size: 12, yRatio: 0.7, gap: 1.0 },
    { text: "１．情報セキュリティの基本的な考え方[Ⅰ～Ⅳ]", page: 9, size: 12, yRatio: 0.9, gap: 2.0 },
    { text: "本文。", page: 9, size: 10.6, yRatio: 0.85, gap: 0 },
  ]);
  assert.deepEqual(sections.map((s) => s.num), ["1"]);
  assert.equal(sections[0]!.page, 9);
});

test("表の行（列が 1 行に束ねられたもの）は見出しにも本文にもしない", () => {
  // 原本の表: "５．安全管理におけるエビデンス" と隣の列の "約等に含まれている場" が 1 行になる
  const { sections, report } = splitSections([
    { text: "3 本ガイドラインの読み方", page: 8, size: 12, yRatio: 0.9, gap: 0 },
    { text: "各編の参照箇所を表３－２に示す。", page: 8, size: 10.6, yRatio: 0.88, gap: 0 },
    { text: "５．安全管理におけるエビデンス約等に含まれている場", page: 8, size: 10.6, yRatio: 0.63, gap: 5.1 },
    { text: "１５．技術的な対策の管理合は、簡略化が可能。", page: 8, size: 10.6, yRatio: 0.61, gap: 8.1 },
  ]);
  assert.deepEqual(sections.map((s) => s.num), ["3"]);
  assert.equal(sections[0]!.lines.length, 1);
  assert.equal(sections[0]!.tableLines, 2);
  assert.equal(report.tableLines.length, 2);
});
