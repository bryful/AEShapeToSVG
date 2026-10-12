const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
// Use the current realm so mocked AE array values retain ES3 instanceof semantics.
vm.runInThisContext(fs.readFileSync(require('node:path').join(__dirname, '../(export-shapes)/export-core.js'), 'utf8'));
global.PropertyType = {PROPERTY: 1, INDEXED_GROUP: 2};
global.PropertyValueType = {NO_VALUE: 0, SHAPE: 1};
global.app = {version: 'mock'};
let reads = [];
function leaf(matchName, value, extra = {}) {
    return Object.assign({name: matchName, matchName, propertyIndex: 1, propertyType: 1,
        propertyValueType: 2, numKeys: 0, expressionEnabled: false,
        valueAtTime(t, pre) { reads.push([t, pre]); return value; }}, extra);
}
function group(matchName, children) {
    children.forEach((p, i) => p.propertyIndex = i + 1);
    return {name: matchName, matchName, propertyIndex: 1, propertyType: 2,
        numProperties: children.length, property(i) { return children[i - 1]; }};
}
const comp = {name: '日本語', width: 1920, height: 1080, pixelAspect: 1, frameRate: 24, displayStartTime: 0};
function layer(children, transform = null) {
    const root = group('ADBE Root Vectors Group', children);
    return {name: 'Shape', index: 1, property(name) {
        if (name === 'ADBE Transform Group') return transform;
        assert.equal(name, 'ADBE Root Vectors Group'); return root;
    }};
}
const operators = ['ADBE Vector Shape - Rect', 'ADBE Vector Shape - Ellipse',
    'ADBE Vector Shape - Star', 'ADBE Vector Shape - Group', 'ADBE Vector Filter - Offset',
    'ADBE Vector Filter - Repeater', 'ADBE Vector Graphic - Fill', 'ADBE Vector Graphic - Stroke',
    'ADBE Vector Graphic - G-Fill', 'ADBE Vector Graphic - G-Stroke'];
const nodes = operators.map(name => group(name, [leaf('test-value', [1, 2], {numKeys: 2, expressionEnabled: true})]));
let doc = AEShapeExport.documentFor(comp, layer(nodes), 1.25, false);
assert.equal(doc.contents.children.length, 10);
assert.equal(doc.complete, true);
assert.ok(reads.every(([t, pre]) => t === 1.25 && pre === false));
assert.deepEqual(JSON.parse(AEShapeExport.stringify(doc)), doc);
assert.throws(() => AEShapeExport.documentFor(comp, layer(nodes), 0, true), /アニメーション/);
const skippedValue = leaf('never-read', null, {
    numKeys: 3, expressionEnabled: true,
    valueAtTime() { throw Error('Skipped Contents must not be evaluated'); }
});
const hidden = Object.assign(group('ADBE Vector Group', [skippedValue]), {canSetEnabled: true, enabled: false});
const hiddenGradient = Object.assign(group('ADBE Vector Graphic - G-Fill', [skippedValue]), {canSetEnabled: true, enabled: false});
const unsupported = group('ADBE Vector Filter - Twist', [skippedValue]);
doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Group', [group('ADBE Vectors Group', [
    hidden, unsupported, group('ADBE Vector Shape - Rect', []), hiddenGradient,
    group('ADBE Vector Graphic - G-Fill', []), group('ADBE Vector Graphic - G-Stroke', [])
])])]), 0, true);
const kept = doc.contents.children[0].children[0].children;
assert.deepEqual(kept.map(n => n.kind), ['rectangle', 'fill', 'stroke']);
assert.deepEqual(kept.map(n => n.index), [3, 5, 6]);
assert.deepEqual(kept[1].children[0].value, [1, 0, 0, 1]);
assert.deepEqual(kept[2].children[0].value, [0, 0, 1, 1]);
assert.equal(doc.complete, true);
assert.equal(doc.warnings.length, 0);
assert.deepEqual(JSON.parse(AEShapeExport.stringify(doc)), doc);
doc = AEShapeExport.documentFor(comp, layer([hidden, unsupported]), 0, true);
assert.deepEqual(doc.contents.children, []);
doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Graphic - Stroke', [
    group('ADBE Vector Stroke Dashes', [
        leaf('ADBE Vector Stroke Dash 1', 10, {canSetExpression: true}),
        leaf('ADBE Vector Stroke Gap 1', 10, {canSetExpression: false})
    ])
])]), 0, false);
assert.equal(doc.contents.children[0].children[0].visibilityKnown, true);
assert.equal(doc.contents.children[0].children[0].children.length, 1);
// Preserve all merge modes, nesting and operator order without flattening geometry.
for (const mode of [1, 2, 3, 4, 5]) {
    doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Group', [
        group('ADBE Vectors Group', [
            group('ADBE Vector Shape - Rect', []),
            group('ADBE Vector Shape - Ellipse', []),
            group('ADBE Vector Filter - Merge', [leaf('ADBE Vector Merge Type', mode)]),
            group('ADBE Vector Graphic - Fill', [])
        ])
    ])]), 1.25, false);
    const contents = doc.contents.children[0].children[0].children;
    assert.deepEqual(contents.map(n => n.kind), ['rectangle', 'ellipse', 'mergePaths', 'fill']);
    assert.equal(contents[2].children[0].matchName, 'ADBE Vector Merge Type');
    assert.equal(contents[2].children[0].value, mode);
    assert.equal(doc.complete, true);
    assert.deepEqual(JSON.parse(AEShapeExport.stringify(doc)), doc);
}
doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Graphic - G-Fill', [leaf('ADBE Vector Grad Colors', null, {
    valueAtTime() { throw Error('Must not read CUSTOM_VALUE'); }
})])]), 0, false);
assert.equal(doc.complete, true);
assert.equal(doc.warnings.length, 0);
assert.equal(doc.contents.children[0].kind, 'fill');
assert.equal(doc.contents.children[0].matchName, 'ADBE Vector Graphic - Fill');
assert.deepEqual(doc.contents.children[0].children[0].value, [1, 0, 0, 1]);
doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Graphic - G-Stroke', [
    leaf('ADBE Vector Grad Start Pt', [0, 0]), leaf('ADBE Vector Grad Colors', null),
    leaf('ADBE Vector Stroke Width', 8), leaf('ADBE Vector Stroke Opacity', 35),
    group('ADBE Vector Stroke Dashes', [leaf('ADBE Vector Stroke Dash 1', 4)])
])]), 2, false);
const solid = doc.contents.children[0];
assert.equal(solid.kind, 'stroke');
assert.equal(solid.matchName, 'ADBE Vector Graphic - Stroke');
assert.deepEqual(solid.children.map(p => p.value).slice(0, 2), [8, 35]);
assert.equal(solid.children[2].children[0].value, 4);
assert.deepEqual(solid.children[3].value, [0, 0, 1, 1]);
assert.ok(solid.children.every(p => !p.matchName.startsWith('ADBE Vector Grad ')));
assert.equal(doc.complete, true);
assert.deepEqual(JSON.parse(AEShapeExport.stringify(doc)), doc);
assert.throws(() => AEShapeExport.documentFor(comp, layer([group('ADBE Vector Graphic - G-Fill', [
    leaf('ADBE Vector Grad Colors', null, {numKeys: 1})
])]), 0, true), /アニメーション/);
const shape = {vertices: [[0, 0], [10, 10]], inTangents: [[0, 0], [-1, -1]], outTangents: [[1, 1], [0, 0]], closed: false};
for (const mode of [1, 2]) {
    const trim = group('ADBE Vector Filter - Trim', [
        leaf('ADBE Vector Trim Start', 15),
        leaf('ADBE Vector Trim End', 80, {
            numKeys: 2, expressionEnabled: true,
            valueAtTime(t, pre) { assert.equal(t, 1.25); assert.equal(pre, false); return 80; }
        }),
        leaf('ADBE Vector Trim Offset', -90),
        leaf('ADBE Vector Trim Type', mode)
    ]);
    const nested = layer([group('ADBE Vector Group', [group('ADBE Vectors Group', [
        group('ADBE Vector Shape - Rect', []), trim, group('ADBE Vector Graphic - Stroke', [])
    ])])]);
    doc = AEShapeExport.documentFor(comp, nested, 1.25, false);
    const children = doc.contents.children[0].children[0].children;
    assert.deepEqual(children.map(n => n.kind), ['rectangle', 'trimPaths', 'stroke']);
    assert.deepEqual(children[1].children.map(n => n.value), [15, 80, -90, mode]);
    assert.equal(doc.complete, true);
    assert.deepEqual(JSON.parse(AEShapeExport.stringify(doc)), doc);
    assert.throws(() => AEShapeExport.documentFor(comp, nested, 1.25, true), /アニメーション/);
}
doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Shape - Group', [leaf('ADBE Vector Shape', shape, {propertyValueType: 1})])]), 0, false);
assert.deepEqual(doc.contents.children[0].children[0].value, shape);
assert.throws(() => AEShapeExport.documentFor(comp, layer([group('ADBE Vector Graphic - Fill', [leaf('color', 1, {
    expressionEnabled: true, expressionError: 'bad expression'
})])]), 0, false), /エクスプレッションエラー/);
assert.equal(AEShapeExport.safeName('CON'), '_CON');
assert.equal(AEShapeExport.safeName('a/b: .'), 'a_b_');
assert.equal(JSON.parse(AEShapeExport.stringify({text: '日本語\n"\\\u0000'})).text, '日本語\n"\\\u0000');
assert.throws(() => AEShapeExport.stringify(NaN), /保存できない数値/);
// Round Corners preserves operator order, evaluated radius and animation policy.
const round = group('ADBE Vector Filter - RC', [leaf('ADBE Vector RoundCorner Radius', 25, {
    numKeys: 2, expressionEnabled: true,
    valueAtTime(t, pre) { assert.equal(t, 1.25); assert.equal(pre, false); return 25; }
})]);
const roundedLayer = layer([group('ADBE Vector Group', [group('ADBE Vectors Group', [
    group('ADBE Vector Shape - Rect', []), round, group('ADBE Vector Graphic - Fill', [])
])])]);
doc = AEShapeExport.documentFor(comp, roundedLayer, 1.25, false);
const roundedChildren = doc.contents.children[0].children[0].children;
assert.deepEqual(roundedChildren.map(n => n.kind), ['rectangle', 'roundCorners', 'fill']);
assert.equal(roundedChildren[1].children[0].matchName, 'ADBE Vector RoundCorner Radius');
assert.equal(roundedChildren[1].children[0].value, 25);
assert.equal(doc.complete, true);
assert.deepEqual(JSON.parse(AEShapeExport.stringify(doc)), doc);
assert.throws(() => AEShapeExport.documentFor(comp, roundedLayer, 1.25, true), /アニメーション/);
round.canSetEnabled = true;
round.enabled = false;
doc = AEShapeExport.documentFor(comp, roundedLayer, 0, true);
assert.deepEqual(doc.contents.children[0].children[0].children.map(n => n.kind), ['rectangle', 'fill']);
for (const radius of [0, 12.5, 1000]) {
    doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Filter - RC', [
        leaf('ADBE Vector RoundCorner Radius', radius)
    ])]), 0, false);
    assert.equal(doc.contents.children[0].children[0].value, radius);
}
const animatedAnchor = leaf('ADBE Anchor Point', [12, 34, 0], {numKeys:2});
const animatedPosition = leaf('ADBE Position', [300, 200, 0], {expressionEnabled:true});
const layerTransform = {property(name) {return name==='ADBE Anchor Point'?animatedAnchor:animatedPosition;}};
doc = AEShapeExport.documentFor(comp,layer([],layerTransform),1.25,false);
assert.deepEqual(doc.source.layer.anchorPoint,[12,34,0]);
assert.deepEqual(doc.source.layer.position,[300,200,0]);
assert.throws(()=>AEShapeExport.documentFor(comp,layer([],layerTransform),1.25,true),/アニメーション/);
const separatedPosition = {...animatedPosition,isSeparationLeader:true,dimensionsSeparated:true,
    getSeparationFollower(i) {return leaf('ADBE Position_'+i,i===0?300:200);},
    valueAtTime(){throw Error('Do not read separated leader');}};
doc = AEShapeExport.documentFor(comp,layer([],{property(name){return name==='ADBE Position'?separatedPosition:null;}}),0,false);
assert.deepEqual(doc.source.layer.position,[300,200]);
console.log('Export core mock tests passed');
