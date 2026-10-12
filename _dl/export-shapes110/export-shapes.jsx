#target aftereffects
#include "(export-shapes)/export-core.js"
#include "(export-shapes)/export-runner.js"
#include "(export-shapes)/export-settings.js"
#include "(export-shapes)/export-illustrator.js"

(function () {
    try {
        var comp = app.project ? app.project.activeItem : null;
        if (!(comp instanceof CompItem)) { throw new Error('コンポジションを開いてください。'); }
        var time = comp.time;
        var selected = comp.selectedLayers, i;
        if (selected.length !== 1 || selected[0].matchName !== 'ADBE Vector Layer') {
            throw new Error('シェイプレイヤーを1枚だけ選択してください。');
        }
        if ($.os.toLowerCase().indexOf('windows') < 0) { throw new Error('SVG書き出しはWindowsに対応しています。'); }
        var exe = new File(new File($.fileName).parent.fsName + '/export-shapes.exe');
        if (!exe.exists) { throw new Error('export-shapes.jsxと同じフォルダーにexport-shapes.exeを配置してください。\n' + exe.fsName); }
        var folder = AEShapeSettings.outputFolder(comp);
        var illustratorPath = AEShapeSettings.get('illustratorPath');
        var dialog = new Window('dialog', 'シェイプのSVG／AI書き出し');
        dialog.orientation = 'column';
        dialog.alignChildren = 'left';
        dialog.add('statictext', undefined, '対象レイヤー: ' + selected[0].name);
        dialog.add('statictext', undefined, 'カレント時間の静止画: ' + time + ' 秒');
        var keepJson = dialog.add('checkbox', undefined, '中間JSONをSVGと一緒に残す');
        keepJson.value = false;
        var exportAi = dialog.add('checkbox', undefined, 'AIも書き出す（SVGとAIの両方を保存）');
        exportAi.value = AEShapeSettings.get('exportAi') === 'true';
        var illustratorLabel = dialog.add('statictext', undefined, 'Illustrator: ' + (illustratorPath || '自動検出／未検出時に選択'));
        illustratorLabel.characters = 65;
        var changeIllustrator = dialog.add('button', undefined, 'Illustratorを選択／バージョン変更');
        changeIllustrator.onClick = function () {
            try {
                var selectedPath = AEShapeIllustrator.choose();
                if (selectedPath) {
                    illustratorPath = selectedPath;
                    AEShapeSettings.set('illustratorPath', illustratorPath);
                    illustratorLabel.text = 'Illustrator: ' + illustratorPath;
                }
            } catch (selectionError) { alert(selectionError.toString()); }
        };
        var folderLabel = dialog.add('statictext', undefined, '保存先の初期フォルダー: ' + folder.fsName);
        folderLabel.characters = 65;
        var resetFolder = dialog.add('button', undefined, '保存先の記憶を解除（aepのフォルダーに戻す）');
        resetFolder.onClick = function () {
            try {
                AEShapeSettings.set('outputFolder', '');
                folder = AEShapeSettings.outputFolder(comp);
                folderLabel.text = '保存先の初期フォルダー: ' + folder.fsName;
            } catch (settingsError) { alert(settingsError.toString()); }
        };
        var strict = dialog.add('checkbox', undefined, 'Contents・アンカーポイント・位置にアニメーションがある場合はエラーにする');
        strict.value = false;
        var buttons = dialog.add('group');
        buttons.add('button', undefined, 'SVGを書き出す', {name: 'ok'});
        buttons.add('button', undefined, 'キャンセル', {name: 'cancel'});
        if (dialog.show() !== 1) { return; }
        AEShapeSettings.set('exportAi', exportAi.value);
        if (exportAi.value) {
            illustratorPath = AEShapeIllustrator.ensure(illustratorPath);
            if (!illustratorPath) { return; }
            AEShapeSettings.set('illustratorPath', illustratorPath);
        }
        // Evaluate the selected layer before opening the save dialog or writing files.
        var doc = AEShapeExport.documentFor(comp, selected[0], time, strict.value);
        var warnings = doc.warnings.length, file, exists = false;
        var jobs = [{name: AEShapeExport.safeName(comp.name + '_' + selected[0].name) + '.svg',
            text: AEShapeExport.stringify(doc), canvas: {width: comp.width, height: comp.height}}];
        if (warnings) { throw new Error('取得できない値があるためSVGに変換できません。警告: ' + warnings + ' 件'); }
        var previousFolder = Folder.current;
        try {
            Folder.current = folder;
            file = new File(folder.fsName + '/' + jobs[0].name).saveDlg('SVGを名前を付けて保存', 'SVGファイル:*.svg');
        } finally { Folder.current = previousFolder; }
        if (!file) { return; }
        if (!/\.svg$/i.test(file.name)) { file = new File(file.fsName + '.svg'); }
        AEShapeSettings.set('outputFolder', file.parent.fsName);
        for (i = 0; i < jobs.length; i++) {
            jobs[i].file = file;
            jobs[i].json = new File(file.fsName.replace(/\.svg$/i, '.json'));
            jobs[i].ai = new File(file.fsName.replace(/\.svg$/i, '.ai'));
            exists = exists || file.exists;
            if (keepJson.value) { exists = exists || jobs[i].json.exists; }
            if (exportAi.value) { exists = exists || jobs[i].ai.exists; }
        }
        if (exists && !confirm('既存の出力ファイルを上書きしますか？')) { return; }
        var written = 0, aiWritten = 0, saved = [], cleanupWarnings = [], gradientErrors = [];
        for (i = 0; i < jobs.length; i++) {
            file = jobs[i].file;
            var work = AEShapeRunner.workFolder();
            var input = new File(work.fsName + '/input.json'), output = new File(work.fsName + '/output.svg');
            var log = new File(work.fsName + '/convert.log');
            var ai = new File(work.fsName + '/output.ai'), aiStatus = new File(work.fsName + '/illustrator.status');
            try {
                AEShapeRunner.write(input, jobs[i].text + '\n');
                var conversionLog = AEShapeRunner.convert(exe, input, output, log) || '';
                var logLines = conversionLog.split(/\r?\n/);
                for (var line = 0; line < logLines.length; line++) {
                    if (logLines[line].indexOf('Gradient fallback:') >= 0) { gradientErrors.push(logLines[line]); }
                }
                if (!output.copy(file.fsName)) { throw new Error('SVGを保存できません: ' + file.fsName); }
                saved.push(file.fsName);
                written++;
                if (keepJson.value) {
                    if (!input.copy(jobs[i].json.fsName)) { throw new Error('中間JSONを保存できません: ' + jobs[i].json.fsName); }
                    saved.push(jobs[i].json.fsName);
                }
                if (exportAi.value) {
                    AEShapeIllustrator.convert(illustratorPath, output, ai, aiStatus, jobs[i].canvas);
                    if (!ai.copy(jobs[i].ai.fsName)) { throw new Error('AIを保存できません: ' + jobs[i].ai.fsName); }
                    saved.push(jobs[i].ai.fsName);
                    aiWritten++;
                }
            } catch (conversionError) {
                throw new Error(conversionError.toString() + '\n作業フォルダー: ' + work.fsName +
                    '\n保存済みSVG: ' + written + ' 件\n' + saved.join('\n'));
            }
            cleanupWarnings = cleanupWarnings.concat(AEShapeRunner.cleanup(work,
                [input, output, log, new File(log.fsName + '.status'), ai, aiStatus]));
        }
        alert('SVGを保存しました: ' + written + ' 件\n' + saved.join('\n') +
            (exportAi.value ? '\nAIを保存しました: ' + aiWritten + ' 件' : '') +
            (gradientErrors.length ? '\nグラデーション取得エラー（塗りは赤・線は青に置換）:\n' + gradientErrors.join('\n') : '') +
            (cleanupWarnings.length ? '\n削除できなかった中間ファイル:\n' + cleanupWarnings.join('\n') : ''));
    } catch (e) { alert('シェイプの書き出しに失敗しました。\n' + e.toString()); }
}());
