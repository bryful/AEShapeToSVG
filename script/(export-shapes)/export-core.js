/* ExtendScript ES3 compatible. No AE project mutation. */
var AEShapeExport = (function () {
    var kinds = {
        'ADBE Root Vectors Group': 'contents',
        'ADBE Vectors Group': 'contents',
        'ADBE Vector Group': 'group',
        'ADBE Vector Shape - Rect': 'rectangle',
        'ADBE Vector Shape - Ellipse': 'ellipse',
        'ADBE Vector Shape - Star': 'polystar',
        'ADBE Vector Shape - Group': 'path',
        'ADBE Vector Filter - Offset': 'offset',
        'ADBE Vector Filter - Repeater': 'repeater',
        'ADBE Vector Filter - Merge': 'mergePaths',
        'ADBE Vector Filter - Trim': 'trimPaths',
        'ADBE Vector Graphic - Fill': 'fill',
        'ADBE Vector Graphic - Stroke': 'stroke',
        'ADBE Vector Graphic - G-Fill': 'gradientFill',
        'ADBE Vector Graphic - G-Stroke': 'gradientStroke'
    };
    function fail(path, message) { throw new Error(path + ': ' + message); }
    function quote(s) {
        return '"' + String(s).replace(/["\\\x00-\x1f\u2028\u2029]/g, function (c) {
            if (c === '"' || c === '\\') { return '\\' + c; }
            return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
    }
    function stringify(v) {
        var a = [], i, k;
        if (v === null) { return 'null'; }
        if (typeof v === 'string') { return quote(v); }
        if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
        if (typeof v === 'number') {
            if (!isFinite(v)) { throw new Error('Non-finite JSON number'); }
            return String(v);
        }
        if (v instanceof Array) {
            for (i = 0; i < v.length; i++) { a.push(stringify(v[i])); }
            return '[' + a.join(',') + ']';
        }
        if (typeof v !== 'object') { throw new Error('Unsupported JSON value'); }
        for (k in v) {
            if (Object.prototype.hasOwnProperty.call(v, k)) { a.push(quote(k) + ':' + stringify(v[k])); }
        }
        return '{' + a.join(',') + '}';
    }
    function copyValue(v, path) {
        var a = [], i;
        if (v instanceof Array) {
            for (i = 0; i < v.length; i++) { a.push(copyValue(v[i], path)); }
            return a;
        }
        if (typeof v === 'number' && isFinite(v)) { return v; }
        if (typeof v === 'boolean' || typeof v === 'string') { return v; }
        fail(path, 'Unsupported or non-finite property value');
    }
    function read(p, time, strict, warnings, path, contentChild) {
        var n = {name: p.name, matchName: p.matchName, index: p.propertyIndex}, i, child, value, childNode;
        var gradient = p.matchName === 'ADBE Vector Graphic - G-Fill' || p.matchName === 'ADBE Vector Graphic - G-Stroke';
        var stroke = p.matchName === 'ADBE Vector Graphic - G-Stroke';
        path += '/' + p.name + '[' + p.propertyIndex + ']';
        // Skip the entire operator/group before evaluating any descendants.
        if (contentChild && (!kinds[p.matchName] || (p.canSetEnabled && !p.enabled))) { return null; }
        if (kinds[p.matchName]) { n.kind = kinds[p.matchName]; }
        if (p.canSetEnabled) { n.enabled = p.enabled; }
        if (p.propertyType !== PropertyType.PROPERTY) {
            n.children = [];
            if (gradient) {
                n.sourceMatchName = p.matchName;
                n.matchName = stroke ? 'ADBE Vector Graphic - Stroke' : 'ADBE Vector Graphic - Fill';
                n.kind = stroke ? 'stroke' : 'fill';
                n.replacement = 'gradientToSolid';
            }
            for (i = 1; i <= p.numProperties; i++) {
                child = p.property(i);
                if (gradient && child.matchName.indexOf('ADBE Vector Grad ') === 0) {
                    // Strict mode still checks animation on discarded gradient settings.
                    if (strict && (child.numKeys > 0 || child.expressionEnabled)) {
                        fail(path + '/' + child.name, 'Animation is forbidden in strict mode');
                    }
                    continue;
                }
                childNode = read(child, time, strict, warnings, path,
                    p.matchName === 'ADBE Root Vectors Group' || p.matchName === 'ADBE Vectors Group');
                if (childNode !== null) { n.children.push(childNode); }
            }
            if (gradient) {
                n.children.push({name: 'Color', matchName: stroke ? 'ADBE Vector Stroke Color' : 'ADBE Vector Fill Color',
                    index: p.numProperties + 1, value: stroke ? [0, 0, 1, 1] : [1, 0, 0, 1],
                    status: 'replacement', keyframeCount: 0, expressionEnabled: false});
            }
            return n;
        }
        n.keyframeCount = p.numKeys;
        n.expressionEnabled = !!p.expressionEnabled;
        if (strict && (n.keyframeCount > 0 || n.expressionEnabled)) { fail(path, 'Animation is forbidden in strict mode'); }
        // Gradient Colors is a CUSTOM_VALUE on AE versions that cannot expose stops.
        if (p.matchName === 'ADBE Vector Grad Colors') {
            n.value = null;
            n.status = 'unavailable';
            n.reason = 'Gradient color/opacity stops are not exposed as a portable scripting value';
            warnings.push({code: 'GRADIENT_STOPS_UNAVAILABLE', path: path, message: n.reason});
            return n;
        }
        if (p.propertyValueType === PropertyValueType.NO_VALUE) {
            n.value = null;
            n.status = 'noValue';
            return n;
        }
        try { value = p.valueAtTime(time, false); }
        catch (e) { fail(path, 'Cannot evaluate property: ' + e.toString()); }
        if (n.expressionEnabled && p.expressionError) { fail(path, 'Expression error: ' + p.expressionError); }
        if (p.propertyValueType === PropertyValueType.SHAPE) {
            n.value = {vertices: copyValue(value.vertices, path),
                inTangents: copyValue(value.inTangents, path),
                outTangents: copyValue(value.outTangents, path), closed: !!value.closed};
        } else { n.value = copyValue(value, path); }
        n.status = 'evaluated';
        return n;
    }
    function documentFor(comp, layer, time, strict) {
        var warnings = [], contents = layer.property('ADBE Root Vectors Group');
        if (!contents) { throw new Error('Not a Shape layer: ' + layer.name); }
        var tree = read(contents, time, strict, warnings, layer.name, false);
        return {format: 'ae-shape-contents', schemaVersion: 1,
            scope: 'contentsOnly', complete: warnings.length === 0,
            source: {application: 'After Effects', version: app.version,
                composition: {name: comp.name, width: comp.width, height: comp.height,
                    pixelAspect: comp.pixelAspect, frameRate: comp.frameRate, displayStartTime: comp.displayStartTime},
                layer: {name: layer.name, index: layer.index},
                evaluation: {timeSeconds: time, animationPolicy: strict ? 'reject' : 'currentTime', postExpression: true}},
            contents: tree, warnings: warnings};
    }
    function safeName(name) {
        var result = String(name).replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '');
        if (!result) { result = 'shape'; }
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(result)) { result = '_' + result; }
        return result.slice(0, 100);
    }
    return {documentFor: documentFor, stringify: stringify, safeName: safeName};
}());
