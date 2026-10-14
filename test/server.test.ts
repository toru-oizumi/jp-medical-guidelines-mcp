import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

/** 同梱データ（data/sections）に対して、MCP クライアントから実際に呼ぶ */
describe("MCP server (同梱データ)", () => {
  const client = new Client({ name: "test", version: "0.0.0" });

  before(async () => {
    const server = await createServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
  });
  after(() => client.close());

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text: string }[];
    return { isError: res.isError, body: JSON.parse(content[0]!.text) };
  };

  it("準拠判定のツールを置いていない", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "get_checklist",
      "get_requirement",
      "list_requirements",
      "list_sections",
      "search_requirements",
    ]);
  });

  it("search_requirements は抜粋と出典を返す", async () => {
    const { body } = await call("search_requirements", { query: "責任分界", guideline: "mhlw-6.0", k: 3 });
    assert.equal(body.hits.length, 3);
    for (const h of body.hits) {
      assert.match(h.quote, /責任分界/);
      assert.match(h.sourceUrl, /^https:\/\//);
    }
    assert.match(body.disclaimer, /判定するものではありません/);
  });

  it("get_requirement は遵守事項を項目ごとに返す", async () => {
    const { body } = await call("get_requirement", { id: "mhlw-6.0/operations/3" });
    assert.equal(body.heading, "3 責任分界[Ⅰ～Ⅳ]");
    assert.equal(body.requirements.length, 5);
    assert.match(body.requirements[0], /^①/);
    assert.ok(body.children.includes("mhlw-6.0/operations/3.1"));
  });

  it("存在しない id はエラーで返す", async () => {
    const { isError } = await call("get_requirement", { id: "mhlw-6.0/operations/999" });
    assert.equal(isError, true);
  });

  it("list_requirements は編で絞れる", async () => {
    const { body } = await call("list_requirements", { guideline: "mhlw-6.0", book: "経営管理編" });
    assert.ok(body.items.length > 0);
    assert.ok(body.items.every((i: { book: string }) => i.book === "経営管理編"));
  });

  it("resource で本文を読める", async () => {
    const res = await client.readResource({ uri: "guideline://mic-meti-2.0/main/3.1.1" });
    const c = res.contents[0] as { text: string };
    assert.match(c.text, /^3\.1\.1 安全管理義務/);
    assert.match(c.text, /出典: https:\/\//);
  });
});
