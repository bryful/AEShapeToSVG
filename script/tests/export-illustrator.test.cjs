const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const files=new Map(), executables=['/AI29/Illustrator.exe','/AI30/Illustrator.exe'];
executables.forEach(p=>files.set(p,'exe'));
let selectedFile=null, clock=0, pending=null, mode='success', savedOptions, closed=0, opened=0, sentTarget;
function File(name){this.fsName=String(name);this.name=this.fsName.split('/').pop();}
Object.defineProperty(File.prototype,'exists',{get(){return files.has(this.fsName);}});
Object.defineProperty(File.prototype,'length',{get(){return (files.get(this.fsName)||'').length;}});
File.prototype.open=function(){return true;};
File.prototype.read=function(){return files.get(this.fsName)||'';};
File.prototype.write=function(s){files.set(this.fsName,s);return true;};
File.prototype.close=function(){return true;};
File.prototype.remove=function(){return files.delete(this.fsName);};
File.prototype.execute=function(){return true;};
File.openDialog=()=>selectedFile;
function BridgeTalk(){}
BridgeTalk.getTargets=()=>['aftereffects-25.0','illustrator-29.0','illustrator-30.0'];
BridgeTalk.getAppPath=t=>t==='illustrator-29.0'?executables[0]:executables[1];
BridgeTalk.prototype.send=function(){pending=this;sentTarget=this.target;return false;}; // queued launch is not failure
const aiApp={userInteractionLevel:'ALERT',open(file){
    opened++;
    return {artboards:[{artboardRect:[10,200,100,100]}],
        saveAs(file,options){
            if(mode==='saveError')throw Error('save failed');
            savedOptions=options;files.set(file.fsName,'%PDF-native-ai');
        },close(){closed++;}};
}};
const aiContext=vm.createContext({app:aiApp,File,UserInteractionLevel:{DONTDISPLAYALERTS:'SILENT'},
    IllustratorSaveOptions:function(){},SaveOptions:{DONOTSAVECHANGES:'DISCARD'}});
BridgeTalk.pump=()=>{
    if(!pending||mode==='timeout')return;
    const msg=pending;pending=null;
    if(mode==='communicationError'){msg.onError({body:'BridgeTalk error'});return;}
    try{vm.runInContext(msg.body,aiContext);}
    catch(error){msg.onError({body:error.toString()});}
};
function Clock(){this.getTime=()=>clock;}
const context=vm.createContext({File,BridgeTalk,Date:Clock,$:{sleep(ms){clock+=ms;}},
    AEShapeExport:{stringify:JSON.stringify},AEShapeRunner:{read:file=>files.get(file.fsName)||''}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../(export-shapes)/export-illustrator.js'),'utf8'),context);
const illustrator=context.AEShapeIllustrator;
assert.equal(illustrator.ensure(''),executables[1]);
assert.equal(illustrator.ensure(executables[0]),executables[0]);
selectedFile=new File(executables[0]);
assert.equal(illustrator.ensure('/missing/Illustrator.exe'),executables[0]);
selectedFile=null;assert.equal(illustrator.choose(),null);
selectedFile=new File('/wrong.exe');files.set(selectedFile.fsName,'exe');
assert.throws(()=>illustrator.choose(),/Illustrator.exeを選択/);
const svg=new File('/日本語 & "quoted"/input.svg'), ai=new File('/temporary/output.ai'), status=new File('/temporary/ai.status');
files.set(svg.fsName,'<svg/>');
illustrator.convert(executables[0],svg,ai,status,{width:320,height:180});
assert.equal(sentTarget,'illustrator-29.0');
assert.equal(files.get(status.fsName),'OK');assert(files.has(ai.fsName));
assert.equal(aiApp.userInteractionLevel,'ALERT');assert.equal(closed,1);assert.equal(opened,1);
assert(savedOptions.pdfCompatible&&savedOptions.compressed);
mode='saveError';files.delete(ai.fsName);
assert.throws(()=>illustrator.convert(executables[0],svg,ai,status,{width:320,height:180}),/save failed/);
assert.equal(aiApp.userInteractionLevel,'ALERT');assert.equal(closed,2);assert(!files.has(ai.fsName));
mode='communicationError';
assert.throws(()=>illustrator.convert(executables[0],svg,ai,status,{width:320,height:180}),/BridgeTalk error/);
mode='timeout';
assert.throws(()=>illustrator.convert(executables[0],svg,ai,status,{width:320,height:180}),/タイムアウト/);
console.log('Illustrator mock tests passed: chosen version, queued launch, save/close, restored UI, errors/timeouts');
