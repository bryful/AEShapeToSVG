# Shape Contents SDK Probe

AE SDK 2025を使用するWindows x64用の検証AEGPです。
選択したレイヤーのContentsだけをカレント時間・Expression適用後で読み取り、診断JSONを保存します。
Shapeデータの完成版エクスポーターではありません。プロジェクトの値は変更しません。

## ビルドと実行

1. Visual Studio 2026でルートの `AEShapeToSVG.slnx` を開きます。
2. `Release / x64` で `ShapeProbe` をビルドします。
3. `plugin/bin/x64/Release/ShapeProbe.aex` をAEのPlug-insフォルダーにコピーし、AEを再起動します。
4. コンポジションを開き、タイムラインでShapeレイヤーの行を選択します。プロパティだけの選択は対象外です。
5. ファイルメニュー末尾の **Shape Contents SDK Probe...** を実行し、JSON保存先を選びます。

Debug版はVisual Studioのデバッグ用ランタイムが必要です。別PCにはRelease版を使用してください。
x86構成ではこのプロジェクトをビルドしません。
この開発PCではDebugリンク時にMSPDB140.DLLのバージョン不一致が発生しました。
Release版はPDBを生成せずビルドできます。Debugでの実行にはVSのインストール状態の修復が必要です。
`powershell -File plugin/Verify-Build.ps1` で.aex内のPiPLの配置と内容を確認できます（AEコードは実行しません）。

## 記録内容

- コンポジション内の評価時刻（整数value/scale）、選択インデックス。
- Contentsの階層・matchName・グループ型・フラグ。
- 葉のstreamType、時間変化の有無、各問い合わせと値取得のエラーコード。
- 数値、2D/3D、色（RGBA）の評価値。
- ARBのハンドル有無。グラデーションの `ADBE Vector Grad Colors` に限り、
  PF Handle Suiteで取得したサイズと先頭最大4096バイトの16進表現。

`valueError: 0` はSDKが値取得に成功した意味です。色ストップ取得成功を意味しません。
`decoded: false` のままです。任意データには内部ポインター等が含まれる可能性があり、
保存したバイト列をそのまま別セッションで復元したり、色ストップとして解釈したりしないでください。
ポインターの追跡・値の書き換え・未知構造へのキャストは行いません。
パス等の複雑な値はこの検証版では型と取得成否のみ記録します。
Shape以外の選択レイヤーにはContents検索のエラーを記録します。

## グラデーション検証手順

1. 他のContentsは同じにして、2色の線形グラデーション塗りを作り保存。
2. 片方の色だけ変更し、別名で保存。
3. ストップ位置、ストップ数、不透明度ストップをそれぞれ1項目ずつ変えて保存。
4. 放射状、グラデーション線でも同様に確認。
5. キーフレームのある場合はカレント時間を変えて比較。
6. 変更なしでも再取得・AE再起動後に取得し、内部アドレス等による変化と区別。

JSON内の `ADBE Vector Grad Colors` のstreamType、valueError、arbSize、opaqueHexPrefixを比較します。
バイト列が変化しても、公開された安定した色ストップ形式であるという証明にはなりません。

## PiPLリソース

同梱のPiPLtool.exeはこの開発PCではWindowsの再配置エラーで起動できなかったため、
`Generate-PiPL.ps1` でこのプラグインの5プロパティだけを持つWindows PiPLのRCを生成します。
PowerShellはWindows標準搭載のものを使用します。追加ランタイムは不要です。
`ShapeProbePiPL.r` は対応する定義の参照用です。一般的な.rコンパイラーは実装していません。
Windows形式のバイト順・文字列パディングについては以下の実装も参照しています。

- https://ae-plugins.docsforadobe.dev/aegps/implementation/
- https://ae-plugins.docsforadobe.dev/aegps/aegp-suites/
- https://docs.rs/pipl/latest/src/pipl/lib.rs.html

このPCではAEがないためロード・実際の取得結果は未検証です。
