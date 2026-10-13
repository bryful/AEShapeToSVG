# Intermediate JSON v1

1レイヤー1ファイル、UTF-8、`format: "ae-shape-contents"`、`schemaVersion: 1`。
`scope: "contentsOnly"`。形状はContentsを保持し、配置用のレイヤーのアンカーポイント・位置だけを補助情報として保存します。

- `source`: AEバージョン、コンポジション情報、レイヤー名とインデックス、評価時刻（秒）。
- `contents`: AE Contentsを再帰的に保持したルートノード。
- `complete`: 取得できない値があればfalse。変換側はfalseを検出し、無条件に完成画像を出力しないこと。
- `warnings`: 欠落理由のcode、path、message。

`source.layer.anchorPoint` と `source.layer.position` はカレント時間・Expression適用後の座標配列です。
2Dは2要素、3Dは3要素ですが、SVGではXYのみ使用します。位置の次元分割にも対応します。
回転・スケール・親レイヤーの変換・3D投影は適用しません。
SVGのキャンバスは `source.composition.width/height`、viewBoxは `0 0 width height` です。
配置は `Contents座標 - anchorPoint + position` とし、キャンバス外はクリップします。
旧JSONでアンカーがなければ `[0,0]`、位置がなければコンポ中央を使用します。
コンポ情報自体がない旧JSONでは従来の描画範囲に合わせたキャンバスを使用します。

各ノードは `name`, `matchName`, `index`（AEの1始まりのpropertyIndex。生成した色ノードは元グループのプロパティ数+1）を持ちます。
表示名ではなくmatchNameで解釈してください。
Contents演算子には `kind`、有効状態を設定できるノードには `enabled` も保存します。
グループは `children` 配列を持ち、AEのプロパティ順序を保持します。
非表示のContentsオブジェクトと未対応のContents演算子は、子孫も含めて配列から除外します。
残るノードのindexは元のpropertyIndexを維持するため欠番になります。
除外だけを理由にcompleteをfalseにはしません。全対象が除外された場合、childrenは空配列です。
配列順はSVGの描画順へ直接置換せず、AEの合成順序・演算子の作用範囲と合わせて解釈します。

値ノードは `value`, `status`, `keyframeCount`, `expressionEnabled` を持ちます。
`value`は評価済みの数値、配列、またはShapeオブジェクトです。
Shapeは `vertices`, `inTangents`, `outTangents`, `closed` を持ち、接線は頂点からの相対座標です。
数値の単位・列挙値はAEの元プロパティに従います（座標px、角度degree、不透明度とScaleはpercent、色成分はAE値）。
`status` は `evaluated`, `noValue`, `unavailable`, `replacement`。
グラデーション塗り/線は `kind: fill/stroke` と通常塗り/線のmatchNameに置換します。
元のmatchNameは `sourceMatchName`、置換理由は `replacement: "gradientToSolid"` に保存します。
グラデーション固有の子は通常のchildrenから除外し、通常色ノードを末尾に追加します。
塗りの色はRGBA `[1,0,0,1]`、線の色は `[0,0,1,1]`、色ノードのstatusは `replacement`。
共通プロパティと全体の不透明度は保持します。置換は仕様として扱い、completeをfalseにしません。

`source.projectFile` は保存済みaepの絶対パス（未保存はnull）、`source.projectDirty` は未保存の変更の有無です。
グラデーションには `gradientRequest` を追加します。
`timeSeconds` は `source.evaluation.timeSeconds` と同じコンポ時間（秒）、
`keyframeCount` はグラデーション配下のキー数合計、`expressionEnabled` は色のExpression有効状態です。
`properties` は開始点・終了点・種類・ハイライト等のmatchNameをキーとする、同時刻の評価済み値です。
キーが1個以上なら `error: "GRADIENT_KEY_ANIMATION"` を記録し、アニメーション禁止設定に関係なく局所的に置換します。
exeはRIFXチャンクの親境界を確認してaepを読み、コンポ／レイヤー／Contentsの名前の階層が一致するGCst内のXMLを解析します。
候補が複数ある場合や取得できない場合、既定の白黒で成功扱いせず単色置換にします。
取得成功時のみメモリー内のノードに `gradient` を補完し、`replacement` を除去してSVGのpaintとして出力します。
XMLの色配列は `[位置,中間点,R,G,B,補助値]`、不透明度配列は `[位置,中間点,不透明度]` です。
中間点はBodymovin同様に追加ストップで近似します。重複位置・退化した中間点は現時点で置換対象です。
保存する中間JSON自体は取得要求の状態なので、再変換には元のaepが必要です。

グループTransformを含む元のローカル座標を保持します。境界計算、変形適用、
パラメトリック形状生成、オフセット・リピーター展開は変換アプリの責務です。
パスの結合は `kind: "mergePaths"`、`matchName: "ADBE Vector Filter - Merge"` として保存します。
子の `ADBE Vector Merge Type` にカレント時間の結合モードを保存します。
結合、追加、型抜き、交差、交差を除外などのモードはAEの数値をそのまま保持し、
実際のパス演算は変換アプリ側で実装します。
SVG変換はastsに実装しています。PDF出力やInkscape呼び出しは未実装です。

パスのトリミングは `kind: "trimPaths"`、`matchName: "ADBE Vector Filter - Trim"` として保存します。
子は `ADBE Vector Trim Start`（開始%）、`ADBE Vector Trim End`（終了%）、
`ADBE Vector Trim Offset`（度）、`ADBE Vector Trim Type`（複数シェイプの処理モード）です。
カレント時間・Expression適用後の値とContents内の順序を保持します。
Bezier曲線の長さ計算、パスの分割、複数シェイプへの適用などの実際のトリミング処理は変換アプリ側の責務です。

破線グループ `ADBE Vector Stroke Dashes` の `visibilityKnown: true` は、未使用のスロットを
書き出し時に除外済みであることを表します。既存JSONで省略されている場合は有効な破線の数を
確定できないため、astsは警告し実線として出力します。

「角を丸くする」は `kind: "roundCorners"`、`matchName: "ADBE Vector Filter - RC"` として保存します。
子の `ADBE Vector RoundCorner Radius` に半径（px）の評価値を保持します。
カレント時間・Expression適用後の値とContents内の順序を保持し、非表示の場合は除外します。
アニメーション禁止モードでは半径のキーフレーム・有効なExpressionもエラーになります。
既存の長方形の角丸半径（`ADBE Vector Rect Roundness`）とは別の演算子です。
SVG変換でも角丸演算を適用します。尖った頂点の前後を半径（各辺の半分を上限）で切り詰め、
Bezier曲線で接続します。開いたパスの端点と既存の曲線ハンドルは維持します。
matchNameの参照: https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/#round-corners
