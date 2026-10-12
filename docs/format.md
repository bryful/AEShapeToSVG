# Intermediate JSON v1

1レイヤー1ファイル、UTF-8、`format: "ae-shape-contents"`、`schemaVersion: 1`。
`scope: "contentsOnly"`。レイヤーTransformは含みません。

- `source`: AEバージョン、コンポジション情報、レイヤー名とインデックス、評価時刻（秒）。
- `contents`: AE Contentsを再帰的に保持したルートノード。
- `complete`: 取得できない値があればfalse。変換側はfalseを検出し、無条件に完成画像を出力しないこと。
- `warnings`: 欠落理由のcode、path、message。

各ノードは `name`, `matchName`, `index`（AEの1始まりのpropertyIndex）を持ちます。
表示名ではなくmatchNameで解釈してください。
Contents演算子には `kind`、有効状態を設定できるノードには `enabled` も保存します。
グループは `children` 配列を持ち、AEのプロパティ順序を保持します。
配列順はSVGの描画順へ直接置換せず、AEの合成順序・演算子の作用範囲と合わせて解釈します。

値ノードは `value`, `status`, `keyframeCount`, `expressionEnabled` を持ちます。
`value`は評価済みの数値、配列、またはShapeオブジェクトです。
Shapeは `vertices`, `inTangents`, `outTangents`, `closed` を持ち、接線は頂点からの相対座標です。
数値の単位・列挙値はAEの元プロパティに従います（座標px、角度degree、不透明度とScaleはpercent、色成分はAE値）。
`status` は `evaluated`, `noValue`, `unavailable`。
グラデーションの色ストップは `unavailable` と `value: null`、`reason` を保存します。

グループTransformを含む元のローカル座標を保持します。境界計算、変形適用、
パラメトリック形状生成、オフセット・リピーター展開は変換アプリの責務です。
SVG/PDFの同時出力やInkscape呼び出しは未実装です。将来はこのJSONを共通入力として使用します。
