/* Illustrator conversion via BridgeTalk, restricted to the chosen executable/version. */
var AEShapeIllustrator = (function () {
    function apps() {
        var result = [], targets, i, path;
        if (typeof BridgeTalk === 'undefined') { return result; }
        targets = BridgeTalk.getTargets();
        for (i = 0; i < targets.length; i++) {
            if (!/^illustrator(?:-|$)/i.test(targets[i])) { continue; }
            try {
                path = new File(BridgeTalk.getAppPath(targets[i]));
                if (path.exists) { result.push({path: path.fsName, target: targets[i]}); }
            } catch (ignored) {}
        }
        result.sort(function (a, b) {
            return (parseFloat(b.target.replace(/^illustrator-/, '')) || 0) -
                (parseFloat(a.target.replace(/^illustrator-/, '')) || 0);
        });
        return result;
    }
    function find(path) {
        var available = apps(), normalized = new File(path).fsName.toLowerCase();
        for (var i = 0; i < available.length; i++) {
            if (available[i].path.toLowerCase() === normalized) { return available[i]; }
        }
        return null;
    }
    function choose() {
        var file = File.openDialog('使用するIllustrator.exeを選択（バージョン変更）', 'Illustrator:Illustrator.exe');
        if (!file) { return null; }
        if (!file.exists || !/^illustrator\.exe$/i.test(file.name)) {
            throw new Error('Illustrator.exeを選択してください。');
        }
        return file.fsName;
    }
    function ensure(path) {
        if (path && new File(path).exists && /^illustrator\.exe$/i.test(new File(path).name)) { return path; }
        // A saved version that disappeared must be reselected, not silently replaced.
        if (!path) {
            var available = apps();
            if (available.length) { return available[0].path; }
        }
        return choose();
    }
    // Runs in Illustrator, with no access to the AE globals or included libraries.
    function worker(svgPath, aiPath, statusPath, width, height) {
        var document = null, previousInteraction = app.userInteractionLevel, error = '';
        try {
            app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
            document = app.open(new File(svgPath));
            if (width > 0 && height > 0) {
                var board = document.artboards[0].artboardRect;
                document.artboards[0].artboardRect = [board[0], board[1], board[0] + width, board[1] - height];
            }
            var options = new IllustratorSaveOptions();
            options.pdfCompatible = true;
            options.compressed = true;
            document.saveAs(new File(aiPath), options);
        } catch (e) { error = e.toString(); }
        finally {
            try { if (document) { document.close(SaveOptions.DONOTSAVECHANGES); } }
            catch (closeError) { if (!error) { error = closeError.toString(); } }
            app.userInteractionLevel = previousInteraction;
        }
        var status = new File(statusPath);
        status.encoding = 'UTF-8';
        if (!status.open('w')) { throw new Error('AI変換の結果ファイルを作成できません。'); }
        var ok = false, closed = false;
        try { ok = status.write(error ? 'ERROR\n' + error : 'OK'); }
        finally { closed = status.close(); }
        if (!ok || !closed) { throw new Error('AI変換の結果を書き込めません。'); }
        return error ? 'ERROR' : 'OK';
    }
    function body(svg, ai, status, canvas) {
        return '(' + worker.toString() + ')(' + AEShapeExport.stringify(svg.fsName) + ',' +
            AEShapeExport.stringify(ai.fsName) + ',' + AEShapeExport.stringify(status.fsName) + ',' +
            Number(canvas.width) + ',' + Number(canvas.height) + ');';
    }
    function convert(path, svg, ai, status, canvas) {
        if (typeof BridgeTalk === 'undefined') { throw new Error('Illustrator連携に必要なBridgeTalkを利用できません。'); }
        var selected = find(path);
        if (!selected) {
            // Give an explicitly selected installation a chance to register on first launch.
            if (!new File(path).execute()) { throw new Error('Illustratorを起動できません: ' + path); }
            var launchEnd = new Date().getTime() + 30000;
            while (!selected && new Date().getTime() < launchEnd) {
                BridgeTalk.pump(); $.sleep(100); selected = find(path);
            }
            if (!selected) {
                throw new Error('選択したIllustratorをBridgeTalkで識別できません。起動完了後に再実行するか、Illustratorを選び直してください。\n' + path);
            }
        }
        if (status.exists && !status.remove()) { throw new Error('前回のAI変換結果を削除できません。'); }
        var message = new BridgeTalk(), communicationError = '', end = new Date().getTime() + 180000;
        message.target = selected.target;
        message.body = body(svg, ai, status, canvas);
        message.timeout = 180;
        message.onError = function (response) { communicationError = response.body; };
        message.onTimeout = function () { communicationError = 'Illustratorの応答がタイムアウトしました。'; };
        // false can mean the application is launching and the message has been queued.
        message.send();
        while (!communicationError && new Date().getTime() < end) {
            BridgeTalk.pump();
            var result = AEShapeRunner.read(new File(status.fsName)).replace(/^\uFEFF/, '');
            if (result === 'OK') {
                var generated = new File(ai.fsName);
                if (generated.exists && generated.length > 0) { return; }
                throw new Error('IllustratorからAIファイルが出力されませんでした。');
            }
            if (result.indexOf('ERROR\n') === 0) { throw new Error('AI変換に失敗しました。\n' + result.slice(6)); }
            $.sleep(100);
        }
        throw new Error('AI変換を完了できませんでした。\n' + (communicationError || 'Illustratorの起動・応答待ちがタイムアウトしました。') +
            '\nSVGは保存済みです。Illustratorのダイアログや起動状態を確認してください。');
    }
    return {apps: apps, choose: choose, ensure: ensure, body: body, convert: convert};
}());
