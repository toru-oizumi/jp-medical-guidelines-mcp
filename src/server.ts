import { readFileSync } from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { obligationsOf, requirementsOf, Store } from "./store.js";

const DISCLAIMER =
  "本ツールが返すのは公開ガイドラインの該当箇所です。準拠の可否を判定するものではありません。" +
  "最終的な確認は source_url の原本 PDF で行ってください。";

const OBLIGATION_NOTE =
  "obligations は【遵守事項】の枠が無いガイドラインについて、文末表現（〜すること／〜べきである／〜が望ましい 等）から" +
  "機械的に抜き出した文です。公式の遵守事項ではなく、抜き漏れ・誤りがあり得ます。";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export async function createServer(store?: Store): Promise<McpServer> {
  store ??= await Store.load();

  const ids = store.guidelines.map((g) => g.id);
  // 収録しているガイドラインは data/ の中身で決まる。空のときに z.enum([]) は作れないので string に落とす
  const guidelineArg = (ids.length > 0 ? z.enum(ids as [string, ...string[]]) : z.string()).describe(
    `ガイドライン id。収録: ${ids.join(", ") || "(なし)"}`,
  );
  const covered = store.guidelines
    .map((g) => `${g.id}: ${g.publisher}「${g.title}」第${g.edition}版`)
    .join(" / ");

  const server = new McpServer(
    { name: "jp-medical-guidelines-mcp", version: pkg.version },
    {
      instructions:
        "日本の医療情報に関する「3省2ガイドライン」の本文を引くサーバ。" +
        `収録: ${covered || "(データ未生成)"}。` +
        "回答には必ず条項 id と source_url を添えること。準拠可否の判断はこのサーバの役割ではない。",
    },
  );

  server.registerTool(
    "list_sections",
    {
      title: "目次を返す",
      description: "ガイドラインの編・章立てを一覧する。どの編を掘るか決めるために最初に呼ぶ。",
      inputSchema: {
        guideline: guidelineArg.optional(),
        depth: z.number().int().min(1).max(4).default(2).describe("何階層目まで返すか"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guideline, depth }) => {
      const books = new Map<string, { guideline: string; book: string; headings: string[] }>();
      for (const s of store.sections) {
        if (guideline && s.guideline !== guideline) continue;
        const key = `${s.guideline}/${s.book}`;
        let b = books.get(key);
        if (!b) books.set(key, (b = { guideline: s.guideline, book: s.book, headings: [] }));
        if (s.headingPath.length <= depth) b.headings.push(`${s.id}  ${s.heading}`);
      }
      return text({ guidelines: store.guidelines, books: [...books.values()] });
    },
  );

  server.registerTool(
    "search_requirements",
    {
      title: "遵守事項を検索する",
      description:
        "キーワードで該当する遵守事項・章節を引く。返り値には原文の抜粋(quote)と出典(source_url)が入る。" +
        "回答を書くときは quote をそのまま引用し、source_url を必ず併記すること。",
      inputSchema: {
        query: z.string().describe("例: 外部委託 責任分界 / リモートアクセス 認証 / バックアップ 世代管理"),
        guideline: guidelineArg.optional(),
        book: z.string().optional().describe("編で絞る。例: システム運用編"),
        k: z.number().int().min(1).max(30).default(8),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, guideline, book, k }) =>
      text({ disclaimer: DISCLAIMER, hits: store.search(query, { guideline, book, k }) }),
  );

  server.registerTool(
    "get_requirement",
    {
      title: "条項を取得する",
      description:
        "条項 id を指定して本文を取得する。search_requirements の結果を掘るときに使う。" +
        "requirements には【遵守事項】が 1 項目ずつ id 付きで入る。" +
        "総務省・経産省 GL には【遵守事項】の枠が無く、代わりに obligations（文末表現から機械的に抜き出した義務文）が入る。" +
        "1 項目だけを引くときは id に「#番号」を付ける（例: mhlw-6.0/operations/3#2、mic-meti-2.0/main/4.4#o1）。",
      inputSchema: { id: z.string().describe('例: "mhlw-6.0/operations/3" / "mhlw-6.0/operations/3#2"') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      if (id.includes("#")) {
        const r = store.getItem(id);
        if (!r) return text({ error: `not found: ${id}` }, true);
        return text({
          kind: r.kind,
          ...r.item,
          section: r.section.id,
          guideline: r.section.guideline,
          book: r.section.book,
          heading: r.section.heading,
          sourceUrl: r.section.sourceUrl,
          page: r.section.page,
          disclaimer: r.kind === "obligation" ? `${DISCLAIMER}${OBLIGATION_NOTE}` : DISCLAIMER,
        });
      }
      const s = store.get(id);
      if (!s) return text({ error: `not found: ${id}` }, true);
      return text({
        ...s,
        requirements: requirementsOf(s),
        ...(s.obligations ? { obligations: obligationsOf(s) } : {}),
        disclaimer: s.obligations ? `${DISCLAIMER}${OBLIGATION_NOTE}` : DISCLAIMER,
        children: store.children(s).map((x) => x.id),
        siblings: store.siblings(s).map((x) => x.id),
      });
    },
  );

  server.registerTool(
    "list_requirements",
    {
      title: "遵守事項を一覧する",
      description:
        "【遵守事項】を項目ごとに一覧する。編単位の棚卸しに使う。" +
        "【遵守事項】の枠が無いガイドライン（総務省・経産省 GL）では、文末表現から機械的に抜き出した義務文（obligations）を返す。",
      inputSchema: {
        guideline: guidelineArg,
        book: z.string().optional().describe("編で絞る。例: 企画管理編"),
        level: z
          .enum(["must", "should", "recommended"])
          .optional()
          .describe("obligations の強さで絞る。must=〜すること、should=〜べき・必要がある、recommended=〜が望ましい"),
        subject: z.enum(["対象事業者", "医療機関等"]).optional().describe("obligations の主語で絞る"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guideline, book, level, subject }) => {
      const items = store.sections
        .filter((s) => s.guideline === guideline && (!book || s.book === book))
        .map((s) => {
          const obligations = obligationsOf(s).filter(
            (o) => (!level || o.level === level) && (!subject || o.subject === subject),
          );
          return {
            id: s.id,
            book: s.book,
            heading: s.heading,
            requirements: requirementsOf(s),
            ...(s.obligations ? { obligations } : {}),
            sourceUrl: s.sourceUrl,
            page: s.page,
          };
        })
        .filter((x) => x.requirements.length > 0 || (x.obligations?.length ?? 0) > 0);
      const hasObligations = items.some((x) => x.obligations);
      return text({
        disclaimer: hasObligations ? `${DISCLAIMER}${OBLIGATION_NOTE}` : DISCLAIMER,
        items,
      });
    },
  );

  server.registerTool(
    "get_checklist",
    {
      title: "チェックリストを返す",
      description:
        "厚労省「医療機関・薬局におけるサイバーセキュリティ対策チェックリスト」の項目を構造化して返す。" +
        "hospital=医療機関・薬局確認用、vendor=事業者確認用。",
      inputSchema: {
        target: z.enum(["hospital", "vendor"]),
        category: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ target, category }) => {
      const items = store.checklists.filter(
        (c) => c.target === target && (!category || c.category.includes(category)),
      );
      if (store.checklists.length === 0) {
        return text({ error: "チェックリストのデータが未生成です（npm run data を参照）" }, true);
      }
      return text({ disclaimer: DISCLAIMER, items });
    },
  );

  server.registerResource(
    "section",
    new ResourceTemplate("guideline://{guideline}/{book}/{path}", { list: undefined }),
    { title: "ガイドライン本文", description: "条項本文をそのまま読む", mimeType: "text/plain" },
    async (uri, { guideline, book, path }) => {
      const id = `${guideline}/${book}/${path}`;
      const s = store.get(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: s ? `${s.heading}\n\n${s.text}\n\n出典: ${s.sourceUrl}` : `not found: ${id}`,
          },
        ],
      };
    },
  );

  return server;
}

function text(payload: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError };
}
