# Shape Contents JSON exporter

AEの「ファイル → スクリプト → スクリプトファイルを実行」で `export-shapes.jsx` を実行します。
`lib/export-core.js` も相対位置を維持して配置してください。Shapeレイヤーを選択し、保存先を指定します。
AEの環境設定でスクリプトによるファイル書き込みを許可してください。

標準はカレント時間の静止画です。Expression適用後の値を取得します。
「Reject animation」を有効にするとContents内のキーフレーム・有効なExpressionをエラーにします。
レイヤーTransform、親、マスク、エフェクトは出力しません。

対応Contents: 四角、楕円、多角形/スター、パス、オフセット、リピーター、塗り、線、
グラデーション塗り、グラデーション線、入れ子グループとそのTransform。
オフセットとリピーターは演算子とパラメーターを保存し、形状への展開は行いません。
線のダッシュ等の子プロパティも保存します。未対応のContents演算子は保存前にエラーにします。

**制限:** グラデーションの色・不透明度ストップはAEのスクリプトAPIで通常取得できません。
この実装では `ADBE Vector Grad Colors` を `status: "unavailable"` として保存します。
出力全体は `complete: false` となり、継続確認と警告を表示します。
位置・種類・不透明度・線幅などの取得可能な設定は保存します。
完全なグラデーション対応には別途ストップ取得方式の検討とAE実機検証が必要です。

ファイル名の禁止文字を置換し、同名選択レイヤーは連番を付けます。
全レイヤーの取得・JSON化後に保存し、既存ファイルの上書きは確認します。
I/Oエラーで途中停止した場合、既に保存されたファイルは残ります。

AE未インストール環境での確認:

```powershell
node script/tests/export-core.test.cjs
```

モックによる取得・シリアライズ確認です。ScriptUI、File、AE固有のプロパティ構造、
実際のExpression評価はAE環境で検証してください。

参考: https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/
