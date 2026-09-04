# jp-medical-guidelines-mcp

3省2ガイドライン（厚労省「医療情報システムの安全管理に関するガイドライン」第7.0版 /
総務省・経産省「提供事業者における安全管理ガイドライン」第2.0版）の本文を MCP で引くサーバ。

`data/` は各省の公開 PDF・Excel から生成する。原本は git 管理外（`data/raw/`）で、
生成物（`data/sections/`・`data/checklists/`）と `data/sources.json` だけをコミットする。

## 設計の前提

この 3 つは仕様であって、実装の都合で崩してよいものではない。
変更が必要になったら、まず人に相談すること。

### 1. 条項 id は見出し番号ベース

`<guideline>/<key>/<見出し番号>` の形。例 `mhlw-7.0/operations/4.2.1`。

- ページ番号を id に使わない。改定でページは動くが、見出し番号は比較的動かない。
- 通し番号・ハッシュ・配列添字も使わない。id は人が原本の目次から引ける文字列であること。
  「この id は原本のどこか」が人に辿れないなら、id の設計が壊れている。
- `page` は抽出時点の参考値として持つだけ。検索やリンクの主キーにしない。
- 厚労省 GL は編ごとにファイルが分かれ、編ごとに公表日がずれる（第7.0版でも企画管理編だけ
  令和8年5月）。だから `key`（= 編）を id に含める。ガイドライン単位ではなくファイル単位が最小単位。

### 2. 準拠可否の判定はしない

このサーバの責務は「該当する条項を引く」ところまで。

- `check_compliance` / `assess` / `is_compliant` のようなツールは意図的に置いていない。
  追加しないこと。AI の出力が準拠判定として読まれることを避けるため。
- 「〜を満たしています」「〜は不要です」と読める要約を生成しない。返すのは原文と出典。
- チェックリストも、項目を構造化して返すだけ。○×は付けない。

### 3. 戻り値には必ず出典を入れる

- すべてのツールの戻り値に、条項 id・原文の抜粋（`quote`）・`sourceUrl` を含める。
  この 3 つが揃わない戻り値を追加しない。
- `quote` は原文ママ。言い換え・要約・整形をしない（空白の正規化までは可）。
- `DISCLAIMER`（`src/server.ts`）を戻り値から外さない。
- `data/` は一次情報ではない。抽出の過程で図表・脚注・レイアウトは落ちている。
  それを踏まえた文言が `data/NOTICE.md` にある。出典表示の要件込みで、
  再配布に関わる変更をするときは必ず読むこと。

## 構成

```
scripts/fetch.ts          原本を data/raw/ に取得し、sha256 を sources.json に書き戻す
scripts/lib/sections.ts   行 → 章節の分割ロジック（純関数。ここだけテストがある）
scripts/extract.ts        data/raw/*.pdf → data/sections/*.json
scripts/xlsx.ts           data/raw/*.xlsx → data/checklists/*.json
scripts/check-updates.ts  掲載ページのリンク集合とハッシュを比較（CI が毎週実行）
src/store.ts              JSON をメモリに読んで bigram で引く
src/server.ts             MCP ツール定義
```

## 作業のしかた

```bash
npm ci
npm run data        # fetch → extract → xlsx
npm run test        # sections.ts のテスト
npm run typecheck   # scripts/ と src/ 両方
```

- `npm run fetch` は各省のサイトに直接アクセスする。**サンドボックスや社内プロキシからは
  403 になることがある**（egress ポリシーで `www.mhlw.go.jp` / `www.meti.go.jp` が塞がれている場合）。
  その場合はローカルで fetch するか、原本を手で `data/raw/` に置く。
  ファイル名は `<guideline-id>__<key>.<pdf|xlsx>`（例 `mhlw-7.0__operations.pdf`）。
- `sha256` は「同梱データがどの版から作られたか」の唯一の証跡。手で書き換えない。
  fetch が書き戻した値をそのままコミットする。
- 抽出結果を変えるコミットでは、`npx tsx scripts/extract.ts --report` の出力を確認する。
  PDF のレイアウト依存が強いので、目視なしに正規表現を触らないこと。

## 未検証のところ

- `scripts/lib/sections.ts` の見出し検出。実データでの確認が済んでいない（`--report` で確認する）。
- `scripts/xlsx.ts` の `COLUMNS`。原本の列を `--inspect` で見てから合わせる。
- 検索精度。`src/store.ts` は素朴な bigram。必要なら BM25 か埋め込みに差し替える。
  ただし「返す根拠が原文の一致箇所そのもの」であることは崩さない（前提 3）。
