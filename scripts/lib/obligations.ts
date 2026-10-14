/**
 * 【遵守事項】の枠が無いガイドライン（総務省・経産省 GL）から、義務を表す文を機械的に抜き出す。
 *
 * 文末の表現だけで判定する推定であり、公式の遵守事項ではない。
 * - must:        「〜すること。」「〜しなければならない。」
 * - should:      「〜べきである。」「〜必要がある。」「〜求められる。」
 * - recommended: 「〜が望ましい。」
 */

export type ObligationLevel = "must" | "should" | "recommended";

export interface ExtractedObligation {
  /** 節の中の通し番号（"o1"…）。id は「節 id#o1」 */
  no: string;
  level: ObligationLevel;
  /** 文の主語として読み取れたもの。読み取れなければ null */
  subject: "対象事業者" | "医療機関等" | null;
  text: string;
}

/** 1 文がこれより長いものは、図表の文字が混ざった可能性が高いので採らない */
const MAX_SENTENCE = 400;
/** これより短いものは、改ページ・図表で切れた断片（「用管理規程に含めること。」等）とみなす */
const MIN_SENTENCE = 15;
/** 文頭に来てよいひらがな始まりの語。これ以外のひらがなで始まる文は断片とみなす */
const HIRAGANA_STARTERS =
  /^(?:なお|また|さらに|ただし|しかし|しかしながら|したがって|そのため|このため|ついては|あるいは|もしくは|かつ|この|その|これ|それ|あらかじめ|いずれ|あわせて|まず|つまり|すなわち|もっとも|ここ|そこ|こうした|そうした|どの|いかなる)/;

/** 括弧の中の「。」では切らずに文に分ける */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let depth = 0;
    let buf = "";
    for (const ch of para) {
      buf += ch;
      if ("「『（(［[【".includes(ch)) depth++;
      else if ("」』）)］]】".includes(ch)) depth = Math.max(0, depth - 1);
      else if (ch === "。" && depth === 0) {
        out.push(buf.trim());
        buf = "";
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter((s) => s.length > 0);
}

/**
 * 義務文の候補にしない文。改ページ・図表で切れた断片と、引用の中の文
 * （「。」の直後に閉じ括弧が来る＝開き括弧が前の断片にあった）を除く。
 */
export function isFragment(sentence: string, next: string | undefined): boolean {
  if (sentence.length < MIN_SENTENCE || sentence.length > MAX_SENTENCE) return true;
  if (/^[ぁ-ゖ]/.test(sentence) && !HIRAGANA_STARTERS.test(sentence)) return true;
  if (next && /^[」』）)]/.test(next)) return true;
  return false;
}

export function classify(sentence: string): ObligationLevel | null {
  const s = sentence.replace(/[。\s]+$/, "");
  if (/(?:という|ことが(?:でき|あ)る|ものとする)こと$/.test(s)) return null;
  if (/(?:しなければならない|ねばならない|こと)$/.test(s)) return "must";
  if (/(?:べきである|べき|必要がある|必要である|求められる)$/.test(s)) return "should";
  if (/望ましい$/.test(s)) return "recommended";
  return null;
}

/** 主題の「は」を優先し、無ければ「が」で、文中で先に出てくる方を主語とみなす */
export function subjectOf(sentence: string): ExtractedObligation["subject"] {
  for (const particle of ["は", "が"]) {
    const vendor = sentence.search(new RegExp(`対象事業者[A-Z]?${particle}`));
    const provider = sentence.search(new RegExp(`医療機関等${particle}`));
    if (vendor < 0 && provider < 0) continue;
    if (provider < 0 || (vendor >= 0 && vendor < provider)) return "対象事業者";
    return "医療機関等";
  }
  return null;
}

export function extractObligations(text: string): ExtractedObligation[] {
  const out: ExtractedObligation[] = [];
  const sentences = splitSentences(text);
  for (const [i, sentence] of sentences.entries()) {
    if (isFragment(sentence, sentences[i + 1])) continue;
    const level = classify(sentence);
    if (!level) continue;
    out.push({ no: `o${out.length + 1}`, level, subject: subjectOf(sentence), text: sentence });
  }
  return out;
}
