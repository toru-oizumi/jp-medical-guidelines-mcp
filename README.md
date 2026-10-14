# jp-medical-guidelines-mcp

日本の医療情報に関する通称 **3省2ガイドライン** の本文を、MCP 経由で引くためのサーバです。

同梱データ（`data/sections/`）に収録しているのは次の版です。

| id | ガイドライン | 版 | 原本 |
|---|---|---|---|
| `mhlw-6.0` | 厚生労働省「医療情報システムの安全管理に関するガイドライン」 | 第6.0版（令和5年5月） | `data/guideline/` の同梱 PDF |
| `mic-meti-2.0` | 総務省・経済産業省「医療情報を取り扱う情報システム・サービスの提供事業者における安全管理ガイドライン」 | 第2.0版（令和7年3月改定） | 同上 |

`data/sources.json` には厚労省 **第7.0版**（`mhlw-7.0`）のエントリもありますが、原本を取得できていないためデータは未生成です
（[docs/STATUS.md](docs/STATUS.md) の「要確認」を参照）。

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
| `get_requirement` | 条項 id を指定して本文を取得。【遵守事項】は `requirements` に id 付きで 1 項目ずつ入る。`id#番号` で 1 項目だけ引ける |
| `list_requirements` | 編ごとに【遵守事項】を一覧する |
| `get_checklist` | 厚労省チェックリストを構造化して返す（医療機関用 / 事業者用） |

Resource: `guideline://{guideline}/{book}/{path}` で本文を直接読めます。

条項 id は**見出し番号ベース**です（例 `mhlw-6.0/operations/4.2.1`）。
ページ番号は改定で動くので id には使っていません。

- 番号の無い前付（【はじめに】）は `0`、章の後ろの付録・用語集は `appendix-N` です。
- 遵守事項 1 項目の id は `節 id#丸数字の番号`（例 `mhlw-6.0/operations/3#2` が ②）。
  ＜説明責任＞ などのグループごとに番号が振り直される節は `#グループの出現順.番号`（例 `mhlw-6.0/governance/1.2.1#2.1`）です。
- 総務省・経産省 GL は章番号などが PDF のテキスト層に無い（描画のみ）ため、目次の並びから番号を補っています。
  補った節には `numberInferred: true` が付きます。

## セットアップ

```bash
npm install
npm run build
npm test
```

Node.js 22.13 以上が必要です。

### 検索の評価

```bash
npx tsx scripts/eval-search.ts --verbose
```

`test/fixtures/search-eval.json` のクエリで hit@5 と MRR を出します。`npm test` にも閾値つきで入っています。
採点を変えるときはクエリを足してから比べてください。
言い換え（「リモートアクセス」→ 原文の「外部からのアクセス」など）は `src/synonyms.ts` にあります。

### データを作り直す

```bash
npm run extract  # 同梱 PDF（sources.json の localFile）または data/raw/ から data/sections/ を作る
npm run data     # 原本の取得 → PDF/Excel の構造化をまとめて行う（各省のサイトに直接アクセスする）
```

data/raw/ は git 管理外です。`data/raw/<id>__<key>.pdf` があればそちらを優先し、無ければ `localFile` を使います。

見出しは本文から推測せず、**目次を正として本文と順に照合**しています（`scripts/lib/structure.ts`）。
目次と照合できなかった見出しは `npm run extract` の出力に `?` 付きで出るので、改版時は必ず確認してください。
CI は同梱 PDF から作り直したデータとコミット済みのデータが一致するかを検査します。

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
`watch: false` のガイドライン（旧版）は監視の対象外です。
厚労省は編ごとに公表日がずれる（第7.0版でも企画管理編だけ令和8年5月）ため、
ガイドライン単位ではなくファイル単位が最小単位です。

`scripts/check-updates.ts` が掲載ページのリンク集合とハッシュを比較し、
差分があれば GitHub Actions が Issue を立てます（毎週月曜。既に Issue があればコメントを追記）。

## 出典と再配布について

`data/` 配下は各省の公開文書を**編集・加工**したものです。国が作成したものではありません。
出典表示・加工の明記の要件を含め、[data/NOTICE.md](data/NOTICE.md) を必ず参照してください。

コードは MIT です。`data/` 配下は同じライセンスではありません。

## Status

開発状況・判断が必要な事項・既知の制約は [docs/STATUS.md](docs/STATUS.md) にまとめています。
