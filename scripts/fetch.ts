/**
 * data/sources.json に並んだ原本を data/raw/ に取得し、SHA-256 を sources.json に書き戻す。
 * ハッシュは「同梱データがどの版から作られたか」の唯一の証跡なので、必ず更新すること。
 *
 *   npm run fetch
 *   npx tsx scripts/fetch.ts --only=operations   # 1 ファイルだけ取り直す
 *
 * 1 本落ちても残りは続ける（省サイトは単発で落ちることがある）。最後に落ちた分をまとめて出し、
 * exit 1 にする。取得できなかったファイルのハッシュは触らない。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA = new URL("../data/", import.meta.url).pathname;
const RAW = join(DATA, "raw");

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.slice(7);

/** 素の Node の UA だと弾く配信基盤があるので、名乗る。 */
const UA = "jp-medical-guidelines-mcp/0.1 (+https://github.com/toru-oizumi/jp-medical-guidelines-mcp)";
const ATTEMPTS = 4;

/**
 * 待っても変わらない失敗。リトライせずに投げる。
 * このファイルは top-level await を使うので、クラスは実行より前に置く（初期化されていないと TDZ になる）。
 */
class Fatal extends Error {}

type Doc = { key: string; url: string; sha256: string | null; kind?: string };
type Guideline = { id: string; documents: Doc[]; checklists: Doc[] };

const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

await mkdir(RAW, { recursive: true });

const failures: string[] = [];
const changed: string[] = [];
let fetched = 0;

for (const g of sources.guidelines) {
  for (const doc of [...g.documents, ...g.checklists]) {
    const label = `${g.id}/${doc.key}`;
    if (only && !label.includes(only)) continue;

    const ext = doc.url.endsWith(".xlsx") ? "xlsx" : "pdf";
    const dest = join(RAW, `${g.id}__${doc.key}.${ext}`);

    let buf: Buffer;
    try {
      buf = await download(doc.url);
    } catch (e) {
      failures.push(`${label}: ${(e as Error).message}`);
      console.warn(`x ${label}  ${(e as Error).message}`);
      continue;
    }

    await writeFile(dest, buf);
    fetched++;

    const sha = createHash("sha256").update(buf).digest("hex");
    if (doc.sha256 && doc.sha256 !== sha) {
      changed.push(`${label}\n    old=${doc.sha256}\n    new=${sha}`);
    }
    doc.sha256 = sha;
    console.log(`${label}  ${(buf.length / 1024).toFixed(0)}KB  ${sha.slice(0, 12)}`);
  }
}

if (fetched > 0) {
  (sources as Record<string, unknown>)["fetchedAt"] = new Date().toISOString();
  await writeFile(join(DATA, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
}

if (changed.length) {
  console.warn(`\n! ハッシュが変わっています（改定の可能性）。原本の版と公表日を確認してください:`);
  for (const c of changed) console.warn(`  ${c}`);
}

if (failures.length) {
  console.error(`\n${failures.length} 件取得できませんでした:`);
  for (const f of failures) console.error(`  ${f}`);
  if (failures.some((f) => /403|fetch failed|ECONN|EPROTO|tunnel|proxy/i.test(f))) {
    console.error(
      `\n403 は配信側の拒否と、社内プロキシ・サンドボックスの egress ポリシーの両方で出ます。` +
        `\n後者ならここでは通せません。ローカルで取得するか、原本を手で data/raw/ に置いてください。` +
        `\n  ファイル名: <guideline-id>__<key>.<pdf|xlsx>  例 mhlw-7.0__operations.pdf`,
    );
  }
  process.exit(1);
}

/** 転送中の切断も含めて、一時的な失敗だけリトライする。403/404 は即あきらめる。 */
async function download(url: string): Promise<Buffer> {
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const status = `${res.status} ${res.statusText}`.trim();
      if (!retriable(res.status)) throw new Fatal(status);
      last = status;
    } catch (e) {
      if (e instanceof Fatal) throw new Error(e.message);
      last = (e as Error).message;
    }
    if (attempt < ATTEMPTS) await sleep(2000 * 2 ** (attempt - 1));
  }
  throw new Error(`${last} (${ATTEMPTS} 回試行)`);
}

function retriable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
