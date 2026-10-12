#target aftereffects
#include "(export-shapes)/export-core.js"
#include "(export-shapes)/export-runner.js"

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
        var dialog = new Window('dialog', 'シェイプのSVG書き出し');
        dialog.orientation = 'column';
        dialog.alignChildren = 'left';
        dialog.add('statictext', undefined, '対象レイヤー: ' + layers.length + ' / 対象外: ' + ignored);
        dialog.add('statictext', undefined, 'カレント時間の静止画: ' + time + ' 秒');
        var keepJson = dialog.add('checkbox', undefined, '中間JSONをSVGと一緒に残す');
        keepJson.value = false;
        var strict = dialog.add('checkbox', undefined, 'Contents・アンカーポイント・位置にアニメーションがある場合はエラーにする');
        strict.value = false;
        var buttons = dialog.add('group');
        buttons.add('button', undefined, 'SVGを書き出す', {name: 'ok'});
        buttons.add('button', undefined, 'キャンセル', {name: 'cancel'});
        if (dialog.show() !== 1) { return; }
        // Evaluate and serialize every layer before writing any files.
        var jobs = [], warnings = 0, doc, file, base, suffix, used = {}, paths = {}, exists = false;
        var folder = app.project.file ? app.project.file.parent : Folder.myDocuments;
        for (i = 0; i < layers.length; i++) {
            doc = AEShapeExport.documentFor(comp, layers[i], time, strict.value);
            warnings += doc.warnings.length;
            base = AEShapeExport.safeName(comp.name + '_' + layers[i].name);
            suffix = base;
            var serial = 2;
            while (used['$' + suffix.toLowerCase()]) { suffix = base + '_' + serial++; }
            used['$' + suffix.toLowerCase()] = true;
            jobs.push({name: suffix + '.svg', text: AEShapeExport.stringify(doc)});
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
            exists = exists || file.exists;
            if (keepJson.value) { exists = exists || jobs[i].json.exists; }
        }
        if (exists && !confirm('既存の出力ファイルを上書きしますか？')) { return; }
        var written = 0, saved = [], cleanupWarnings = [];
        for (i = 0; i < jobs.length; i++) {
            file = jobs[i].file;
            var work = AEShapeRunner.workFolder();
            var input = new File(work.fsName + '/input.json'), output = new File(work.fsName + '/output.svg');
            var log = new File(work.fsName + '/convert.log');
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
            } catch (conversionError) {
                throw new Error(conversionError.toString() + '\n作業フォルダー: ' + work.fsName +
                    '\n保存済みSVG: ' + written + ' 件\n' + saved.join('\n'));
            }
            cleanupWarnings = cleanupWarnings.concat(AEShapeRunner.cleanup(work, [input, output, log, new File(log.fsName + '.status')]));
        }
        alert('SVGを保存しました: ' + written + ' 件\n' + saved.join('\n') +
            (cleanupWarnings.length ? '\n削除できなかった中間ファイル:\n' + cleanupWarnings.join('\n') : ''));
    } catch (e) { alert('シェイプの書き出しに失敗しました。\n' + e.toString()); }
}());
