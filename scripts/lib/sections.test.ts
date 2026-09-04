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

test("同じ番号が 2 回出たら本文が長い方を残し、report に出す", () => {
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

test("番号の飛びと親のない見出しを report に出す", () => {
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
      [1, "body", "4.2.1リモートアクセス"],
      [1, "body", "(3) 認証方式の選択"],
      [1, "body", "① 多要素認証を用いること。"],
      [1, "body", "これは普通の本文である。"],
    ]),
  );
  const texts = report.headingLike.map((h) => h.text);
  assert.deepEqual(texts, [
    "第2章 医療機関等の責務",
    "4.2.1リモートアクセス",
    "(3) 認証方式の選択",
    "① 多要素認証を用いること。",
  ]);
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
    { text: "4 運用管理", page: 1, size: 14, yRatio: 0.5 },
    { text: "4.9 これは本文中の列挙", page: 1, size: 10.5, yRatio: 0.5 },
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
  const src: Line[] = [{ text: "1 総則", page: 1, size: 14, yRatio: 0.95 }];
  for (let p = 1; p <= 10; p++) {
    src.push({ text: "各項の冒頭に置かれる定型文。", page: p, size: 10.5, yRatio: 0.88 });
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
