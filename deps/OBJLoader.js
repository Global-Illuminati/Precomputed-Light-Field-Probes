
/**
 * @author mrdoob / http://mrdoob.com/
 */

'using strict';


OBJLoader = function(manager) {

    // this.manager = (manager !== undefined) ? manager : THREE.DefaultLoadingManager;

    this.materials = null;

    this.regexp = {
        // v float float float
        vertex_pattern: /^v\s+([\d|\.|\+|\-|e|E]+)\s+([\d|\.|\+|\-|e|E]+)\s+([\d|\.|\+|\-|e|E]+)/,
        // vn float float float
        normal_pattern: /^vn\s+([\d|\.|\+|\-|e|E]+)\s+([\d|\.|\+|\-|e|E]+)\s+([\d|\.|\+|\-|e|E]+)/,
        // vt float float
        uv_pattern: /^vt\s+([\d|\.|\+|\-|e|E]+)\s+([\d|\.|\+|\-|e|E]+)/,
        // vt float float
        uv2_pattern: /^vt2\s+([\d|\.|\+|\-|e|E]+)\s+([\d|\.|\+|\-|e|E]+)/,
        // f vertex vertex vertex
        face_vertex: /^f\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s+(-?\d+))?/,
        // f vertex/uv vertex/uv vertex/uv
        face_vertex_uv: /^f\s+(-?\d+)\/(-?\d+)\s+(-?\d+)\/(-?\d+)\s+(-?\d+)\/(-?\d+)(?:\s+(-?\d+)\/(-?\d+))?/,
        // f vertex/uv/normal vertex/uv/normal vertex/uv/normal
        face_vertex_uv_normal: /^f\s+(-?\d+)\/(-?\d+)\/(-?\d+)\s+(-?\d+)\/(-?\d+)\/(-?\d+)\s+(-?\d+)\/(-?\d+)\/(-?\d+)(?:\s+(-?\d+)\/(-?\d+)\/(-?\d+))?/,
        // f vertex//normal vertex//normal vertex//normal
        face_vertex_normal: /^f\s+(-?\d+)\/\/(-?\d+)\s+(-?\d+)\/\/(-?\d+)\s+(-?\d+)\/\/(-?\d+)(?:\s+(-?\d+)\/\/(-?\d+))?/,
        // Who the fuck uses regexs to parse stuff -.-  like fucking look at this...
        // f vertex/uv//uv2 vertex/uv//uv2 vertex/uv//uv2  
        face_vertex_uv_uv2: /^f\s+(-?\d+)\/(-?\d+)\/\/(-?\d+)\s+(-?\d+)\/(-?\d+)\/\/(-?\d+)\s+(-?\d+)\/(-?\d+)\/\/(-?\d+)(?:\s+(-?\d+)\/(-?\d+)\/\/(-?\d+))?/,
        // o object_name | g group_name
        object_pattern: /^[og]\s*(.+)?/,
        // s boolean
        smoothing_pattern: /^s\s+(\d+|on|off)/,
        // mtllib file_reference
        material_library_pattern: /^mtllib /,
        // usemtl material_name
        material_use_pattern: /^usemtl /
    };

};




OBJLoader.prototype = {

    constructor: OBJLoader,
    /*
    load: function(url, onLoad, onProgress, onError) {

        var scope = this;

        var loader = new THREE.XHRLoader(scope.manager);
        loader.setPath(this.path);
        loader.load(url, function(text) {

            onLoad(scope.parse(text));

        }, onProgress, onError);

    },
    */

    load: function(url, onload) {
        var xhr = new XMLHttpRequest();
        scope = this;
        xhr.onload =  function(){
            onload(scope.parse(this.response));
        };
        xhr.open('GET', url, true);
        xhr.send();
    },



    setPath: function(value) {

        this.path = value;

    }, 

    setMaterials: function(materials) {

        this.materials = materials;

    },

    _createParserState: function() {

        var state = {
            objects: [],
            object: {},

            vertices: [],
            num_processed_verties: 0,
            normals: [],
            uvs: [],
            uv2s: [],

            materialLibraries: [],

            startObject: function(name, fromDeclaration) {

                // If the current object (initial from reset) is not from a g/o declaration in the parsed
                // file. We need to use it for the first parsed g/o to keep things in sync.
                if (this.object && this.object.fromDeclaration === false) {

                    this.object.name = name;
                    this.object.fromDeclaration = (fromDeclaration !== false);
                    return;

                }

                if (this.object && typeof this.object._finalize === 'function') {

                    this.object._finalize();

                }

                var previousMaterial = (this.object && typeof this.object.currentMaterial === 'function' ? this.object.currentMaterial() : undefined);

                this.object = {
                    name: name || '',
                    fromDeclaration: (fromDeclaration !== false),

                    geometry: {
                        vertices: [],
                        normals: [],
                        uvs: [],
                        uv2s: [],
                        vertex_indices: [],
                        uv_indices: [],
                    },
                    materials: [],
                    smooth: true,

                    startMaterial: function(name, libraries) {

                        var previous = this._finalize(false);

                        // New usemtl declaration overwrites an inherited material, except if faces were declared
                        // after the material, then it must be preserved for proper MultiMaterial continuation.
                        if (previous && (previous.inherited || previous.groupCount <= 0)) {

                            this.materials.splice(previous.index, 1);

                        }

                        var material = {
                            index: this.materials.length,
                            name: name || '',
                            mtllib: (Array.isArray(libraries) && libraries.length > 0 ? libraries[libraries.length - 1] : ''),
                            smooth: (previous !== undefined ? previous.smooth : this.smooth),
                            groupStart: (previous !== undefined ? previous.groupEnd : 0),
                            groupEnd: -1,
                            groupCount: -1,
                            inherited: false,

                            clone: function(index) {
                                return {
                                    index: (typeof index === 'number' ? index : this.index),
                                    name: this.name,
                                    mtllib: this.mtllib,
                                    smooth: this.smooth,
                                    groupStart: this.groupEnd,
                                    groupEnd: -1,
                                    groupCount: -1,
                                    inherited: false
                                };
                            }
                        };

                        this.materials.push(material);

                        return material;

                    },

                    currentMaterial: function() {

                        if (this.materials.length > 0) {
                            return this.materials[this.materials.length - 1];
                        }

                        return undefined;

                    },

                    _finalize: function(end) {

                        var lastMultiMaterial = this.currentMaterial();
                        if (lastMultiMaterial && lastMultiMaterial.groupEnd === -1) {

                            lastMultiMaterial.groupEnd = state.num_processed_verties / 3;
                            lastMultiMaterial.groupCount = lastMultiMaterial.groupEnd - lastMultiMaterial.groupStart;
                            lastMultiMaterial.inherited = false;

                        }

                        // Guarantee at least one empty material, this makes the creation later more straight forward.
                        if (end !== false && this.materials.length === 0) {
                            this.materials.push({
                                name: '',
                                smooth: this.smooth
                            });
                        }

                        return lastMultiMaterial;

                    }
                };

                // Inherit previous objects material.
                // Spec tells us that a declared material must be set to all objects until a new material is declared.
                // If a usemtl declaration is encountered while this new object is being parsed, it will
                // overwrite the inherited material. Exception being that there was already face declarations
                // to the inherited material, then it will be preserved for proper MultiMaterial continuation.

                if (previousMaterial && previousMaterial.name && typeof previousMaterial.clone === "function") {

                    var declared = previousMaterial.clone(0);
                    declared.inherited = true;
                    this.object.materials.push(declared);

                }

                this.objects.push(this.object);

            },

            finalize: function() {

                if (this.object && typeof this.object._finalize === 'function') {

                    this.object._finalize();

                }

            },

            parseVertexIndex: function(value, len) {

                var index = parseInt(value, 10);
                return (index >= 0 ? index - 1 : index + len / 3) * 3;

            },

            parseNormalIndex: function(value, len) {

                var index = parseInt(value, 10);
                return (index >= 0 ? index - 1 : index + len / 3) * 3;

            },

            parseUVIndex: function(value, len) {

                var index = parseInt(value, 10);
                return (index >= 0 ? index - 1 : index + len / 2) * 2;

            },

            parseUV2Index: function(value, len) {
                var index = parseInt(value, 10);
                return (index >= 0 ? index - 1 : index + len / 2) * 2;
            },

            addVertex: function(a, b, c) {

                var src = this.vertices;
                var dst = this.object.geometry.vertices;
                this.num_processed_verties += 3;
/*                
                dst.push(src[a + 0]);
                dst.push(src[a + 1]);
                dst.push(src[a + 2]);
                dst.push(src[b + 0]);
                dst.push(src[b + 1]);
                dst.push(src[b + 2]);
                dst.push(src[c + 0]);
                dst.push(src[c + 1]);
                dst.push(src[c + 2]);
  */              

                this.object.geometry.vertex_indices.push(a);
                this.object.geometry.vertex_indices.push(b);
                this.object.geometry.vertex_indices.push(c);
            },

            addVertexLine: function(a) {

                var src = this.vertices;
                var dst = this.object.geometry.vertices;

                dst.push(src[a + 0]);
                dst.push(src[a + 1]);
                dst.push(src[a + 2]);

            },

            addNormal: function(a, b, c) {

                var src = this.normals;
                var dst = this.object.geometry.normals;

                dst.push(src[a + 0]);
                dst.push(src[a + 1]);
                dst.push(src[a + 2]);
                dst.push(src[b + 0]);
                dst.push(src[b + 1]);
                dst.push(src[b + 2]);
                dst.push(src[c + 0]);
                dst.push(src[c + 1]);
                dst.push(src[c + 2]);

            },

            addUV: function(a, b, c) {
                var src = this.uvs;
                var dst = this.object.geometry.uvs;

                /*
                dst.push(src[a + 0]);
                dst.push(src[a + 1]);
                dst.push(src[b + 0]);
                dst.push(src[b + 1]);
                dst.push(src[c + 0]);
                dst.push(src[c + 1]);
                */

                this.object.geometry.uv_indices.push(a);
                this.object.geometry.uv_indices.push(b);
                this.object.geometry.uv_indices.push(c);

            },

            addUV2: function(a, b, c) {
                var src = this.uv2s;
                var dst = this.object.geometry.uv2s;

                dst.push(src[a + 0]/1024.0);
                dst.push(src[a + 1]/1024.0);
                dst.push(src[b + 0]/1024.0);
                dst.push(src[b + 1]/1024.0);
                dst.push(src[c + 0]/1024.0);
                dst.push(src[c + 1]/1024.0);
            },

            addUVLine: function(a) {

                var src = this.uvs;
                var dst = this.object.geometry.uvs;

                dst.push(src[a + 0]);
                dst.push(-src[a + 1]);

            },

            addFace: function(a, b, c, d, ua, ub, uc, ud, na, nb, nc, nd) {

                var vLen = this.vertices.length;

                var ia = this.parseVertexIndex(a, vLen);
                var ib = this.parseVertexIndex(b, vLen);
                var ic = this.parseVertexIndex(c, vLen);
                var id;

                if (d === undefined) {

                    this.addVertex(ia, ib, ic);

                } else {

                    id = this.parseVertexIndex(d, vLen);

                    this.addVertex(ia, ib, id);
                    this.addVertex(ib, ic, id);

                }

                if (ua !== undefined) {

                    var uvLen = this.uvs.length;

                    ia = this.parseUVIndex(ua, uvLen);
                    ib = this.parseUVIndex(ub, uvLen);
                    ic = this.parseUVIndex(uc, uvLen);

                    if (d === undefined) {

                        this.addUV(ia, ib, ic);

                    } else {

                        id = this.parseUVIndex(ud, uvLen);

                        this.addUV(ia, ib, id);
                        this.addUV(ib, ic, id);

                    }

                }

                if (na !== undefined) {

                    // Normals are many times the same. If so, skip function call and parseInt.
                    var nLen = this.normals.length;
                    ia = this.parseNormalIndex(na, nLen);

                    ib = na === nb ? ia : this.parseNormalIndex(nb, nLen);
                    ic = na === nc ? ia : this.parseNormalIndex(nc, nLen);

                    if (d === undefined) {

                        this.addNormal(ia, ib, ic);

                    } else {

                        id = this.parseNormalIndex(nd, nLen);

                        this.addNormal(ia, ib, id);
                        this.addNormal(ib, ic, id);

                    }

                }
            },

            addFace2(a, b, c, d, ua, ub, uc, ud, u2a,u2b,u2c,u2d)
            {
                this.addFace(a,b,c,d,ua,ub,uc,ud);
                var uv2Len = this.uv2s.length;

                ia = this.parseUV2Index(u2a, uv2Len);
                ib = this.parseUV2Index(u2b, uv2Len);
                ic = this.parseUV2Index(u2c, uv2Len);

                if (u2d === undefined) {
                    this.addUV2(ia, ib, ic);
                } else {
                    id = this.parseUV2Index(ud, uv2Len);
                    this.addUV2(ia, ib, id);
                    this.addUV2(ib, ic, id);
                }
            },

            addLineGeometry: function(vertices, uvs) {

                this.object.geometry.type = 'Line';

                var vLen = this.vertices.length;
                var uvLen = this.uvs.length;

                for (var vi = 0, l = vertices.length; vi < l; vi++) {

                    this.addVertexLine(this.parseVertexIndex(vertices[vi], vLen));

                }

                for (var uvi = 0, l = uvs.length; uvi < l; uvi++) {

                    this.addUVLine(this.parseUVIndex(uvs[uvi], uvLen));

                }

            }

        };

        state.startObject('', false);

        return state;

    },

    parse: function(text) {

        console.time('OBJLoader');

        var state = this._createParserState();

        if (text.indexOf('\r\n') !== -1) {

            // This is faster than String.split with regex that splits on both
            text = text.replace('\r\n', '\n');

        }

        var lines = text.split('\n');
        var line = '',
            lineFirstChar = '',
            lineSecondChar = '';
        var lineLength = 0;
        var result = [];

        // Faster to just trim left side of the line. Use if available.
        var trimLeft = (typeof ''.trimLeft === 'function');

        for (var i = 0, l = lines.length; i < l; i++) {

            line = lines[i];

            line = trimLeft ? line.trimLeft() : line.trim();

            lineLength = line.length;

            if (lineLength === 0) continue;

            lineFirstChar = line.charAt(0);

            // @todo invoke passed in handler if any
            if (lineFirstChar === '#') continue;

            if (lineFirstChar === 'v') {

                lineSecondChar = line.charAt(1);

                if (lineSecondChar === ' ' && (result = this.regexp.vertex_pattern.exec(line)) !== null) {

                    // 0                  1      2      3
                    // ["v 1.0 2.0 3.0", "1.0", "2.0", "3.0"]

                    state.vertices.push(
                    parseFloat(result[1]),
                    parseFloat(result[2]),
                    parseFloat(result[3]));

                } else if (lineSecondChar === 'n' && (result = this.regexp.normal_pattern.exec(line)) !== null) {

                    // 0                   1      2      3
                    // ["vn 1.0 2.0 3.0", "1.0", "2.0", "3.0"]

                    state.normals.push(
                    parseFloat(result[1]),
                    parseFloat(result[2]),
                    parseFloat(result[3]));

                } else if (lineSecondChar === 't' && (result = this.regexp.uv_pattern.exec(line)) !== null) {

                    // 0               1      2
                    // ["vt 0.1 0.2", "0.1", "0.2"]

                    state.uvs.push(
                    parseFloat(result[1]),
                    parseFloat(-result[2]));

                } 
                else if (lineSecondChar === 't' && (result = this.regexp.uv2_pattern.exec(line)) !== null) {

                    // 0               1      2
                    // ["vt2 0.1 0.2", "0.1", "0.2"]
                    // @CLEANUP invert uv.y isn't nice!
                    // @CLEANUP invert uv.y isn't nice!
                    // @CLEANUP invert uv.y isn't nice!
                    state.uv2s.push(
                    parseFloat(result[1]),
                    parseFloat(result[2]));
                } 
                else {

                    throw new Error("Unexpected vertex/normal/uv line: '" + line + "'");

                }

            } else if (lineFirstChar === "f") {

                if ((result = this.regexp.face_vertex_uv_normal.exec(line)) !== null) {

                    // f vertex/uv/normal vertex/uv/normal vertex/uv/normal
                    // 0                        1    2    3    4    5    6    7    8    9   10         11         12
                    // ["f 1/1/1 2/2/2 3/3/3", "1", "1", "1", "2", "2", "2", "3", "3", "3", undefined, undefined, undefined]

                    state.addFace(
                    result[1], result[4], result[7], result[10],
                    result[2], result[5], result[8], result[11],
                    result[3], result[6], result[9], result[12]);

                } else if ((result = this.regexp.face_vertex_uv.exec(line)) !== null) {

                    // f vertex/uv vertex/uv vertex/uv
                    // 0                  1    2    3    4    5    6   7          8
                    // ["f 1/1 2/2 3/3", "1", "1", "2", "2", "3", "3", undefined, undefined]

                    state.addFace(
                    result[1], result[3], result[5], result[7],
                    result[2], result[4], result[6], result[8]);

                } else if ((result = this.regexp.face_vertex_uv_uv2.exec(line)) !== null) {

                    // f vertex/uv//uv2 vertex/uv//uv2 vertex/uv//uv2

                    state.addFace2(
                    result[1], result[4], result[7], result[10],
                    result[2], result[5], result[8], result[11],
                    result[3], result[6], result[9], result[12]);
                    /*
                    state.addFace(
                        result[1], result[4], result[7], result[10],
                        result[2], result[5], result[8], result[11]);
                    */
                } 
                else if ((result = this.regexp.face_vertex_normal.exec(line)) !== null) {

                    // f vertex//normal vertex//normal vertex//normal
                    // 0                     1    2    3    4    5    6   7          8
                    // ["f 1//1 2//2 3//3", "1", "1", "2", "2", "3", "3", undefined, undefined]

                    state.addFace(
                    result[1], result[3], result[5], result[7],
                    undefined, undefined, undefined, undefined,
                    result[2], result[4], result[6], result[8]);

                } else if ((result = this.regexp.face_vertex.exec(line)) !== null) {

                    // f vertex vertex vertex
                    // 0            1    2    3   4
                    // ["f 1 2 3", "1", "2", "3", undefined]

                    state.addFace(
                    result[1], result[2], result[3], result[4]);

                } else {

                    throw new Error("Unexpected face line: '" + line + "'");

                }

            } else if (lineFirstChar === "l") {

                var lineParts = line.substring(1).trim().split(" ");
                var lineVertices = [],
                    lineUVs = [];

                if (line.indexOf("/") === -1) {

                    lineVertices = lineParts;

                } else {

                    for (var li = 0, llen = lineParts.length; li < llen; li++) {

                        var parts = lineParts[li].split("/");

                        if (parts[0] !== "") lineVertices.push(parts[0]);
                        if (parts[1] !== "") lineUVs.push(parts[1]);

                    }

                }
                state.addLineGeometry(lineVertices, lineUVs);

            } else if ((result = this.regexp.object_pattern.exec(line)) !== null) {

                // o object_name
                // or
                // g group_name

                var name = result[0].substr(1).trim();
                state.startObject(name);

            } else if (this.regexp.material_use_pattern.test(line)) {

                // material

                state.object.startMaterial(line.substring(7).trim(), state.materialLibraries);

            } else if (this.regexp.material_library_pattern.test(line)) {

                // mtl file

                state.materialLibraries.push(line.substring(7).trim());

            } else if ((result = this.regexp.smoothing_pattern.exec(line)) !== null) {

                // smooth shading

                // @todo Handle files that have varying smooth values for a set of faces inside one geometry,
                // but does not define a usemtl for each face set.
                // This should be detected and a dummy material created (later MultiMaterial and geometry groups).
                // This requires some care to not create extra material on each smooth value for "normal" obj files.
                // where explicit usemtl defines geometry groups.
                // Example asset: examples/models/obj/cerberus/Cerberus.obj

                var value = result[1].trim().toLowerCase();
                state.object.smooth = (value === '1' || value === 'on');

                var material = state.object.currentMaterial();
                if (material) {

                    material.smooth = state.object.smooth;

                }

            } else {

                // Handle null terminated files without exception
                if (line === '\0') continue;

                throw new Error("Unexpected line: '" + line + "'");

            }

        }

        state.finalize();

        var container = [];
        container.materialLibraries = [].concat(state.materialLibraries);
        var tmp_normals  = new Float32Array(state.vertices.length);
        tmp_normals.fill(0);

        var tmp_tangents  = new Float32Array(state.vertices.length);
        tmp_tangents.fill(0);

        var tmp_bitangents  = new Float32Array(state.vertices.length);
        tmp_bitangents.fill(0);

        var tangents  = new Float32Array(state.vertices.length/3*4);



        // temporary variables... 
        // the higher the level language the more hoops you have to jump through 
        // in order to remotely fast code.

        var ab = vec3.create();
        var ac = vec3.create();
        var n = vec3.create();
        var a = vec3.create();
        var b = vec3.create();
        var c = vec3.create();
        
        var num_objects = state.objects.length;
        // calculate sum of all face normals for all vertices
        for (var i = 0; i < num_objects; i++) {
            var geometry = state.objects[i].geometry;
            for(var j = 0;j < geometry.vertex_indices.length/3;j++)
            {
                var verts = state.vertices;
                var indices =  geometry.vertex_indices;

                var ia = indices[j*3 + 0];
                var ib = indices[j*3 + 1];
                var ic = indices[j*3 + 2];

                vec3.set(a, verts[ia + 0], verts[ia + 1], verts[ia + 2]);
                vec3.set(b, verts[ib + 0], verts[ib + 1], verts[ib + 2]);
                vec3.set(c, verts[ic + 0], verts[ic + 1], verts[ic + 2]);
                
                vec3.sub(ab,a,b);
                vec3.sub(ac,a,c);
                vec3.cross(n, ab,ac);

                tmp_normals[ia + 0]+=n[0];
                tmp_normals[ia + 1]+=n[1];
                tmp_normals[ia + 2]+=n[2];
                tmp_normals[ib + 0]+=n[0];
                tmp_normals[ib + 1]+=n[1];
                tmp_normals[ib + 2]+=n[2];
                tmp_normals[ic + 0]+=n[0];
                tmp_normals[ic + 1]+=n[1];
                tmp_normals[ic + 2]+=n[2];
            }
        }

        vec3.forEach(tmp_normals,0,0,0,function(v){
            vec3.normalize(v,v);
        });

        { // tangents and bi tangents
            v1 = vec3.create();
            v2 = vec3.create();
            v3 = vec3.create();
            
            w1 = vec2.create();
            w2 = vec2.create();
            w3 = vec2.create();
            
            sdir = vec3.create();
            tdir = vec3.create();

            for (var i = 0; i < num_objects; i++) {
                var geometry = state.objects[i].geometry;
                for(var j = 0;j < geometry.vertex_indices.length;j+=3)
                {
                    var verts = state.vertices;
                    var uvs = state.uvs;
                    var ia = geometry.vertex_indices[j + 0];
                    var ib = geometry.vertex_indices[j + 1];
                    var ic = geometry.vertex_indices[j + 2];

                    { // load vertices
                        vec3.set(v1, verts[ia + 0], verts[ia + 1], verts[ia + 2]);
                        vec3.set(v2, verts[ib + 0], verts[ib + 1], verts[ib + 2]);
                        vec3.set(v3, verts[ic + 0], verts[ic + 1], verts[ic + 2]);
                        
                     
                    }

                    { // load uvs
                        var indices =  geometry.uv_indices;
                        var ia_uv = geometry.uv_indices[j + 0];
                        var ib_uv = geometry.uv_indices[j + 1];
                        var ic_uv = geometry.uv_indices[j + 2];

                        vec2.set(w1, uvs[ia_uv + 0], uvs[ia_uv + 1]);
                        vec2.set(w2, uvs[ib_uv + 0], uvs[ib_uv + 1]);
                        vec2.set(w3, uvs[ic_uv + 0], uvs[ic_uv + 1]);


                    }

                    { // perform calculation
                        
                        var x1 = v2[0] - v1[0];
                        var x2 = v3[0] - v1[0];
                        var y1 = v2[1] - v1[1];
                        var y2 = v3[1] - v1[1];
                        var z1 = v2[2] - v1[2];
                        var z2 = v3[2] - v1[2];
                        
                        var s1 = w2[0] - w1[0];
                        var s2 = w3[0] - w1[0];
                        var t1 = w2[1] - w1[1];
                        var t2 = w3[1] - w1[1];
                        
                        var r = 1.0 / (s1 * t2 - s2 * t1);
                        vec3.set(sdir,(t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r,
                        (t2 * z1 - t1 * z2) * r);
                        vec3.set(tdir,(s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r,
                        (s1 * z2 - s2 * z1) * r);


                        tmp_tangents[ia + 0]+=sdir[0];
                        tmp_tangents[ia + 1]+=sdir[1];
                        tmp_tangents[ia + 2]+=sdir[2];
                        tmp_tangents[ib + 0]+=sdir[0];
                        tmp_tangents[ib + 1]+=sdir[1];
                        tmp_tangents[ib + 2]+=sdir[2];
                        tmp_tangents[ic + 0]+=sdir[0];
                        tmp_tangents[ic + 1]+=sdir[1];
                        tmp_tangents[ic + 2]+=sdir[2];

                        tmp_bitangents[ia + 0]+=tdir[0];
                        tmp_bitangents[ia + 1]+=tdir[1];
                        tmp_bitangents[ia + 2]+=tdir[2];
                        tmp_bitangents[ib + 0]+=tdir[0];
                        tmp_bitangents[ib + 1]+=tdir[1];
                        tmp_bitangents[ib + 2]+=tdir[2];
                        tmp_bitangents[ic + 0]+=tdir[0];
                        tmp_bitangents[ic + 1]+=tdir[1];
                        tmp_bitangents[ic + 2]+=tdir[2];
                    }
                }
            }


            
            var num_verts = state.vertices.length;
            var n = vec3.create();
            var t = vec3.create();
            var t2 = vec3.create();
            var tdn = vec3.create();
            var ntdn = vec3.create();
            var nct = vec3.create();
            var tntdn = vec3.create();
            for (var a = 0; a < num_verts; a++)
            {
                var i = a*3;
                // load values
                n[0]  = tmp_normals[i];    n[1]  = tmp_normals[i+1];    n[2]  = tmp_normals[i+2];    
                t[0]  = tmp_tangents[i];   t[1]  = tmp_tangents[i+1];   t[2]  = tmp_tangents[i+2];   
                t2[0] = tmp_bitangents[i]; t2[1] = tmp_bitangents[i+1]; t2[2] = tmp_bitangents[i+2]; 


                // Gram-Schmidt orthogonalize
                // t = (t - n * Dot(n, t)).Normalize();
                // var w = (Dot(Cross(n, t), tan2[a]) < 0.0F) ? -1.0F : 1.0F;

                vec3.dot(tdn,t,n); // tdn = dot(t,n)
                vec3.mul(ntdn,n,tdn); // ntdn = n * dot(t,n)
                vec3.sub(tntdn,t,ntdn); // tntdn = t - n*dot(t,n)

                vec3.normalize(tntdn,tntdn); // tsn = normalize((t-n) * dot(t,n))

                vec3.cross(nct,n,t);
                var w;
                if(vec3.dot(nct,t2)< 0) w = -1.0;
                else w = 1.0;

                var j = a *4;
                tangents[j+0] = tntdn[0]; tangents[j+1] = tntdn[1]; tangents[j+2] = tntdn[2]; tangents[j+3] = w;
            }
        }


            

        for (var i = 0; i < state.objects.length; i++) {
            
            var object = state.objects[i];
            var geometry = object.geometry;
            var materials = object.materials;
            var isLine = (geometry.type === 'Line');
            
            
            // Skip o/g line declarations that did not follow with any faces
            if (geometry.vertex_indices.length === 0) continue;
            geometry.name = object.name;
            
            
            // flatten the elements ie remove indexing.
            // since we use lightmaps there's no need to try to keep any form of indexing
            // all verts are distinct anyway. (on their uv2)
            // for better perf when that isn't needed we might try to keep indexing
            // however since we have separate indexing for positions,uvs,uv2s,normals etc
            // that would require quite a large rewrite.
            // now we do atleast calculate the normals correctly.

            var verts_out = new Float32Array(3 * geometry.vertex_indices.length);
            // var normals_out =[(3 * geometry.vertices.length)];
            var normals_out =new Float32Array(3 * geometry.vertex_indices.length);

            var tangents_out = new Float32Array(4*geometry.vertex_indices.length);
            var uvs_out = new Float32Array(2 * geometry.vertex_indices.length);
            if(geometry.vertex_indices.length != geometry.uv_indices.length) console.error('must provide uvs for all faces!');
            var num_tris = geometry.vertex_indices.length/3;
          
            for(var j = 0; j<num_tris;j++)
            {
                var verts_in = state.vertices;
                var uvs_in = state.uvs;
                var normals_in = tmp_normals;
                var tangents_in = tangents;
                {
                    var indices =  geometry.vertex_indices;
                    var ia = indices[j*3 + 0];
                    var ib = indices[j*3 + 1];
                    var ic = indices[j*3 + 2];

                    verts_out[j*9 + 0]=verts_in[ia+0];
                    verts_out[j*9 + 1]=verts_in[ia+1];
                    verts_out[j*9 + 2]=verts_in[ia+2];
                    verts_out[j*9 + 3]=verts_in[ib+0];
                    verts_out[j*9 + 4]=verts_in[ib+1];
                    verts_out[j*9 + 5]=verts_in[ib+2];
                    verts_out[j*9 + 6]=verts_in[ic+0];
                    verts_out[j*9 + 7]=verts_in[ic+1];
                    verts_out[j*9 + 8]=verts_in[ic+2];

                    normals_out[j*9 + 0]=normals_in[ia+0]; 
                    normals_out[j*9 + 1]=normals_in[ia+1];
                    normals_out[j*9 + 2]=normals_in[ia+2];
                    normals_out[j*9 + 3]=normals_in[ib+0];
                    normals_out[j*9 + 4]=normals_in[ib+1];
                    normals_out[j*9 + 5]=normals_in[ib+2];
                    normals_out[j*9 + 6]=normals_in[ic+0];
                    normals_out[j*9 + 7]=normals_in[ic+1];
                    normals_out[j*9 + 8]=normals_in[ic+2];

                    tangents_out[j*12 + 0]=tangents_in[ia/3*4+0]; 
                    tangents_out[j*12 + 1]=tangents_in[ia/3*4+1];
                    tangents_out[j*12 + 2]=tangents_in[ia/3*4+2];
                    tangents_out[j*12 + 3]=tangents_in[ia/3*4+3];
                    tangents_out[j*12 + 4]=tangents_in[ib/3*4+0];
                    tangents_out[j*12 + 5]=tangents_in[ib/3*4+1];
                    tangents_out[j*12 + 6]=tangents_in[ib/3*4+2];
                    tangents_out[j*12 + 7]=tangents_in[ib/3*4+3];
                    tangents_out[j*12 + 8]=tangents_in[ic/3*4+0];
                    tangents_out[j*12 + 9]=tangents_in[ic/3*4+1];
                    tangents_out[j*12 + 10]=tangents_in[ic/3*4+2];
                    tangents_out[j*12 + 11]=tangents_in[ic/3*4+3];
                }
                {
                    var indices =  geometry.uv_indices;
                    var ia = indices[j*3 + 0];
                    var ib = indices[j*3 + 1];
                    var ic = indices[j*3 + 2];

                    uvs_out[j*6 + 0]=uvs_in[ia+0];
                    uvs_out[j*6 + 1]=uvs_in[ia+1];
                    uvs_out[j*6 + 2]=uvs_in[ib+0];
                    uvs_out[j*6 + 3]=uvs_in[ib+1];
                    uvs_out[j*6 + 4]=uvs_in[ic+0];
                    uvs_out[j*6 + 5]=uvs_in[ic+1];
                }
            }
                
            var material = {};
            
            container.push(
                {
                    tangents: tangents_out,
                    normals: normals_out, 
                    positions: verts_out, 
                    uvs: uvs_out, 
                    uv2s: new Float32Array(geometry.uv2s),
                    name: object.name,
                    material: materials[0].name, //@Robustness, assumes that we only have one material per object. Not always true! 
                });
            
        }
        console.timeEnd('OBJLoader');
        return container;

    }
}; 

