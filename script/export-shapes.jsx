#target aftereffects
#include "(export-shapes)/export-core.js"

(function () {
    try {
        var comp = app.project ? app.project.activeItem : null;
        if (!(comp instanceof CompItem)) { throw new Error('Open a composition first.'); }
        var selected = comp.selectedLayers, layers = [], ignored = 0, i;
        for (i = 0; i < selected.length; i++) {
            if (selected[i].matchName === 'ADBE Vector Layer') { layers.push(selected[i]); }
            else { ignored++; }
        }
        if (!layers.length) { throw new Error('Select at least one Shape layer.'); }
        var dialog = new Window('dialog', 'Export Shape Contents JSON');
        dialog.orientation = 'column';
        dialog.alignChildren = 'left';
        dialog.add('statictext', undefined, 'Shape layers: ' + layers.length + ' / ignored: ' + ignored);
        dialog.add('statictext', undefined, 'Snapshot at current time: ' + comp.time + ' seconds');
        var strict = dialog.add('checkbox', undefined, 'Reject animation in Contents (optional)');
        strict.value = false;
        var buttons = dialog.add('group');
        buttons.add('button', undefined, 'Export JSON', {name: 'ok'});
        buttons.add('button', undefined, 'Cancel', {name: 'cancel'});
        if (dialog.show() !== 1) { return; }
        var time = comp.time, folder = Folder.selectDialog('Select JSON output folder');
        if (!folder) { return; }
        // Evaluate and serialize every layer before writing any files.
        var jobs = [], warnings = 0, doc, file, base, suffix, used = {}, exists = false;
        for (i = 0; i < layers.length; i++) {
            doc = AEShapeExport.documentFor(comp, layers[i], time, strict.value);
            warnings += doc.warnings.length;
            base = AEShapeExport.safeName(layers[i].name);
            suffix = base;
            var serial = 2;
            while (used['$' + suffix.toLowerCase()]) { suffix = base + '_' + serial++; }
            used['$' + suffix.toLowerCase()] = true;
            file = new File(folder.fsName + '/' + suffix + '.json');
            exists = exists || file.exists;
            jobs.push({file: file, text: AEShapeExport.stringify(doc)});
        }
        if (warnings && !confirm('Some values could not be exported.\nJSON will be marked complete=false.\nContinue with incomplete JSON?')) { return; }
        if (exists && !confirm('Output files already exist. Overwrite them?')) { return; }
        var written = 0;
        for (i = 0; i < jobs.length; i++) {
            file = jobs[i].file;
            file.encoding = 'UTF-8';
            if (!file.open('w')) { throw new Error('Cannot open: ' + file.fsName + '\nAlready saved: ' + written); }
            var ok = false, closed = false;
            try { ok = file.write(jobs[i].text + '\n'); }
            finally { closed = file.close(); }
            if (!ok || !closed) { throw new Error('Write failed: ' + file.fsName + '\nAlready saved: ' + written); }
            written++;
        }
        alert('Saved JSON files: ' + written + '\nWarnings: ' + warnings + '\n' + folder.fsName);
    } catch (e) { alert('Shape export failed\n' + e.toString()); }
}());
