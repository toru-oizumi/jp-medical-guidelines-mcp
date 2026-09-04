# jp-medical-guidelines-mcp

日本の医療情報に関する通称 **3省2ガイドライン** の本文を、MCP 経由で引くためのサーバです。

- 厚生労働省「医療情報システムの安全管理に関するガイドライン」**第7.0版**（令和8年6月）
- 総務省・経済産業省「医療情報を取り扱う情報システム・サービスの提供事業者における安全管理ガイドライン」**第2.0版**（令和7年3月改定）

## これは何をしないか

**準拠可否の判定はしません。** 提供するのは「該当する条項を引く」ところまでです。
戻り値には必ず条項 id・原文の抜粋・出典 URL が入るので、判断は人が原本を見て行ってください。

`check_compliance` のようなツールを意図的に置いていません。AI が準拠を判定したかのような
出力になることを避けるためです。

## Tools

| tool | 用途 |
|---|---|
| `list_sections` | 編・章立ての一覧。どこを掘るか決める |
| `search_requirements` | キーワードで遵守事項を引く。抜粋と出典つき |
| `get_requirement` | 条項 id を指定して本文を取得 |
| `get_checklist` | 厚労省チェックリストを構造化して返す（医療機関用 / 事業者用） |

Resource: `guideline://{guideline}/{book}/{path}` で本文を直接読めます。

条項 id は**見出し番号ベース**です（例 `mhlw-7.0/operations/4.2.1`）。
ページ番号は改定で動くので id には使っていません。

## セットアップ

```bash
npm install
npm run data     # 原本の取得 → PDF/Excel の構造化。data/ が生成される
npm run build
```

`npm run data` は各省のサイトに直接アクセスします。data/raw/ は git 管理外です。

### MCP クライアントの設定

```json
{
  "mcpServers": {
    "jp-medical-guidelines": {
      "command": "npx",
      "args": ["-y", "jp-medical-guidelines-mcp"]
    }
  }
}
```

## データの更新

`data/sources.json` がファイル単位で URL・公表日・SHA-256 を持ちます。
厚労省は編ごとに公表日がずれる（第7.0版でも企画管理編だけ令和8年5月）ため、
ガイドライン単位ではなくファイル単位が最小単位です。

`scripts/check-updates.ts` が掲載ページのリンク集合とハッシュを比較し、
差分があれば GitHub Actions が Issue を立てます（毎週月曜）。

## 出典と再配布について

`data/` 配下は各省の公開文書を**編集・加工**したものです。国が作成したものではありません。
出典表示・加工の明記の要件を含め、[data/NOTICE.md](data/NOTICE.md) を必ず参照してください。

コードは MIT です。`data/` 配下は同じライセンスではありません。

## Status

初期スキャフォールドです。以下は**未検証**です。

- [ ] `scripts/extract.ts` の見出し検出（PDF のレイアウト依存が強い。要目視確認）
- [ ] `scripts/xlsx.ts` の列マッピング（`npx tsx scripts/xlsx.ts --inspect` で原本の列を見てから調整）
- [ ] 検索の精度（bigram の素朴な実装。必要なら BM25 か埋め込みに差し替える）
