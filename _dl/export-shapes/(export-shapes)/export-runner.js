/* ExtendScript ES3. Windows converter invocation and temporary-file handling. */
var AEShapeRunner = (function () {
    function write(file, text) {
        file.encoding = 'UTF-8';
        if (!file.open('w')) { throw new Error('ファイルを開けません: ' + file.fsName); }
        var ok = false, closed = false;
        try { ok = file.write(text); } finally { closed = file.close(); }
        if (!ok || !closed) { throw new Error('書き込みに失敗しました: ' + file.fsName); }
    }
    function read(file) {
        file.encoding = 'UTF-8';
        if (!file.exists || !file.open('r')) { return ''; }
        try { return file.read(); } finally { file.close(); }
    }
    function workFolder() {
        for (var i = 0; i < 20; i++) {
            var folder = new Folder(Folder.temp.fsName + '/ae-export-shapes-' +
                new Date().getTime() + '-' + Math.floor(Math.random() * 1000000000));
            if (!folder.exists && folder.create()) { return folder; }
        }
        throw new Error('中間ファイル用の一時フォルダーを作成できません。');
    }
    function literal(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
    function encodedCommand(s) {
        // PowerShell -EncodedCommand requires UTF-16LE, including surrogate pairs.
        var bytes = [], alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', result = '', i;
        for (i = 0; i < s.length; i++) { bytes.push(s.charCodeAt(i) & 255, s.charCodeAt(i) >> 8); }
        for (i = 0; i < bytes.length; i += 3) {
            var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
            result += alphabet.charAt(a >> 2) + alphabet.charAt(((a & 3) << 4) | (b >> 4)) +
                (i + 1 < bytes.length ? alphabet.charAt(((b & 15) << 2) | (c >> 6)) : '=') +
                (i + 2 < bytes.length ? alphabet.charAt(c & 63) : '=');
        }
        return result;
    }
    function command(exe, input, output, log) {
        // Paths stay in PowerShell literal strings inside the encoded payload.
        // cmd.exe never interprets user-controlled %, &, apostrophes or parentheses.
        var script = '$ErrorActionPreference="Continue"; & ' + literal(exe.fsName) + ' ' + literal(input.fsName) +
            ' ' + literal(output.fsName) + ' 2>&1 | Out-File -LiteralPath ' + literal(log.fsName) +
            ' -Encoding utf8; $code=$LASTEXITCODE; Write-Output ("AE_SHAPE_EXIT="+$code)';
        return 'cmd.exe /d /s /c ""%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"' +
            ' -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + encodedCommand(script) + '"';
    }
    function convert(exe, input, output, log) {
        var response = system.callSystem(command(exe, input, output, log));
        if (!/AE_SHAPE_EXIT=0(?:\r?\n|$)/.test(response) || !new File(output.fsName).exists ||
            new File(output.fsName).length <= 0) {
            throw new Error('SVG変換に失敗しました。\n' + read(log) + '\n中間JSON: ' + input.fsName + '\nログ: ' + log.fsName);
        }
    }
    function cleanup(folder, files) {
        var failed = [];
        for (var i = 0; i < files.length; i++) {
            if (new File(files[i].fsName).exists && !files[i].remove()) { failed.push(files[i].fsName); }
        }
        if (!failed.length && !folder.remove()) { failed.push(folder.fsName); }
        return failed;
    }
    return {write: write, workFolder: workFolder, command: command, convert: convert, cleanup: cleanup};
}());
