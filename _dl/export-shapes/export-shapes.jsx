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
        var selected = comp.selectedLayers, layers = [], ignored = 0, i;
        for (i = 0; i < selected.length; i++) {
            if (selected[i].matchName === 'ADBE Vector Layer') { layers.push(selected[i]); }
            else { ignored++; }
        }
        if (!layers.length) { throw new Error('シェイプレイヤーを1つ以上選択してください。'); }
        if ($.os.toLowerCase().indexOf('windows') < 0) { throw new Error('SVG書き出しはWindowsに対応しています。'); }
        var exe = new File(new File($.fileName).parent.fsName + '/export-shapes.exe');
        if (!exe.exists) { throw new Error('export-shapes.jsxと同じフォルダーにexport-shapes.exeを配置してください。\n' + exe.fsName); }
        var folder = AEShapeSettings.outputFolder(comp);
        var illustratorPath = AEShapeSettings.get('illustratorPath');
        var dialog = new Window('dialog', 'シェイプのSVG／AI書き出し');
        dialog.orientation = 'column';
        dialog.alignChildren = 'left';
        dialog.add('statictext', undefined, '対象レイヤー: ' + layers.length + ' / 対象外: ' + ignored);
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
        // Evaluate and serialize every layer before writing any files.
        var jobs = [], warnings = 0, doc, file, base, suffix, used = {}, paths = {}, exists = false;
        for (i = 0; i < layers.length; i++) {
            doc = AEShapeExport.documentFor(comp, layers[i], time, strict.value);
            warnings += doc.warnings.length;
            base = AEShapeExport.safeName(comp.name + '_' + layers[i].name);
            suffix = base;
            var serial = 2;
            while (used['$' + suffix.toLowerCase()]) { suffix = base + '_' + serial++; }
            used['$' + suffix.toLowerCase()] = true;
            jobs.push({name: suffix + '.svg', text: AEShapeExport.stringify(doc),
                canvas: {width: comp.width, height: comp.height}});
        }
        if (warnings) { throw new Error('取得できない値があるためSVGに変換できません。警告: ' + warnings + ' 件'); }
        // File.saveDlg uses this File as the initial filename (native Save As dialog).
        // Select all destinations before writing, so cancelling saves no files.
        for (i = 0; i < jobs.length; i++) {
            do {
                var previousFolder = Folder.current;
                try {
                    Folder.current = folder;
                    file = new File(folder.fsName + '/' + jobs[i].name).saveDlg(
                        'SVGを名前を付けて保存 (' + (i + 1) + '/' + jobs.length + ')', 'SVGファイル:*.svg');
                } finally { Folder.current = previousFolder; }
                if (!file) { return; }
                if (!/\.svg$/i.test(file.name)) { file = new File(file.fsName + '.svg'); }
                var key = '$' + file.fsName.toLowerCase();
                if (paths[key]) { alert('別のレイヤーと同じ保存先です。別名を指定してください。'); }
            } while (paths[key]);
            paths[key] = true;
            jobs[i].file = file;
            jobs[i].json = new File(file.fsName.replace(/\.svg$/i, '.json'));
            jobs[i].ai = new File(file.fsName.replace(/\.svg$/i, '.ai'));
            exists = exists || file.exists;
            if (keepJson.value) { exists = exists || jobs[i].json.exists; }
            if (exportAi.value) { exists = exists || jobs[i].ai.exists; }
            folder = file.parent;
            AEShapeSettings.set('outputFolder', folder.fsName);
        }
        if (exists && !confirm('既存の出力ファイルを上書きしますか？')) { return; }
        var written = 0, aiWritten = 0, saved = [], cleanupWarnings = [];
        for (i = 0; i < jobs.length; i++) {
            file = jobs[i].file;
            var work = AEShapeRunner.workFolder();
            var input = new File(work.fsName + '/input.json'), output = new File(work.fsName + '/output.svg');
            var log = new File(work.fsName + '/convert.log');
            var ai = new File(work.fsName + '/output.ai'), aiStatus = new File(work.fsName + '/illustrator.status');
            try {
                AEShapeRunner.write(input, jobs[i].text + '\n');
                AEShapeRunner.convert(exe, input, output, log);
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
            (cleanupWarnings.length ? '\n削除できなかった中間ファイル:\n' + cleanupWarnings.join('\n') : ''));
    } catch (e) { alert('シェイプの書き出しに失敗しました。\n' + e.toString()); }
}());
