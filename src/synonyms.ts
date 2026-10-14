/**
 * 検索語の言い換え。ガイドラインの用語と、利用者が使いがちな語のずれを埋める。
 * 言い換え先は原文に実際に出てくる語に限る（出てこない語を足しても当たらない）。
 *
 * キーは正規化（NFKC・小文字・空白除去）後の語。
 */
const GROUPS: { from: string[]; to: string[] }[] = [
  // 原文は「外部からのアクセス」「テレワーク」と書き、「リモートアクセス」は使っていない
  { from: ["リモートアクセス", "リモート接続"], to: ["外部からのアクセス", "テレワーク", "外部から接続"] },
  { from: ["多要素認証", "二要素認証", "2要素認証", "mfa", "2fa"], to: ["多要素認証", "二要素認証"] },
  { from: ["マルウェア"], to: ["不正ソフトウェア", "ウイルス"] },
  { from: ["パッチ", "パッチ適用"], to: ["アップデート"] },
  { from: ["bcp", "事業継続計画"], to: ["bcp", "事業継続計画"] },
  { from: ["ログ", "アクセスログ"], to: ["証跡"] },
];

const MAP = new Map<string, string[]>();
for (const g of GROUPS) {
  for (const f of g.from) MAP.set(norm(f), [...new Set([...(MAP.get(norm(f)) ?? []), ...g.to.map(norm)])]);
}

/** 語とその言い換え（自分自身を先頭に含む） */
export function expand(term: string): string[] {
  return [...new Set([term, ...(MAP.get(term) ?? [])])];
}

function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}
