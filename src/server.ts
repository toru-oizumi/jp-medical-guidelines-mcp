import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "./store.js";

const DISCLAIMER =
  "本ツールが返すのは公開ガイドラインの該当箇所です。準拠の可否を判定するものではありません。" +
  "最終的な確認は source_url の原本 PDF で行ってください。";

export async function createServer(): Promise<McpServer> {
  const store = await Store.load();

  const server = new McpServer(
    { name: "jp-medical-guidelines-mcp", version: "0.1.0" },
    {
      instructions:
        "日本の医療情報に関する「3省2ガイドライン」（厚生労働省 医療情報システムの安全管理に関するガイドライン 第7.0版 / " +
        "総務省・経済産業省 医療情報を取り扱う情報システム・サービスの提供事業者における安全管理ガイドライン 第2.0版）の本文を引くサーバ。" +
        "回答には必ず条項 id と source_url を添えること。準拠可否の判断はこのサーバの役割ではない。",
    },
  );

  server.registerTool(
    "list_sections",
    {
      title: "目次を返す",
      description: "ガイドラインの編・章立てを一覧する。どの編を掘るか決めるために最初に呼ぶ。",
      inputSchema: {
        guideline: z.enum(["mhlw-7.0", "mic-meti-2.0"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guideline }) => {
      const books = new Map<string, { guideline: string; book: string; headings: string[] }>();
      for (const s of store.sections) {
        if (guideline && s.guideline !== guideline) continue;
        const key = `${s.guideline}/${s.book}`;
        if (!books.has(key)) books.set(key, { guideline: s.guideline, book: s.book, headings: [] });
        if (s.headingPath.length <= 2) books.get(key)!.headings.push(`${s.id}  ${s.heading}`);
      }
      return text([...books.values()]);
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
        guideline: z.enum(["mhlw-7.0", "mic-meti-2.0"]).optional(),
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
      description: "条項 id を指定して本文を取得する。search_requirements の結果を掘るときに使う。",
      inputSchema: { id: z.string().describe('例: "mhlw-7.0/operations/4.2.1"') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const s = store.get(id);
      if (!s) return text({ error: `not found: ${id}` }, true);
      const siblings = store.sections
        .filter((x) => x.book === s.book && x.headingPath.length === s.headingPath.length)
        .map((x) => x.id);
      return text({ ...s, disclaimer: DISCLAIMER, siblings });
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
    async ({ target, category }) =>
      text({
        disclaimer: DISCLAIMER,
        items: store.checklists.filter(
          (c) => c.target === target && (!category || c.category.includes(category)),
        ),
      }),
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
