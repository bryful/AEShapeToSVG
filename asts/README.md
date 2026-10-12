# export-shapes.exe — AE Shape Contents → SVG

Visual Studio 2026 / Windows SDK / C++20。`AEShapeToSVG.slnx` を開き、
`Release / x64` でビルドしてください。ソースはasts直下です。
この開発PCのPDB生成DLL不一致を避けるため、Releaseはデバッグ情報を生成しません。
DebugでPDB関連のリンクエラーが出る場合はVisual Studioの修復が必要です。

```powershell
& ./script/export-shapes.exe 'sample/シェイプレイヤー 1.json'
& ./script/export-shapes.exe 'sample/シェイプレイヤー 1.json' 'sample/output.svg' --margin 5
```

出力名省略時は入力と同じ場所・同じベース名の.svgです。
既存のSVGは上書きします。入力と出力が同じパスの場合はエラーです。
余白は既定2px。透明背景、Contentsローカル座標、描画範囲に合わせたviewBoxです。
コンポジション枠・背景・レイヤーTransformは出力しません。
SVGはUTF-8。日本語のファイル名・レイヤー名に対応します。
終了コードは成功0、変換失敗1、引数なし2です。

## 対応範囲

- 四角・角丸四角・楕円・整数頂点数の多角形/スター・Bezierパス。
- 多角形の外側の丸み、スターの外側・内側の丸み（負の値を含む）。
- 入れ子グループの移動、アンカー、Scale、回転、Skew、不透明度。
- 単色の塗り・線、色と全体の不透明度、塗り規則、線端、線の結合、ダッシュ。
- パスの結合の5モード。
- 単一コピーのパスのオフセット。開いたパスは帯状輪郭として扱います。
- リピーターのコピー数・移動・Scale・回転・小数オフセット・不透明度。
- パスのトリミングの開始・終了・オフセット・同時/個別モード。
- グラデーションは赤い塗り・青い線へ置換。非表示/未知のContentsは無視。

Direct2Dを使って形状演算を行い、SVGのベクターパスに保存します。
通常のBezierは曲線を保持し、トリミングやパス演算で必要な場合は0.02pxの許容誤差で近似します。
マテリアル情報は2D出力に使用しません。

## 現時点の制限

小数の頂点数、複数コピーのオフセット、通常以外の描画モードは
未実装のためエラーにします。テーパー・波などの未対応設定は出力に反映しません。
親の塗りが半透明な子グループ内の形状を再利用する場合や複雑な演算順序、負Scaleを含むリピーターの一般ケースは
AEとの一致を追加検証する必要があります。今回のサンプルで使用された設定は画像比較済みです。
PDF生成とInkscapeの呼び出しはまだ含めていません。
独立した「角を丸くする」演算子はJSON保存のみで、SVGへの適用は未実装です。
多角形・スター固有の丸みは頂点に接線方向のBezierハンドルを生成します。
形状生成の参照: https://github.com/airbnb/lottie-web/blob/master/player/js/utils/shapes/ShapeProperty.js
多角形のハンドル係数は提供されたAE 25.6の三角形画像に合わせて調整しています。
丸み付きの三角形・5頂点スターを画像比較済みですが、異なる頂点数・極端な丸みは実機で追加検証が必要です。

古いJSONには未使用の破線スロットも保存されています。`visibilityKnown` がない破線は
警告して実線として扱います。破線を使う場合は更新版スクリプトでJSONを再出力してください。
新しいスクリプトは破線スロットの `canSetExpression` を利用して未使用の項目を除外します。
この判別方法の実機確認は別途必要です。

## 検証

```powershell
node script/tests/export-core.test.cjs
node tests/svg.integration.cjs script/export-shapes.exe <sharpのモジュールパス>
```

画像テストにはNode.jsとsharpを使います。アプリ本体の実行には不要です。
テストは一時フォルダーにJSON/SVGを生成し、結合・オフセット・トリミング・リピーター・
グループ配置のピクセルを検証します。不正な形式・余白等も確認します。

依存: nlohmann/json v3.12.0（MIT、third_party/nlohmann/LICENSE.MIT）、Windows標準Direct2D。

ビルド結果の名前は `export-shapes.exe` です。ビルド後に `script` フォルダーへ自動コピーします。
配布時も `export-shapes.jsx` と同じ場所に置いてください。最後にビルドした構成のexeが配置されます。
現在、スクリプトからexeの自動起動は行いません。
