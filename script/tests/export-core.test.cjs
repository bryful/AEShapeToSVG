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
function layer(children) {
    const root = group('ADBE Root Vectors Group', children);
    return {name: 'Shape', index: 1, property(name) {
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
assert.throws(() => AEShapeExport.documentFor(comp, layer(nodes), 0, true), /Animation/);
assert.throws(() => AEShapeExport.documentFor(comp, layer([group('ADBE Vector Filter - Twist', [])]), 0, false), /Unsupported Contents/);
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
])]), 0, true), /Animation/);
const shape = {vertices: [[0, 0], [10, 10]], inTangents: [[0, 0], [-1, -1]], outTangents: [[1, 1], [0, 0]], closed: false};
doc = AEShapeExport.documentFor(comp, layer([group('ADBE Vector Shape - Group', [leaf('ADBE Vector Shape', shape, {propertyValueType: 1})])]), 0, false);
assert.deepEqual(doc.contents.children[0].children[0].value, shape);
assert.throws(() => AEShapeExport.documentFor(comp, layer([group('ADBE Vector Graphic - Fill', [leaf('color', 1, {
    expressionEnabled: true, expressionError: 'bad expression'
})])]), 0, false), /Expression error/);
assert.equal(AEShapeExport.safeName('CON'), '_CON');
assert.equal(AEShapeExport.safeName('a/b: .'), 'a_b_');
assert.equal(JSON.parse(AEShapeExport.stringify({text: '日本語\n"\\\u0000'})).text, '日本語\n"\\\u0000');
assert.throws(() => AEShapeExport.stringify(NaN), /Non-finite/);
console.log('Export core mock tests passed');
