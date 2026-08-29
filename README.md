# Always XX

何を描いても、選んだ図案に変わるお絵かきツール。
Stand404 氏の「[总是XX](https://www.bilibili.com/toy/6AF4DstEm8VTOebm)」(MIT) を基にした多言語対応版です。

原作との違い:

- **日本語 / English / 简体中文** に対応（設定からいつでも切り替え）
- **線画の画像からオリジナル図案を自動生成**（PNG・JPG をその場で SVG にトレース）
- 図案はすべて描き下ろしのオリジナル。第三者キャラクターは同梱していません

クレジットとライセンスの詳細は [NOTICE.md](NOTICE.md) と [LICENSE](LICENSE) を参照してください。

## 動かす

ビルド不要の静的サイトです。ES モジュールを使うため `file://` では動きません。
簡易サーバーで開いてください。

```bash
python3 -m http.server 4173
```

http://localhost:4173 を開きます。

## 使い方

1. **図案を選ぶ** — 中央の更新ボタンで他の図案に切り替え。「オリジナル図案」から自作もできます
2. **モードを選ぶ** — 自動変形（一画ごと）か手動変形（まとめて）
3. **描く** — 下部ツールバーで色・元に戻す・図案切替・設定・変形・保存・全消去

キャンバスはホイールとピンチで拡大縮小できます。`Ctrl/Cmd+Z` で元に戻せます。

## オリジナル図案を追加する

### アプリから（手軽・自分の端末のみ）

「オリジナル図案」→「画像・SVGを選ぶ」で、線画の PNG / JPG / SVG を読み込みます。
ラスタ画像は自動で SVG にトレースされ、その場でプレビューできます。

うまく取れないときは「変換の調整」で追いこみます。

| 項目 | 効果 |
| --- | --- |
| 線の拾い方 | 明暗のしきい値。線がかすれるなら上げ、背景を拾うなら下げる |
| 細かさ | 小さいほど元の形に忠実。大きいほど点が減ってカクつく |
| 白い線・暗い背景の画像 | 黒地に白線の画像はこれをオンに |

きれいに変換するコツ:

- 背景は白、線ははっきり濃く
- 塗りつぶしは苦手。**線画**が向いています
- 線が太くても細くても中心線を拾うので問題ありません

追加した図案は **localStorage に保存され、その端末のブラウザにだけ残ります**。
配布物には含まれません。

### リポジトリに同梱する（配布したい場合）

1. SVG を `shapes/` に置く（`<path d="...">` のみ読み取ります。線や図形はパスに変換してから書き出してください）
2. [src/shapes.js](src/shapes.js) の `BUILTIN_SHAPES` にエントリを追加

```js
{
  id: 'my-character',
  file: 'my-character.svg',
  themeColor: '#f2825b',
  name: { ja: 'なまえ', en: 'Name', zh: '名字' },
},
```

> **注意**: 同梱して公開できるのは、あなたが権利を持つ図案だけです。
> アニメ・ゲーム・VTuber などのキャラクターを同梱すると、原作の MIT ライセンスとは
> 無関係に権利侵害になります。詳細は [NOTICE.md](NOTICE.md) を参照。

## 言語を追加する

[src/i18n.js](src/i18n.js) の `MESSAGES` に同じキーのブロックを足し、`LOCALES` に
言語コードを追加するだけです。UI の文字列はすべてここに集約されています。

## 構成

| ファイル | 役割 |
| --- | --- |
| [src/svgpath.js](src/svgpath.js) | SVG パス (`d` 属性) を点列に展開。ベジェ・円弧対応 |
| [src/morph.js](src/morph.js) | バウンディングボックス・リサンプリング・変形フレーム生成 |
| [src/trace.js](src/trace.js) | 線画画像 → SVG（Otsu 二値化 → 細線化 → 骨格追跡 → RDP 簡略化） |
| [src/canvas.js](src/canvas.js) | 描画・変形アニメーション・ズーム/パン |
| [src/shapes.js](src/shapes.js) | 図案の登録と自作図案の保存 |
| [src/i18n.js](src/i18n.js) | 多言語文字列 |
| [src/app.js](src/app.js) | 画面遷移と UI の配線 |

### 変形のしくみ

1. 描いたストロークを図案のパス数 `k` 個に等分割する
2. 各断片と対応するパスを、それぞれ 256 点にリサンプリングする
3. ストロークのバウンディングボックス内で、両者を `easeInOutCubic` で 1 秒かけて補間する

`最小扁度` は、平べったいストロークでも図案がつぶれすぎないようボックスを広げる割合です。

## みんなの図案（共有ギャラリー）

他の人が公開した図案を、サイトを開いた誰もが使えます。オリジナル図案を作るときに
「みんなの図案として公開する」をオンにすると投稿されます。

投稿は即公開です。各カードの「通報」から報告でき、**3人から通報された図案は自動的に
非表示**になります。非表示分は管理APIから確認・削除できます。

### 投稿の安全性

投稿されたSVGは**送られてきたまま保存しません**。サーバー側でクライアントと同じ
パーサーにかけ、`<path d>` の座標だけを取り出して**SVGを組み立て直して**保存します。
`<script>`、`onload`、外部参照、`<foreignObject>` などは通過しません。

### サーバーを動かす

`server/` を配置し、環境変数を設定してNodeで起動します。依存パッケージはありません
（`npm install` 不要）。

```bash
sudo install -d -o alwaysxx -g alwaysxx /var/lib/always-xx
```

`/etc/always-xx.env` を作ります（`600` で保護してください）:

```
ADMIN_TOKEN=<長いランダム文字列>
CLIENT_SECRET=<長いランダム文字列>
```

`CLIENT_SECRET` は通報者の重複判定に使うIPのハッシュ化ソルトです。未設定だと
起動ごとにランダムになり、再起動で通報の重複判定がリセットされます。

- systemd ユニット: [deploy/always-xx-api.service](deploy/always-xx-api.service)
- nginx 設定例: [deploy/nginx.conf.example](deploy/nginx.conf.example)

```bash
sudo systemctl enable --now always-xx-api
curl -s localhost:8787/api/health
```

APIは `127.0.0.1` だけで待ち受け、nginxが `/api/` をプロキシします。フロントの
`API_BASE` は同一オリジンの `/api` なので、通常は [src/config.js](src/config.js) を
触る必要はありません。共有機能を切るなら `GALLERY_ENABLED = false` にします。

### 同居サービスへの配慮

同じサーバーでMinecraftが動いているため、負荷は抑えてあります。

| 制限 | 値 |
| --- | --- |
| メモリ | `MemoryMax=160M`＋Nodeヒープ96MB（実測RSSは約60MB） |
| CPU優先度 | `Nice=10` / `CPUWeight=20`（マイクラを優先） |
| 投稿レート | 1クライアント 5回バースト、以後 1回/分 |
| SVGサイズ | 64KB、300パス、20,000点まで |
| 総図案数 | 5,000（最悪でも約320MB、実際は1件2〜20KB程度） |

図案本体はメモリに載せず `data/svg/` から都度読み出すため、件数が増えてもRSSは
ほぼ一定です。SVGのURLは不変なのでnginx側で30日キャッシュしています。

### 管理

```bash
curl -s localhost:8787/api/admin/reports -H "authorization: Bearer $ADMIN_TOKEN"
```

```bash
curl -s -X DELETE localhost:8787/api/admin/shapes/<id> -H "authorization: Bearer $ADMIN_TOKEN"
```

誤報だった場合は再表示できます:

```bash
curl -s -X POST localhost:8787/api/admin/shapes/<id> -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"hidden":false}'
```

バックアップは `data/` をコピーするだけです。
