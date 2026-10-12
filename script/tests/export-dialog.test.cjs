// Exercise the JSX workflow without AE. Native dialog behavior still needs AE verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../export-shapes.jsx'), 'utf8').replace(/^#.*$/gm, '');
function run(choices, options = {}) {
    const writes = [], suggestions = [], alerts = [], labels = [], evaluations = [], conversions = [], copies = [], cleaned = [];
    const folders = {myDocuments: {fsName: '/documents'}, current: {fsName: '/original'}};
    let prompt = 0;
    function File(name) {
        this.fsName = name;
        this.name = name.split('/').pop();
        this.parent = {fsName: name.slice(0, name.lastIndexOf('/'))};
        this.exists = this.name === 'export-shapes.exe' ? !options.missingExe : !!options.exists;
    }
    File.prototype.saveDlg = function () {
        assert.equal(folders.current.fsName, '/project');
        suggestions.push(this.fsName);
        const choice = choices[prompt++];
        return choice == null ? null : new File(choice);
    };
    File.prototype.open = function () { return true; };
    File.prototype.write = function (text) { writes.push({path: this.fsName, text}); return true; };
    File.prototype.close = function () { return true; };
    File.prototype.copy = function (target) { copies.push(target); return true; };
    function Widget() {}
    const checkboxes = [];
    Widget.prototype.add = function (type, unused, label) {
        if (label) labels.push(label);
        const widget = new Widget();
        if(type==='checkbox') checkboxes.push({label, widget});
        return widget;
    };
    Widget.prototype.show = function () {
        checkboxes.forEach(({label,widget}) => {if(label.indexOf('中間JSON')===0) widget.value=!!options.keepJson;});
        return 1;
    };
    function CompItem() {
        this.name = 'コンポ 1'; this.time = 1.25;
        this.selectedLayers = (options.layers || ['シェイプ 1']).map(name => ({name, matchName: 'ADBE Vector Layer'}));
    }
    vm.runInNewContext(source, {
        CompItem, File, Folder: folders, Window: Widget,
        $: {os:'Windows', fileName:'/scripts/export-shapes.jsx'},
        AEShapeRunner: {
            workFolder: () => ({fsName:'/temp/job'}),
            write: (file,text) => writes.push({path:file.fsName,text}),
            convert: (exe,input,output,log) => {
                conversions.push({exe:exe.fsName,input:input.fsName,output:output.fsName});
                if(options.failConversion) throw Error('SVG変換に失敗しました');
            },
            cleanup: folder => {cleaned.push(folder.fsName);return [];}
        },
        app: {project: {activeItem: new CompItem(), file: new File('/project/test.aep')}},
        AEShapeExport: {
            safeName: name => name.replace(/[<>:"/\\|?*]/g, '_'),
            documentFor: (comp, layer, time, strict) => {
                evaluations.push({time, strict});
                if (options.failEvaluation && evaluations.length === 2) throw Error('取得失敗');
                return {warnings: options.incomplete ? ['unavailable'] : [], name: layer.name};
            }, stringify: JSON.stringify
        },
        alert: message => alerts.push(message), confirm: () => !options.declineOverwrite
    });
    assert.equal(folders.current.fsName, '/original');
    return {writes, suggestions, alerts, labels, evaluations, conversions, copies, cleaned};
}
let result = run(['/chosen/別名']);
assert.deepEqual(result.suggestions, ['/project/コンポ 1_シェイプ 1.svg']);
assert.equal(result.writes[0].path, '/temp/job/input.json');
assert.deepEqual(result.copies, ['/chosen/別名.svg']);
assert.equal(result.conversions[0].exe, '/scripts/export-shapes.exe');
assert.equal(result.cleaned.length, 1);
assert.deepEqual(result.evaluations, [{time: 1.25, strict: false}]);
assert(result.labels.includes('キャンセル'));
assert(result.alerts[0].includes('SVGを保存しました'));
result = run(['/chosen/一番.SVG', '/chosen/二番.svg'], {layers: ['同名', '同名']});
assert.deepEqual(result.suggestions, ['/project/コンポ 1_同名.svg', '/project/コンポ 1_同名_2.svg']);
assert.equal(result.copies[0], '/chosen/一番.SVG');
assert.equal(result.writes.length, 2);
result = run(['/chosen/一番.svg', null], {layers: ['A', 'B']});
assert.equal(result.writes.length, 0);
result = run(['/chosen/一番.svg', '/chosen/一番.svg', '/chosen/二番.svg'], {layers: ['A', 'B']});
assert.equal(result.writes.length, 2);
assert(result.alerts[0].includes('別名を指定'));
result = run(['/chosen/existing.svg'], {exists: true, declineOverwrite: true});
assert.equal(result.writes.length, 0);
result = run([], {layers: ['A', 'B'], failEvaluation: true});
assert.equal(result.suggestions.length, 0);
assert.equal(result.writes.length, 0);
assert(result.alerts[0].includes('書き出しに失敗'));
result=run(['/chosen/保持.svg'],{keepJson:true});
assert.deepEqual(result.copies,['/chosen/保持.svg','/chosen/保持.json']);
result=run(['/chosen/失敗.svg'],{failConversion:true});
assert.equal(result.copies.length,0);
assert.equal(result.cleaned.length,0);
assert(result.alerts[0].includes('作業フォルダー'));
result=run([],{missingExe:true});
assert.equal(result.writes.length,0);
assert(result.alerts[0].includes('export-shapes.exeを配置'));
result=run([],{incomplete:true});
assert.equal(result.suggestions.length,0);
assert.equal(result.conversions.length,0);
console.log('Export dialog mock tests passed');
