// Native AEP parsing + SVG paints + local fallback policy. No AE installation required.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const exe=path.resolve(process.argv[2]||'script/export-shapes.exe');
const aep=path.resolve('sample/002/002.aep');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ae-gradients-'));
const prop=(matchName,value)=>({matchName,value,status:'evaluated'});
function invoke(args,status=0){const r=spawnSync(exe,args,{encoding:'utf8'});assert.equal(r.status,status,r.stderr);return r;}
function document(report){return {format:'ae-shape-contents',schemaVersion:1,scope:'contentsOnly',complete:true,
 source:{projectFile:aep,projectDirty:false,composition:{name:'コンポ 1',width:1000,height:1000},
 layer:{name:'シェイプレイヤー 1',position:[500,500],anchorPoint:[0,0]},evaluation:{timeSeconds:1.25}},
 contents:{kind:'contents',matchName:'ADBE Root Vectors Group',children:report.gradients.map((g,i)=>({
 kind:'group',matchName:'ADBE Vector Group',name:g.navigation[2],children:[
 {kind:'contents',matchName:'ADBE Vectors Group',children:[
 {kind:'rectangle',matchName:'ADBE Vector Shape - Rect',children:[prop('ADBE Vector Rect Size',[100,100])]},
 {kind:'fill',matchName:'ADBE Vector Graphic - Fill',name:g.navigation[3],replacement:'gradientToSolid',
 gradientRequest:{timeSeconds:1.25,keyframeCount:0,expressionEnabled:false,properties:{
 'ADBE Vector Grad Type':1,'ADBE Vector Grad Start Pt':[-50,0],'ADBE Vector Grad End Pt':[50,0]}},
 children:[prop('ADBE Vector Fill Color',[1,0,0,1])]}]},
 {matchName:'ADBE Vector Transform Group',children:[prop('ADBE Vector Position',[[305,0],[133,0],[0,0],[-127,0]][i])]}]}))}};}
let serial=0;
function convert(doc){const input=path.join(temp,`input${serial++}.json`),output=input+'.svg';
 fs.writeFileSync(input,JSON.stringify(doc));const result=invoke([input,output]);return {svg:fs.readFileSync(output,'utf8'),log:result.stderr};}
async function main(){
 const output=path.join(temp,'inspection.json');
 invoke(['--inspect-gradients',aep,output,'--time','1.25']);
 const report=JSON.parse(fs.readFileSync(output,'utf8'));
 assert.equal(report.timeSeconds,1.25);assert.equal(report.gradients.length,4);
 assert(report.gradients.every(g=>g.status==='extracted'));
 assert.deepEqual(report.gradients.map(g=>g.colors.map(s=>s.slice(2,5))),[
  [[0,0,1],[0,0,1]],[[0,0,1],[1,1,1]],[[0,1,0],[1,1,1]],[[1,0,0],[0,0,0]]]);
 assert.deepEqual(report.gradients[0].opacities,[[0,.25,1],[1,.5,0]]);
 invoke(['--inspect-gradients',aep,output],1);
 invoke(['--inspect-gradients',aep,output,'--time','NaN'],1);
 invoke(['--inspect-gradients',aep,aep,'--time','0'],1);
 let doc=document(report),result=convert(doc);
 assert.equal((result.svg.match(/<linearGradient /g)||[]).length,4);
 assert(result.svg.includes('stop-opacity="0"'));assert(result.svg.includes('offset="0.25"'));
 assert.equal(result.log,'');
 if(process.argv[3]){
  const sharp=require(process.argv[3]);
  const {data,info}=await sharp(Buffer.from(result.svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const pixel=(x,y)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)];
  const red=pixel(324,500),green=pixel(451,500),blue=pixel(584,500),fade=pixel(779,500);
  assert(red[0]>240&&red[1]<10&&red[2]<10,JSON.stringify(red));
  assert(green[1]>240&&green[0]<10,JSON.stringify(green));
  assert(blue[2]>240&&blue[0]<10,JSON.stringify(blue));
  assert(fade[2]>240&&Math.abs(fade[3]-128)<8,JSON.stringify(fade));
 }
 for(const keys of [1,2]){
  doc=document(report);const style=doc.contents.children[0].children[0].children[1];
  style.gradientRequest.keyframeCount=keys;result=convert(doc);
  assert.equal((result.svg.match(/<linearGradient /g)||[]).length,3);
  assert(result.svg.includes('fill="rgb(255,0,0)"'));assert(result.log.includes('GRADIENT_KEY_ANIMATION'));
  style.kind='stroke';style.matchName='ADBE Vector Graphic - Stroke';
  style.children=[prop('ADBE Vector Stroke Color',[0,0,1,1]),prop('ADBE Vector Stroke Width',4)];
  result=convert(doc);assert(result.svg.includes('stroke="rgb(0,0,255)"'));
 }
 doc=document(report);doc.source.evaluation.timeSeconds=2;
 result=convert(doc);assert(!result.svg.includes('<linearGradient'));assert(result.log.includes('time mismatch'));
 doc=document(report);doc.source.projectDirty=true;
 result=convert(doc);assert(!result.svg.includes('<linearGradient'));assert(result.log.includes('unsaved changes'));
 doc=document(report);doc.source.projectFile=null;
 result=convert(doc);assert(!result.svg.includes('<linearGradient'));assert(result.log.includes('Project not saved'));
 doc=document(report);doc.contents.children[0].children[0].children[1].name='missing';
 result=convert(doc);assert(result.log.includes('path not found'));
 doc=document(report);doc.contents.children.push(JSON.parse(JSON.stringify(doc.contents.children[1])));
 // Duplicate requests are fine; duplicate AEP paths themselves must be rejected.
 result=convert(doc);assert.equal(result.log,'');
 doc=document(report);doc.contents.children[0].children[0].children[1].gradientRequest.properties['ADBE Vector Grad Type']=2;
 result=convert(doc);assert(result.svg.includes('<radialGradient '));
 const broken=path.join(temp,'broken.aep');fs.writeFileSync(broken,fs.readFileSync(aep).subarray(0,100));
 invoke(['--inspect-gradients',broken,output,'--time','0'],1);
 // Minimal bounded RIFX fixtures: one key container and repeated gradient paths.
 const chunk=(tag,data)=>{const header=Buffer.alloc(8);header.write(tag);header.writeUInt32BE(data.length,4);return Buffer.concat([header,data,data.length%2?Buffer.alloc(1):Buffer.alloc(0)]);};
 const list=(kind,...children)=>chunk('LIST',Buffer.concat([Buffer.from(kind),...children]));
 const utf=text=>chunk('Utf8',Buffer.from(text));
 const aepBytes=fs.readFileSync(aep),xmls=aepBytes.toString('utf8').match(/<\?xml[^]*?<\/prop.map>/g);
 const key=xml=>list('GCst',list('tdbs',list('ldat')),list('GCky',utf(xml)));
 const fixture=path.join(temp,'keyed.aep');
 fs.writeFileSync(fixture,chunk('RIFX',Buffer.concat([Buffer.from('Egg!'),key(xmls[0])])));
 invoke(['--inspect-gradients',fixture,output,'--time','1.25'],1);
 assert(JSON.parse(fs.readFileSync(output,'utf8')).gradients[0].error.includes('GRADIENT_KEY_ANIMATION'));
 const staticGradient=list('GCst',list('GCky',utf(xmls[0])));
 const named=(name,...children)=>list('tdgp',chunk('tdsn',utf(name)),...children);
 const duplicate=list('Item',utf('コンポ 1'),list('Layr',utf('シェイプレイヤー 1'),
  named(report.gradients[0].navigation[2],named(report.gradients[0].navigation[3],staticGradient,staticGradient))));
 fs.writeFileSync(fixture,chunk('RIFX',Buffer.concat([Buffer.from('Egg!'),duplicate])));
 doc=document(report);doc.source.projectFile=fixture;result=convert(doc);
 assert(result.log.includes('Ambiguous gradient path'));assert(!result.svg.includes('<linearGradient'));
 // LIST is not universally a container: AE text/font data has opaque btdk payloads.
 const textData=list('btds',list('btdk',Buffer.from(' /98 << /0 13 >> /0 << /1 << /CoolTypeFont')));
 const opaque=list('Item',utf('コンポ 1'),list('Layr',utf('シェイプレイヤー 1'),textData,
  named(report.gradients[0].navigation[2],named(report.gradients[0].navigation[3],staticGradient))));
 fs.writeFileSync(fixture,chunk('RIFX',Buffer.concat([Buffer.from('Egg!'),opaque])));
 invoke(['--inspect-gradients',fixture,output,'--time','1.25']);
 assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).gradients.length,1);
 doc=document(report);doc.source.projectFile=fixture;result=convert(doc);
 assert(result.svg.includes('<linearGradient '));assert(!result.log.includes('chunk exceeds parent'));
 const sample003=path.resolve('sample/003/DJ_TurnTable_a.aep');
 const sample003Json=path.resolve('sample/003/01_mg2_02.json');
 if(fs.existsSync(sample003)&&fs.existsSync(sample003Json)){
  doc=JSON.parse(fs.readFileSync(sample003Json,'utf8'));
  // The supplied JSON refers to the exporting PC's account; change only this test copy.
  doc.source.projectFile=sample003;
  result=convert(doc);assert.equal(result.log,'');assert(result.svg.includes('<linearGradient '));
  invoke(['--inspect-gradients',sample003,output,'--time',String(doc.source.evaluation.timeSeconds)]);
  const parsed=JSON.parse(fs.readFileSync(output,'utf8'));
  const gradient=parsed.gradients.find(g=>g.navigation[0]==='01_mg2'&&g.navigation[1]==='02');
  assert(gradient);assert.equal(gradient.colors.length,5);assert.equal(gradient.status,'extracted');
 }
 console.log('Gradient integration passed: 002.aep colors/alpha/midpoint, time, keyed fill/stroke fallback, errors, radial paint'+(process.argv[3]?', raster pixels':''));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});
});
