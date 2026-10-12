// Windows-only: exercise the exact command sent to AE system.callSystem using the real exe.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execSync} = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-runner-'));
const unusual = path.join(root, "日本語 & %PATH% ' $(literal) 😀");
fs.mkdirSync(unusual);
function File(name) { this.fsName = name; }
Object.defineProperty(File.prototype,'exists',{get(){return fs.existsSync(this.fsName);}});
Object.defineProperty(File.prototype,'length',{get(){return fs.statSync(this.fsName).size;}});
File.prototype.open=function(mode){this.mode=mode;return true;};
File.prototype.write=function(text){fs.writeFileSync(this.fsName,text,'utf8');return true;};
File.prototype.read=function(){return fs.readFileSync(this.fsName,'utf8');};
File.prototype.close=function(){return true;};
File.prototype.remove=function(){fs.unlinkSync(this.fsName);return true;};
function Folder(name) { this.fsName=name; }
Object.defineProperty(Folder.prototype,'exists',{get(){return fs.existsSync(this.fsName);}});
Folder.temp={fsName:root};
Folder.prototype.create=function(){fs.mkdirSync(this.fsName);return true;};
Folder.prototype.remove=function(){fs.rmdirSync(this.fsName);return true;};
const context={File,Folder,system:{callSystem(command){
  execSync(command,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['pipe','pipe','pipe']});
  // Reproduce AE returning no stdout, despite successful native conversion.
  return '';
}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../(export-shapes)/export-runner.js'),'utf8'),context);
const runner=context.AEShapeRunner;
try {
    const exe=new File(path.join(unusual,'export-shapes.exe'));
    fs.copyFileSync(path.resolve('script/export-shapes.exe'),exe.fsName);
    const input=new File(path.join(unusual,'input.json'));
    const output=new File(path.join(unusual,'output.svg'));
    const log=new File(path.join(unusual,'convert.log'));
    runner.write(input,fs.readFileSync(path.resolve('sample/コンポ 1_シェイプレイヤー 2_2.json'),'utf8'));
    const command=runner.command(exe,input,output,log);
    assert(!command.includes(unusual));
    const encoded=command.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)[1];
    const decoded=Buffer.from(encoded,'base64').toString('utf16le');
    assert(decoded.includes(unusual.replace(/'/g,"''")));
    runner.convert(exe,input,output,log);
    assert.equal(fs.readFileSync(log.fsName+'.status','ascii'),'0');
    assert(fs.readFileSync(output.fsName,'utf8').includes('<svg'));
    assert(fs.readFileSync(log.fsName,'utf8').includes('SVG saved'));
    const actualCall=context.system.callSystem;
    context.system.callSystem=()=> 'AE_SHAPE_EXIT=0\r\n';
    // A previous successful SVG/status and a stdout marker cannot hide a launch failure.
    assert.throws(()=>runner.convert(exe,input,output,log),/終了コード: 取得できません/);
    context.system.callSystem=actualCall;
    output.remove();
    runner.write(input,'{"format":"invalid"}');
    assert.throws(()=>runner.convert(exe,input,output,log),/SVG変換に失敗/);
    assert.equal(fs.readFileSync(log.fsName+'.status','ascii'),'1');
    assert(input.exists && log.exists && !output.exists);
    const work=runner.workFolder(), temp=new File(path.join(work.fsName,'input.json'));
    runner.write(temp,'temporary');
    assert.equal(runner.cleanup(work,[temp]).length,0);
    assert(!work.exists);
    console.log('Runner integration passed: empty AE stdout, status files, stale status rejection, Unicode paths, failure logs, cleanup');
} finally {
    // root is the exact directory returned by mkdtemp, with no user-controlled components.
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root,{recursive:true,force:true});
}
