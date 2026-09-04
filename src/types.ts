export type GuidelineId = "mhlw-7.0" | "mic-meti-2.0";

/**
 * 遵守事項・章節の 1 単位。
 * id は見出し番号ベース（ページ番号は改定で動くため id には使わない）。
 * 例: "mhlw-7.0/operations/4.2.1"
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
  text: string;
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
