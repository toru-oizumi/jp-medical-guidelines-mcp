import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSections,
  type Line,
  numberEntries,
  parseToc,
  splitNumber,
  splitRequirements,
  titlesMatch,
  toParagraphs,
  tocPages,
} from "../scripts/lib/structure.js";

const L = (page: number, y: number, x: number, h: number, text: string): Line => ({ page, y, x, h, text });

describe("splitNumber", () => {
  it("全角・半角混在や末尾ドットの揺れを吸収する", () => {
    assert.deepEqual(splitNumber("１．1．１医療情報システム"), { num: "1.1.1", rest: "医療情報システム" });
    assert.deepEqual(splitNumber("３．２．医療機関等"), { num: "3.2", rest: "医療機関等" });
    assert.deepEqual(splitNumber("1.1.本ガイドライン"), { num: "1.1", rest: "本ガイドライン" });
    assert.deepEqual(splitNumber("１０．医療情報システム"), { num: "10", rest: "医療情報システム" });
  });

  it("番号部分を除いた残りは原文（NFKC 前）のまま返す", () => {
    assert.equal(splitNumber("２．規程類[Ⅰ～Ⅳ]").rest, "規程類[Ⅰ～Ⅳ]");
  });

  it("本文の数字を番号と読まない", () => {
    assert.equal(splitNumber("15年法律第57号").num, null);
    assert.equal(splitNumber("1社で提供するケース").num, null);
    assert.equal(splitNumber("2023年10月").num, null);
  });
});

describe("numberEntries", () => {
  it("番号が描画のみの章は字下げから章とみなし、番号を補う（総務省 GL 型）", () => {
    const toc = numberEntries([
      { text: "本ガイドラインの基本方針", x: 117, h: 12 },
      { text: "1.1.本ガイドライン策定の経緯", x: 96, h: 11 },
      { text: "医療情報に関する法整備", x: 159, h: 11 },
      { text: "医療情報安全管理ガイドライン", x: 159, h: 11 },
      { text: "1.2.本ガイドラインの策定方針", x: 96, h: 11 },
      { text: "本ガイドラインの対象", x: 117, h: 12 },
      { text: "2.1.対象とする医療情報", x: 96, h: 11 },
      { text: "用語集", x: 85, h: 12 },
    ]);
    assert.deepEqual(
      toc.map((e) => [e.num, e.level, e.numberInferred]),
      [
        ["1", 1, true],
        ["1.1", 2, false],
        ["1.1.1", 3, true],
        ["1.1.2", 3, true],
        ["1.2", 2, false],
        ["2", 1, true],
        ["2.1", 2, false],
        ["appendix-1", 1, false],
      ],
    );
  });

  it("番号付きの章の前にある前付は 0、後ろは付録（厚労省 GL 型）", () => {
    const toc = numberEntries([
      { text: "【はじめに】", x: 57, h: 12 },
      { text: "１．情報セキュリティの基本的な考え方", x: 57, h: 12 },
      { text: "１．１安全管理に関する法制度等", x: 67, h: 11 },
      { text: "e-文書法対応に求められる技術的対策", x: 57, h: 12 },
    ]);
    assert.deepEqual(
      toc.map((e) => e.num),
      ["0", "1", "1.1", "appendix-1"],
    );
  });
});

describe("parseToc", () => {
  it("リーダーの形式の違いと折り返しを扱う", () => {
    const lines = [
      L(2, 750, 282, 16, "目次"),
      L(2, 700, 57, 12, "１．はじめに..........................-1-"),
      L(2, 680, 67, 11, "６．１システムアーキテクチャ（クライアント側、インフ"),
      L(2, 670, 67, 11, "ラ、セキュリティ）.................-14-"),
      L(2, 660, 57, 12, "５．システム設計の見直し[Ⅰ、Ⅲ]..-12-"),
      L(2, 33, 296, 11, "i"),
    ];
    const toc = parseToc(lines, tocPages(lines));
    assert.deepEqual(
      toc.map((e) => [e.num, e.title]),
      [
        ["1", "はじめに"],
        ["6.1", "システムアーキテクチャ(クライアント側、インフラ、セキュリティ)"],
        ["5", "システム設計の見直し[I、III]"],
      ],
    );
  });
});

describe("titlesMatch", () => {
  it("短い見出しは長さの許容を狭くする（「リスク対応」と「リスク対応策の設計」を混同しない）", () => {
    assert.equal(titlesMatch("リスク対応策の設計", "リスク対応"), false);
    assert.equal(titlesMatch("リスク対応", "リスク対応"), true);
  });

  it("見出しらしい行なら目次との表記揺れを bigram の包含率で許す", () => {
    const want = "医療情報安全管理ガイドライン";
    const got = "医療情報システムの安全管理に関するガイドライン";
    assert.equal(titlesMatch(got, want), false);
    assert.equal(titlesMatch(got, want, { strong: true }), true);
    assert.equal(titlesMatch(got, want, { strong: true, strict: true }), false);
  });
});

describe("toParagraphs / splitRequirements", () => {
  const lines = [
    L(9, 735, 62, 11, "【遵守事項】"),
    L(9, 718, 73, 11, "①法令上求められる要件等について、企画管理者の整理に基づい"),
    L(9, 700, 83, 11, "て、必要な技術的な対応を抽出すること。"),
    L(9, 683, 73, 11, "②資料を整備すること。"),
    L(9, 645, 67, 11, "システム運用担当者は、技術的対策を講じる際、法制度により求められる"),
    L(9, 627, 57, 11, "技術的な対応を行う必要がある。"),
  ];

  it("ぶら下げインデントと字下げを区別して段落にする", () => {
    assert.equal(
      toParagraphs(lines),
      [
        "【遵守事項】",
        "①法令上求められる要件等について、企画管理者の整理に基づいて、必要な技術的な対応を抽出すること。",
        "②資料を整備すること。",
        "システム運用担当者は、技術的対策を講じる際、法制度により求められる技術的な対応を行う必要がある。",
      ].join("\n"),
    );
  });

  it("遵守事項を 1 項目ずつ取り出し、後続の解説は含めない", () => {
    assert.deepEqual(splitRequirements(toParagraphs(lines)), [
      "①法令上求められる要件等について、企画管理者の整理に基づいて、必要な技術的な対応を抽出すること。",
      "②資料を整備すること。",
    ]);
  });
});

describe("buildSections", () => {
  const lines = [
    L(1, 600, 100, 18, "表紙"),
    L(2, 750, 282, 16, "目次"),
    L(2, 700, 57, 12, "１．責任分界[Ⅰ～Ⅳ]..............-1-"),
    L(2, 680, 67, 11, "１．１リスク対応..................-1-"),
    L(2, 660, 67, 11, "１．２保守時の対策（事業者が外部からアクセスしてｋ等を行う場合）......-2-"),
    L(2, 640, 57, 12, "２．認証..........................-2-"),
    L(3, 763, 57, 12, "１．責任分界[Ⅰ～Ⅳ]"),
    L(3, 735, 62, 11, "【遵守事項】"),
    L(3, 718, 73, 11, "①確認すること。"),
    L(3, 680, 57, 11, "１．１リスク対応"),
    L(3, 660, 67, 11, "15年法律第57号に基づく。"),
    L(3, 640, 57, 11, "リスク対応策の設計は本文であって見出しではない。"),
    L(3, 33, 288, 11, "- 1 -"),
    L(4, 763, 57, 11, "１．２保守時の対策（事業者が外部からアクセスして保"),
    L(4, 745, 57, 11, "守等を行う場合）"),
    L(4, 720, 67, 11, "本文。"),
    L(4, 700, 57, 12, "２．認証"),
    L(4, 680, 67, 11, "本文2。"),
    L(4, 33, 288, 11, "- 2 -"),
  ];

  it("目次の見出しを本文で順に照合し、階層・遵守事項・ページを付ける", () => {
    const toc = parseToc(lines, tocPages(lines));
    const { sections, report } = buildSections(lines, toc);
    assert.deepEqual(report.unmatched, []);
    assert.deepEqual(
      sections.map((s) => [s.num, s.page, s.path.length]),
      [
        ["1", 3, 1],
        ["1.1", 3, 2],
        ["1.2", 4, 2],
        ["2", 4, 1],
      ],
    );
    assert.equal(sections[0]!.heading, "1 責任分界[Ⅰ～Ⅳ]");
    assert.deepEqual(sections[0]!.requirements, ["①確認すること。"]);
    assert.match(sections[1]!.text, /15年法律第57号/);
    assert.match(sections[1]!.text, /リスク対応策の設計は本文/);
    assert.doesNotMatch(sections[1]!.text, /- 1 -/);
    // 見出しは本文側の原文（折り返しを結合したもの）を採る
    assert.equal(sections[2]!.heading, "1.2 保守時の対策（事業者が外部からアクセスして保守等を行う場合）");
    assert.equal(sections[2]!.text, "本文。");
  });
});
