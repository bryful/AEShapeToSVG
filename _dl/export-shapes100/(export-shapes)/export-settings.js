/* AE user preferences, persisted by app.settings. */
var AEShapeSettings = (function () {
    var section = 'AEShapeToSVG.export-shapes';
    function get(key) {
        return app.settings.haveSetting(section, key) ? app.settings.getSetting(section, key) : '';
    }
    function set(key, value) { app.settings.saveSetting(section, key, String(value)); }
    function outputFolder(comp) {
        var remembered = get('outputFolder');
        if (remembered && new Folder(remembered).exists) { return new Folder(remembered); }
        return app.project.file ? app.project.file.parent : Folder.myDocuments;
    }
    return {get: get, set: set, outputFolder: outputFolder};
}());
