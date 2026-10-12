// Run: node tests/svg.integration.cjs path/to/export-shapes.exe path/to/sharp
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const exe = path.resolve(process.argv[2] || 'script/export-shapes.exe');
const sharp = require(process.argv[3] || 'sharp');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asts-svg-'));
let number = 0;
const prop = (matchName, value) => ({matchName, value, status: 'evaluated'});
const node = (kind, matchName, children) => ({kind, matchName, children});
const rect = (x=0, y=0, w=100, h=100) => node('rectangle', 'ADBE Vector Shape - Rect', [
  prop('ADBE Vector Rect Size', [w,h]), prop('ADBE Vector Rect Position', [x,y])
]);
const ellipse = () => node('ellipse', 'ADBE Vector Shape - Ellipse', [prop('ADBE Vector Ellipse Size', [100,100])]);
const fill = () => node('fill', 'ADBE Vector Graphic - Fill', [prop('ADBE Vector Fill Color', [1,0,0,1])]);
const stroke = () => node('stroke', 'ADBE Vector Graphic - Stroke', [
  prop('ADBE Vector Stroke Color', [0,0,1,1]), prop('ADBE Vector Stroke Width', 4)
]);
function document(children) {return {format:'ae-shape-contents',schemaVersion:1,scope:'contentsOnly',complete:true,
  source:{layer:{name:'日本語 & <test>'}},contents:node('contents','ADBE Root Vectors Group',children)};}
function run(doc, extra=[], success=true) {
  const base=path.join(dir,`日本語-${number++}`), input=base+'.json', output=base+'.svg';
  fs.writeFileSync(input,JSON.stringify(doc));
  const p=spawnSync(exe,[input,output,...extra],{encoding:'utf8'});
  assert.equal(p.status,success?0:1,p.stderr);
  if(!success){assert.equal(fs.existsSync(output),false);return p;}
  const svg=fs.readFileSync(output,'utf8');
  assert.ok(svg.includes('日本語 &amp; &lt;test&gt;'));
  assert.ok(!/NaN|Infinity/.test(svg));
  return svg;
}
async function raster(svg) {
  // Use a common coordinate system to test pixels independently of automatic bounds.
  svg=svg.replace(/viewBox="[^"]*"/, 'viewBox="-100 -100 300 300"')
    .replace(/width="[^"]*"/, 'width="300"').replace(/height="[^"]*"/, 'height="300"');
  const {data,info}=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return (x,y) => [...data.subarray(((y+100)*info.width+x+100)*4,((y+100)*info.width+x+100)*4+4)];
}
async function main() {
  const red = p => {assert.ok(p[0]>240 && p[1]<10 && p[2]<10 && p[3]>240,JSON.stringify(p));};
  const clear = p => assert.equal(p[3],0,JSON.stringify(p));
  let svg=run(document([rect(),fill()]),['--margin','0']);
  assert.ok(svg.includes('viewBox="-50 -50 100 100"'));
  let pixel=await raster(svg);red(pixel(0,0));clear(pixel(60,0));
  // Closed-path offset must produce square miters and shrink the interior for negatives.
  for(const amount of [10,-10]) {
    svg=run(document([rect(),node('offset','ADBE Vector Filter - Offset',[
      prop('ADBE Vector Offset Amount',amount)
    ]),fill()]));pixel=await raster(svg);
    red(pixel(0,0));if(amount>0)red(pixel(55,55));else clear(pixel(45,0));
  }
  for(const mode of [1,2,3,4,5]) {
    svg=run(document([rect(),rect(50),node('mergePaths','ADBE Vector Filter - Merge',[
      prop('ADBE Vector Merge Type',mode)
    ]),fill()]));pixel=await raster(svg);
    if(mode===3||mode===5)clear(pixel(25,0));else red(pixel(25,0));
    if(mode===4)clear(pixel(-25,0));else red(pixel(-25,0));
    if(mode===3||mode===4)clear(pixel(75,0));else red(pixel(75,0));
  }
  // Trimming is performed on geometry, not merely a stroke-dasharray trick.
  svg=run(document([ellipse(),node('trimPaths','ADBE Vector Filter - Trim',[
    prop('ADBE Vector Trim Start',0),prop('ADBE Vector Trim End',25)
  ]),stroke()]));pixel=await raster(svg);
  assert.ok(pixel(35,-35)[2]>240);clear(pixel(-35,35));
  svg=run(document([ellipse(),node('trimPaths','ADBE Vector Filter - Trim',[
    prop('ADBE Vector Trim Start',0),prop('ADBE Vector Trim End',0)
  ]),stroke()]));assert.equal((svg.match(/<path /g)||[]).length,0);
  const transform=node('', 'ADBE Vector Transform Group', [prop('ADBE Vector Position',[75,25])]);
  svg=run(document([node('group','ADBE Vector Group',[node('contents','ADBE Vectors Group',[rect(),fill()]),transform])]));
  pixel=await raster(svg);red(pixel(75,25));clear(pixel(0,0));
  // Group opacity is applied after compositing its paints, not independently to each paint.
  svg=run(document([node('group','ADBE Vector Group',[
    node('contents','ADBE Vectors Group',[rect(),fill(),fill()]),
    node('', 'ADBE Vector Transform Group',[prop('ADBE Vector Group Opacity',50)])
  ])]));pixel=await raster(svg);assert.ok(Math.abs(pixel(0,0)[3]-128)<=1);
  const line=node('path','ADBE Vector Shape - Group',[prop('ADBE Vector Shape',{
    vertices:[[-50,0],[50,0]],inTangents:[[0,0],[0,0]],outTangents:[[0,0],[0,0]],closed:false
  })]);
  const dashed=stroke();dashed.children.push({...node('','ADBE Vector Stroke Dashes',[
    prop('ADBE Vector Stroke Dash 1',10),prop('ADBE Vector Stroke Gap 1',10)
  ]),visibilityKnown:true});
  svg=run(document([line,dashed]));pixel=await raster(svg);
  assert.ok(pixel(-45,0)[2]>240);clear(pixel(-35,0));
  delete dashed.children[2].visibilityKnown;
  svg=run(document([line,dashed]));pixel=await raster(svg);assert.ok(pixel(-35,0)[2]>240);
  const repeatTransform=node('','ADBE Vector Repeater Transform',[
    prop('ADBE Vector Repeater Position',[100,0]),prop('ADBE Vector Repeater Scale',[-100,100])
  ]);
  svg=run(document([rect(0,0,20,20),node('repeater','ADBE Vector Filter - Repeater',[
    prop('ADBE Vector Repeater Copies',2),prop('ADBE Vector Repeater Offset',-.5),repeatTransform
  ]),fill()]));pixel=await raster(svg);red(pixel(-50,0));red(pixel(50,0));clear(pixel(0,0));
  run({...document([rect(),fill()]),complete:false},[],false);
  run({...document([]),schemaVersion:99},[],false);
  run(document([rect(),fill()]),['--margin','-1'],false);
  run(document([rect(),fill()]),['--margin','NaN'],false);
  // Disabled and unknown Contents must not contribute output.
  svg=run(document([{...rect(),enabled:false},node('unknown','Unknown',[]),fill()]));
  assert.equal((svg.match(/<path /g)||[]).length,0);
  console.log('SVG integration tests passed (raster geometry, operators, Unicode CLI, invalid inputs)');
}
main().then(()=>fs.rmSync(dir,{recursive:true,force:true})).catch(e=>{console.error(e);console.error('Test artifacts:',dir);process.exitCode=1;});
