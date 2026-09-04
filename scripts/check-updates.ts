/**
 * 掲載ページを見て、同梱データが古くなっていないかを見る。
 * 差分があれば exit 1。CI はこれを見て Issue を立てる。
 *
 * ハッシュだけ見ると「どの編が動いたか」が分からないので、
 * 掲載ページ上のリンク集合と、ファイル単位のハッシュの両方を比較する。
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DATA = new URL("../data/", import.meta.url).pathname;
type Doc = { key: string; url: string; sha256: string | null };
type Guideline = { id: string; landingPage: string; documents: Doc[]; checklists: Doc[] };

const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

/** 素の Node の UA だと弾く配信基盤があるので、名乗る。fetch.ts と同じ。 */
const UA = "jp-medical-guidelines-mcp/0.1 (+https://github.com/toru-oizumi/jp-medical-guidelines-mcp)";

const findings: string[] = [];

for (const g of sources.guidelines) {
  const known = new Set([...g.documents, ...g.checklists].map((d) => d.url));

  const page = await fetch(g.landingPage, { headers: { "user-agent": UA } });
  if (!page.ok) {
    // 取れなかった HTML をそのまま突き合わせると、全ファイルが「消えた」ことになる
    findings.push(`[${g.id}] 掲載ページが取得できない: ${page.status} ${g.landingPage}`);
    continue;
  }
  const html = await page.text();
  const linked = new Set(
    [...html.matchAll(/href="([^"]+\.(?:pdf|xlsx))"/gi)].map((m) =>
      new URL(m[1]!, g.landingPage).href,
    ),
  );
  if (linked.size === 0) {
    findings.push(`[${g.id}] 掲載ページに PDF/Excel のリンクが 1 つもない（構成が変わった可能性）`);
    continue;
  }

  for (const url of linked) {
    if (!known.has(url) && /(?:content|healthcare)\//.test(url)) {
      findings.push(`[${g.id}] 掲載ページに未追跡のファイル: ${url}`);
    }
  }
  for (const url of known) {
    if (!linked.has(url)) findings.push(`[${g.id}] 掲載ページから消えた: ${url}`);
  }

  for (const doc of [...g.documents, ...g.checklists]) {
    if (!doc.sha256) continue;
    const res = await fetch(doc.url, { headers: { "user-agent": UA } });
    if (!res.ok) {
      findings.push(`[${g.id}/${doc.key}] 取得できない: ${res.status}`);
      continue;
    }
    const sha = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    if (sha !== doc.sha256) findings.push(`[${g.id}/${doc.key}] 内容が変わった: ${doc.url}`);
  }
}

if (findings.length === 0) {
  console.log("差分なし");
  process.exit(0);
}
console.log(findings.join("\n"));
process.exit(1);
