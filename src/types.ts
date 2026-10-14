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
  requirements: string[];
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
  sourceUrl: string;
  page: number | null;
}
