/**
 * data/sources.json に並んだ原本を data/raw/ に取得し、SHA-256 を sources.json に書き戻す。
 * ハッシュは「同梱データがどの版から作られたか」の唯一の証跡なので、必ず更新すること。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA = new URL("../data/", import.meta.url).pathname;
const RAW = join(DATA, "raw");

type Doc = { key: string; url: string; sha256: string | null; kind?: string };
type Guideline = { id: string; documents: Doc[]; checklists: Doc[] };

const sources = JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")) as {
  guidelines: Guideline[];
};

await mkdir(RAW, { recursive: true });

for (const g of sources.guidelines) {
  for (const doc of [...g.documents, ...g.checklists]) {
    const ext = doc.url.endsWith(".xlsx") ? "xlsx" : "pdf";
    const dest = join(RAW, `${g.id}__${doc.key}.${ext}`);

    const res = await fetch(doc.url);
    if (!res.ok) throw new Error(`${res.status} ${doc.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);

    const sha = createHash("sha256").update(buf).digest("hex");
    if (doc.sha256 && doc.sha256 !== sha) {
      console.warn(`! ${g.id}/${doc.key}: ハッシュが変わっています（改定の可能性）`);
      console.warn(`  old=${doc.sha256}`);
      console.warn(`  new=${sha}`);
    }
    doc.sha256 = sha;
    console.log(`${g.id}/${doc.key}  ${(buf.length / 1024).toFixed(0)}KB  ${sha.slice(0, 12)}`);
  }
}

(sources as Record<string, unknown>)["fetchedAt"] = new Date().toISOString();
await writeFile(join(DATA, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
