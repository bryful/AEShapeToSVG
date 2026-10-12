const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const stored={},existing=new Set(['/remembered']);
function Folder(name){this.fsName=name;this.exists=existing.has(name);}
Folder.myDocuments={fsName:'/documents'};
const app={project:{file:{parent:{fsName:'/aep'}}},settings:{
    haveSetting:(section,key)=>Object.hasOwn(stored,section+'.'+key),
    getSetting:(section,key)=>stored[section+'.'+key],
    saveSetting:(section,key,value)=>{stored[section+'.'+key]=value;}
}};
const context=vm.createContext({app,Folder});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../(export-shapes)/export-settings.js'),'utf8'),context);
const settings=context.AEShapeSettings;
assert.equal(settings.outputFolder({}).fsName,'/aep');
settings.set('outputFolder','/remembered');assert.equal(settings.outputFolder({}).fsName,'/remembered');
settings.set('outputFolder','/removed');assert.equal(settings.outputFolder({}).fsName,'/aep');
settings.set('outputFolder','');app.project.file=null;assert.equal(settings.outputFolder({}).fsName,'/documents');
settings.set('illustratorPath','C:/日本語/Illustrator.exe');assert.equal(settings.get('illustratorPath'),'C:/日本語/Illustrator.exe');
settings.set('exportAi',true);assert.equal(settings.get('exportAi'),'true');
console.log('Settings mock tests passed: remembered paths, deleted folder fallback, unsaved AEP, preferences');
