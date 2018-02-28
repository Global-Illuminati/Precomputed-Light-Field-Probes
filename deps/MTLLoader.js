//TODO: handle materials returned from the parse function

function MTLLoader() {
    //Empty constructor so far...
}

MTLLoader.prototype = {
    constructor: MTLLoader(),

    //TODO: break loader into separate file and send callbacks to load function as params
    load: function(url, onload) {
        var xhr = new XMLHttpRequest();
        //Send date as request parameter to avoid caching issues
        xhr.open('GET', url + "?t=" + new Date().getTime(), true);
        var scope = this;
        xhr.onload = function() {
            onload(scope.parse(this.response));
        }
        xhr.send();
    },

    parse: function(mtl) {
        console.time('MTLLoader');
        var material;
        var materials = [];
        var lines = mtl.split('\n');

        for(var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();

            var nextVal = line.indexOf(' ');

            //If line is empty, has no spaces (hence no values) or is a comment, then skip it
            if(line.length === 0 || nextVal < 0 || line[0] == '#')
                continue;

            var key = line.substr(0,nextVal);
            var value = line.substr(nextVal + 1, line.length);

            if(key === 'newmtl') {
                //if start of new material, push the last material
                if(material)
                    materials[material.name] = material;
                material = {
                    name: value,
                    properties: {}
                }
            } else if(key === 'Ka' || key === 'Kd' || key === 'Ks' || key === 'Ke' || key === 'Tf') {
                var xyz = value.split(' ');
                material.properties[key] = xyz;
            } else if(key === 'Ns' || key === 'Ni' || key === 'd' || key === 'illum' || key === 'map_Kd' || key === 'map_Ks' || key == 'map_norm' || key === 'Tr') {
                material.properties[key] = value;
            } else {
                //Just a precaution, if things are working as they should, remove this
                throw "Key not recognized::" + key;
            }
        }
        //push the last material
        if(material && material.name && material.properties)
            materials[material.name] = material;
        console.timeEnd('MTLLoader');
        return materials;
    },

}