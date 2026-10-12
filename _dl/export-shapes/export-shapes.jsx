#target aftereffects
#include "(export-shapes)/export-core.js"

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
        var dialog = new Window('dialog', 'シェイプのJSON書き出し');
        dialog.orientation = 'column';
        dialog.alignChildren = 'left';
        dialog.add('statictext', undefined, '対象レイヤー: ' + layers.length + ' / 対象外: ' + ignored);
        dialog.add('statictext', undefined, 'カレント時間の静止画: ' + time + ' 秒');
        dialog.add('statictext', undefined, '現在はJSONのみ保存します。');
        var strict = dialog.add('checkbox', undefined, 'Contentsにアニメーションがある場合はエラーにする');
        strict.value = false;
        var buttons = dialog.add('group');
        buttons.add('button', undefined, 'JSONを書き出す', {name: 'ok'});
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
            jobs.push({name: suffix + '.json', text: AEShapeExport.stringify(doc)});
        }
        if (warnings && !confirm('取得できない値があります。\nJSONはcomplete=falseになります。\n不完全なJSONを保存しますか？')) { return; }
        // File.saveDlg uses this File as the initial filename (native Save As dialog).
        // Select all destinations before writing, so cancelling saves no files.
        for (i = 0; i < jobs.length; i++) {
            do {
                file = new File(folder.fsName + '/' + jobs[i].name).saveDlg(
                    'JSONを名前を付けて保存 (' + (i + 1) + '/' + jobs.length + ')', 'JSONファイル:*.json');
                if (!file) { return; }
                if (!/\.json$/i.test(file.name)) { file = new File(file.fsName + '.json'); }
                var key = '$' + file.fsName.toLowerCase();
                if (paths[key]) { alert('別のレイヤーと同じ保存先です。別名を指定してください。'); }
            } while (paths[key]);
            paths[key] = true;
            folder = file.parent;
            jobs[i].file = file;
            exists = exists || file.exists;
        }
        if (exists && !confirm('既存のJSONファイルを上書きしますか？')) { return; }
        var written = 0, saved = [];
        for (i = 0; i < jobs.length; i++) {
            file = jobs[i].file;
            file.encoding = 'UTF-8';
            if (!file.open('w')) { throw new Error('ファイルを開けません: ' + file.fsName + '\n保存済み: ' + written + ' 件'); }
            var ok = false, closed = false;
            try { ok = file.write(jobs[i].text + '\n'); }
            finally { closed = file.close(); }
            if (!ok || !closed) { throw new Error('書き込みに失敗しました: ' + file.fsName + '\n保存済み: ' + written + ' 件'); }
            written++;
            saved.push(file.fsName);
        }
        alert('JSONを保存しました: ' + written + ' 件\n警告: ' + warnings + ' 件\n' + saved.join('\n'));
    } catch (e) { alert('シェイプの書き出しに失敗しました。\n' + e.toString()); }
}());
