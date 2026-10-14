/** sources.json の guidelines[].id。例: "mhlw-6.0" / "mic-meti-2.0" */
export type GuidelineId = string;

/**
 * 遵守事項・章節の 1 単位。
 * id は見出し番号ベース（ページ番号は改定で動くため id には使わない）。
 * 例: "mhlw-6.0/operations/4.2.1"
 */
export interface Section {
  id: string;
  guideline: GuidelineId;
  edition: string;
  /** 編（概説編・経営管理編・…）。提供事業者GLは "本編" */
  book: string;
  /** 見出しの階層。例: ["4", "4.2", "4.2.1"] の見出し文字列 */
  headingPath: string[];
  heading: string;
  /**
   * 見出し番号を目次の並びから補ったもの。総務省・経産省 GL は章番号等がテキスト層に無いため。
   * 機械的な推定なので、番号を引用するときは原本の表示を確認すること。
   */
  numberInferred?: boolean;
  text: string;
  /** 【遵守事項】の ①②… を 1 項目ずつ。遵守事項の無い節は空配列 */
  requirements: RequirementData[];
  /**
   * 【遵守事項】の枠が無いガイドライン（総務省・経産省 GL）で、文末表現から機械的に抜き出した義務文。
   * 公式の遵守事項ではない。抜き出しを行わないガイドラインでは undefined
   */
  obligations?: ObligationData[];
  /** 原本 PDF のページ（1 始まり、抽出時点の参考値） */
  page: number | null;
  sourceUrl: string;
}

export interface ChecklistItem {
  id: string;
  guideline: GuidelineId;
  target: "hospital" | "vendor";
  /** チェックリストの大分類 */
  category: string;
  /** 確認項目の本文 */
  item: string;
  note: string | null;
  sourceUrl: string;
}

export interface SearchHit {
  id: string;
  guideline: GuidelineId;
  book: string;
  heading: string;
  /** 一致箇所の抜粋（原文ママ） */
  quote: string;
  score: number;
  /** 検索語を含む遵守事項の id（例 "mhlw-6.0/operations/3#2"） */
  matchedRequirements: string[];
  /** 検索語を含む義務文の id（例 "mic-meti-2.0/main/4.4#o1"） */
  matchedObligations: string[];
  sourceUrl: string;
  page: number | null;
}

/** data/sections に保存する遵守事項 1 項目 */
export interface RequirementData {
  /**
   * 丸数字の番号（①→"1"）。＜説明責任＞ などのグループごとに番号が振り直される節では
   * 「グループの出現順.番号」（例 "2.1"）
   */
  no: string;
  /** グループ見出し（例 "＜管理責任＞"）。無ければ null */
  group: string | null;
  /** 原文。下位リスト（(1)・a・－ 等）は改行で区切る */
  text: string;
}

/** 遵守事項 1 項目。id は「節 id + # + no」（例 "mhlw-6.0/operations/3#2"） */
export interface Requirement extends RequirementData {
  id: string;
}

/**
 * 文末表現による義務の強さ。
 * must=「〜すること」「〜しなければならない」、should=「〜べきである」「〜必要がある」「〜求められる」、
 * recommended=「〜が望ましい」
 */
export type ObligationLevel = "must" | "should" | "recommended";

/** data/sections に保存する義務文 1 件 */
export interface ObligationData {
  /** 節の中の通し番号（"o1"…） */
  no: string;
  level: ObligationLevel;
  /** 文の主語として読み取れたもの */
  subject: "対象事業者" | "医療機関等" | null;
  text: string;
}

/** 義務文 1 件。id は「節 id + # + no」（例 "mic-meti-2.0/main/4.4#o1"） */
export interface Obligation extends ObligationData {
  id: string;
}
