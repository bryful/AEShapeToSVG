// Exercise the JSX workflow without AE. Native dialog behavior still needs AE verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../export-shapes.jsx'), 'utf8').replace(/^#.*$/gm, '');
function run(choices, options = {}) {
    const writes = [], suggestions = [], alerts = [], labels = [], evaluations = [], conversions = [], copies = [], cleaned = [], aiConversions = [];
    function folders(name){this.fsName=name;this.exists=true;}
    folders.myDocuments={fsName:'/documents'};folders.current={fsName:'/original'};
    const preferences=options.preferences || {};
    function File(name) {
        this.fsName = name;
        this.name = name.split('/').pop();
        this.parent = {fsName: name.slice(0, name.lastIndexOf('/'))};
        this.exists = this.name === 'export-shapes.exe' ? !options.missingExe :
            options.existingAi ? this.name.endsWith('.ai') : !!options.exists;
    }
    File.prototype.saveDlg = function () {
        suggestions.push(this.fsName);
        assert.equal(folders.current.fsName, this.parent.fsName);
        const chosen = choices.shift();
        return chosen == null ? null : new File(chosen);
    };
    File.prototype.open = function () { return true; };
    File.prototype.write = function (text) { writes.push({path: this.fsName, text}); return true; };
    File.prototype.close = function () { return true; };
    File.prototype.copy = function (target) { copies.push(target); return true; };
    function Widget() {}
    const checkboxes = [], uiButtons=[];
    Widget.prototype.add = function (type, unused, label) {
        if (label) labels.push(label);
        const widget = new Widget();
        if(type==='checkbox') checkboxes.push({label, widget});
        if(type==='button') uiButtons.push({label,widget});
        return widget;
    };
    Widget.prototype.show = function () {
        if(options.changeIllustrator)uiButtons.find(b=>b.label.includes('バージョン変更')).widget.onClick();
        if(options.resetFolder)uiButtons.find(b=>b.label.includes('記憶を解除')).widget.onClick();
        checkboxes.forEach(({label,widget}) => {
            if(label.indexOf('中間JSON')===0) widget.value=!!options.keepJson;
            if(label.indexOf('AIも')===0) widget.value=options.exportAi===undefined?widget.value:!!options.exportAi;
        });
        return 1;
    };
    function CompItem() {
        this.name = 'コンポ 1'; this.time = 1.25;
        this.selectedLayers = (options.layers || ['シェイプ 1']).map(name => ({name, matchName: 'ADBE Vector Layer'}));
    }
    vm.runInNewContext(source, {
        CompItem, File, Folder: folders, Window: Widget,
        $: {os:'Windows', fileName:'/scripts/export-shapes.jsx'},
        AEShapeSettings: {
            get:key=>preferences[key]||'',set:(key,value)=>{preferences[key]=String(value);},
            outputFolder:()=>new folders(preferences.outputFolder||'/project')
        },
        AEShapeIllustrator: {
            ensure:path=>options.cancelIllustrator?null:path||'/Illustrator/Illustrator.exe',
            choose:()=>options.chosenPath||'/Illustrator/Illustrator.exe',
            convert:(exe,svg,ai,status,canvas)=>{
                aiConversions.push({exe,svg:svg.fsName,ai:ai.fsName});
                if(options.failAi)throw Error('AI変換に失敗しました');
            }
        },
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
                if (options.failEvaluation) throw Error('取得失敗');
                return {warnings: options.incomplete ? ['unavailable'] : [], name: layer.name};
            }, stringify: JSON.stringify
        },
        alert: message => alerts.push(message), confirm: () => !options.declineOverwrite
    });
    assert.equal(folders.current.fsName, '/original');
    return {writes, suggestions, alerts, labels, evaluations, conversions, copies, cleaned, preferences, aiConversions};
}
let result = run(['/chosen/別名']);
assert.deepEqual(result.suggestions, ['/project/コンポ 1_シェイプ 1.svg']);
assert.deepEqual(result.copies, ['/chosen/別名.svg']);
assert.equal(result.preferences.outputFolder,'/chosen');
assert.equal(result.cleaned.length,1);
assert.deepEqual(result.evaluations,[{time:1.25,strict:false}]);
assert(result.alerts[0].includes('SVGを保存しました'));
for(const layers of [[],['A','B']]){
 result=run([],{layers});
 assert(result.alerts[0].includes('1枚だけ'));
 assert.equal(result.suggestions.length,0);assert.equal(result.writes.length,0);
}
result=run([null]);assert.equal(result.writes.length,0);assert.equal(result.preferences.outputFolder,undefined);
result=run(['/chosen/name.SVG'],{keepJson:true,exportAi:true});
assert.deepEqual(result.copies,['/chosen/name.SVG','/chosen/name.json','/chosen/name.ai']);
assert.equal(result.aiConversions.length,1);
result=run(['/chosen/name.svg'],{exists:true,declineOverwrite:true});assert.equal(result.writes.length,0);
for(const options of [{failEvaluation:true},{incomplete:true},{missingExe:true}]){
 result=run([],options);assert.equal(result.suggestions.length,0);assert.equal(result.writes.length,0);assert(result.alerts.length);
}
result=run(['/chosen/name.svg'],{failConversion:true});assert.equal(result.copies.length,0);assert.equal(result.cleaned.length,0);assert(result.alerts[0].includes('作業フォルダー'));
result=run(['/chosen/name.svg'],{exportAi:true,failAi:true});assert.deepEqual(result.copies,['/chosen/name.svg']);assert.equal(result.cleaned.length,0);
result=run(['/chosen/name.svg'],{exportAi:true,existingAi:true,declineOverwrite:true});assert.equal(result.conversions.length,0);
result=run([],{exportAi:true,cancelIllustrator:true});assert.equal(result.suggestions.length,0);
const preferences={outputFolder:'/remember',illustratorPath:'/AI29/Illustrator.exe'};
result=run([null],{preferences});assert.equal(result.suggestions[0],'/remember/コンポ 1_シェイプ 1.svg');
result=run([null],{preferences,resetFolder:true,changeIllustrator:true,chosenPath:'/AI30/Illustrator.exe'});
assert.equal(result.suggestions[0],'/project/コンポ 1_シェイプ 1.svg');assert.equal(preferences.illustratorPath,'/AI30/Illustrator.exe');
result=run([null],{layers:['a/b']});assert.equal(result.suggestions[0],'/project/コンポ 1_a_b.svg');
console.log('Export dialog mock tests passed');
