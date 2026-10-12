// Exercise the JSX workflow without AE. Native dialog behavior still needs AE verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../export-shapes.jsx'), 'utf8').replace(/^#.*$/gm, '');
function run(choices, options = {}) {
    const writes = [], suggestions = [], alerts = [], labels = [], evaluations = [];
    const folders = {myDocuments: {fsName: '/documents'}, current: {fsName: '/original'}};
    let prompt = 0;
    function File(name) {
        this.fsName = name;
        this.name = name.split('/').pop();
        this.parent = {fsName: name.slice(0, name.lastIndexOf('/'))};
        this.exists = !!options.exists;
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
    function Widget() {}
    Widget.prototype.add = function (type, unused, label) { if (label) labels.push(label); return new Widget(); };
    Widget.prototype.show = function () { return 1; };
    function CompItem() {
        this.name = 'コンポ 1'; this.time = 1.25;
        this.selectedLayers = (options.layers || ['シェイプ 1']).map(name => ({name, matchName: 'ADBE Vector Layer'}));
    }
    vm.runInNewContext(source, {
        CompItem, File, Folder: folders, Window: Widget,
        app: {project: {activeItem: new CompItem(), file: new File('/project/test.aep')}},
        AEShapeExport: {
            safeName: name => name.replace(/[<>:"/\\|?*]/g, '_'),
            documentFor: (comp, layer, time, strict) => {
                evaluations.push({time, strict});
                if (options.failEvaluation && evaluations.length === 2) throw Error('取得失敗');
                return {warnings: [], name: layer.name};
            }, stringify: JSON.stringify
        },
        alert: message => alerts.push(message), confirm: () => !options.declineOverwrite
    });
    assert.equal(folders.current.fsName, '/original');
    return {writes, suggestions, alerts, labels, evaluations};
}
let result = run(['/chosen/別名']);
assert.deepEqual(result.suggestions, ['/project/コンポ 1_シェイプ 1.json']);
assert.equal(result.writes[0].path, '/chosen/別名.json');
assert.deepEqual(result.evaluations, [{time: 1.25, strict: false}]);
assert(result.labels.includes('キャンセル'));
assert(result.alerts[0].includes('JSONを保存しました'));
result = run(['/chosen/一番.JSON', '/chosen/二番.json'], {layers: ['同名', '同名']});
assert.deepEqual(result.suggestions, ['/project/コンポ 1_同名.json', '/project/コンポ 1_同名_2.json']);
assert.equal(result.writes[0].path, '/chosen/一番.JSON');
assert.equal(result.writes.length, 2);
result = run(['/chosen/一番.json', null], {layers: ['A', 'B']});
assert.equal(result.writes.length, 0);
result = run(['/chosen/一番.json', '/chosen/一番.json', '/chosen/二番.json'], {layers: ['A', 'B']});
assert.equal(result.writes.length, 2);
assert(result.alerts[0].includes('別名を指定'));
result = run(['/chosen/existing.json'], {exists: true, declineOverwrite: true});
assert.equal(result.writes.length, 0);
result = run([], {layers: ['A', 'B'], failEvaluation: true});
assert.equal(result.suggestions.length, 0);
assert.equal(result.writes.length, 0);
assert(result.alerts[0].includes('書き出しに失敗'));
console.log('Export dialog mock tests passed');
