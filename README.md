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
npm test         # 見出し分割のテスト
```

`npm run data` は各省のサイトに直接アクセスします。data/raw/ は git 管理外です。

社内プロキシやサンドボックスからは egress ポリシーで 403 になることがあります。
その場合は原本を手で `data/raw/` に置いてください（`<guideline-id>__<key>.<pdf|xlsx>`、
例 `mhlw-7.0__operations.pdf`）。以降の `extract` / `xlsx` はネットワークを使いません。

### 抽出結果を確かめる

```bash
npx tsx scripts/extract.ts --report     # 書き出さずに監査結果だけ出す
npx tsx scripts/xlsx.ts --inspect       # チェックリストの列と、COLUMNS の当たりを出す
```

`--report` は柱として落とした行・目次行・番号の飛び・重複した条項 id・
見出しに見えて取れなかった行を出します。PDF のレイアウト依存が強いので、
**見出しの正規表現を触る前にこれを見てください。**

`xlsx.ts` は `COLUMNS` が原本のヘッダと食い違っていると、書き出さずに止まります
（列が 1 つずれた JSON が静かに出来上がるのを防ぐため）。

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

初期スキャフォールドです。パイプラインは合成 PDF・合成 Excel では通っていますが、
**原本での確認が済んでいません。**

- [ ] `npm run data` を原本に対して実行（各省サイトへの到達が必要）
- [x] 見出し検出。第6.0版の PDF 4 編と提供事業者GL 第2.0版で確認済み。
      各編とも、抽出した条項数が原本の目次の項目数と一致する（取りこぼし 0）
- [ ] `scripts/xlsx.ts` の `COLUMNS` / `HEADER_ROWS`（`--inspect` の出力に合わせる）
- [ ] 検索の精度（bigram の素朴な実装。必要なら BM25 か埋め込みに差し替える）

設計の前提（条項 id は見出し番号ベース / 準拠判定はしない / 戻り値に出典必須）は
[CLAUDE.md](CLAUDE.md) にあります。
