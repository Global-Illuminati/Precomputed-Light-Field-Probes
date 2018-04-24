'using strict';

function validateFramebuffer(framebuffer) {
	console.assert(framebuffer.getStatus() === PicoGL.FRAMEBUFFER_COMPLETE, "Framebuffer is not complete!");
}

////////////////////////////////////////////////////////////////////////////////

var stats;
var gui;

var settings = {
	target_fps: 60,
	environment_brightness: 1.5,

	render_probe_locations: true,
	do_debug_show_probe: false,
	debug_show_probe_index: 0,
	debug_show_probe_map: 'radiance',
	debug_show_probe_map_options: ['radiance', 'distanceHigh', 'distanceLow', 'normals', 'irradiance', 'filteredDistance'],

	irradiance_num_samples: 512,
	irradiance_lobe_size: 0.99,
	filtered_distance_lobe_size: 0.08
};

var sceneSettings = {
	ambientColor: new Float32Array([0.25, 0.25, 0.25, 1.0]),
};

////////////////////////////////////////////////////////////////////////////////

var app;

var gpuTimePanel;
var picoTimer;
var picoPrecomputeTimer;

var defaultShader;
var precomputeShader;
var shadowMapShader;

var blitTextureDrawCall;
var blitTextureArrayDrawCall;
var blitCubemapDrawCall

var environmentDrawCall;
var environmentMap;

var sceneUniforms;

var shadowMapSize = 4096;
var shadowMapFramebuffer;

var camera;
var spotLight;
var directionalLight;
var meshes = [];
var performPrecomputeThisFrame = false;

var probeDrawCall;
var probeLocations;
var precomputeIndex = 0;

var probeOrigin;
var probeCount;
var probeStep;

var octahedralDrawCall;
var octahedralFramebuffer;
var octahedralFramebufferLow;
var lowPrecisionSizeDownsample = 16;
var probeOctahedralSize;
var probeOctahedrals = {
	radiance: null,
	distanceLow: null,
	distanceHigh: null,
	normals: null,
	irradiance: null
};

var probeRenderingFramebuffer;
var probeCubemaps = {};
var probeCubeSize;

var irradianceDrawCall;
var irradianceFramebuffer;
var irradianceSize = 128;
//filtered distance, squared distance as well..

window.addEventListener('DOMContentLoaded', function () {

	init();
	resize();

	window.addEventListener('resize', resize, false);
	requestAnimationFrame(render);

}, false);

////////////////////////////////////////////////////////////////////////////////
// Utility

function checkWebGL2Compability() {

	var c = document.createElement('canvas');
	var webgl2 = c.getContext('webgl2');
	if (!webgl2) {
		var message = document.createElement('p');
		message.id = 'no-webgl2-error';
		message.innerHTML = 'WebGL 2.0 doesn\'t seem to be supported in this browser and is required for this demo! ' +
			'It should work on most modern desktop browsers though.';
		canvas.parentNode.replaceChild(message, document.getElementById('canvas'));
		return false;
	}
	return true;

}

function loadTexture(imageName, options) {

	if (!options) {

		var options = {};
		options['minFilter'] = PicoGL.LINEAR_MIPMAP_NEAREST;
		options['magFilter'] = PicoGL.LINEAR;
		options['mipmaps'] = true;

	}

	var texture = app.createTexture2D(1, 1, options);
	texture.data(new Uint8Array([200, 200, 200, 256]));

	var image = document.createElement('img');
	image.onload = function() {

		texture.resize(image.width, image.height);
		texture.data(image);

	};
	image.src = 'assets/' + imageName;
	return texture;

}

function makeShader(name, shaderLoaderData) {

	var programData = shaderLoaderData[name];
	var program = app.createProgram(programData.vertexSource, programData.fragmentSource);
	return program;

}

function makeSingleColorTexture(color) {
    var options = {};
    options['minFilter'] = PicoGL.NEAREST;
    options['magFilter'] = PicoGL.NEAREST;
    options['mipmaps'] = false;
    options['format'] = PicoGL.RGB;
    options['internalFormat'] = PicoGL.RGB32F;
    options['type'] = PicoGL.FLOAT;
    var side = 32;
    var arr =  [];
    for (var i = 0; i < side*side; i++) {
    	arr = arr.concat(color);
	}
    var image_data = new Float32Array( arr );
    return app.createTexture2D(image_data, side, side, options);
}

function loadObject(directory, objFilename, mtlFilename, modelMatrix) {

	var objLoader = new OBJLoader();
	var mtlLoader = new MTLLoader();

	var path = 'assets/' + directory;

	objLoader.load(path + objFilename, function(objects) {
		mtlLoader.load(path + mtlFilename, function(materials) {
			objects.forEach(function(object) {

				var material = materials[object.material];
				var diffuseTexture;
				if (material.properties.map_Kd) {
                    diffuseTexture = loadTexture(directory + material.properties.map_Kd);
                } else {
					diffuseTexture = makeSingleColorTexture(material.properties.Kd);
				}
				var specularMap = (material.properties.map_Ks)   ? directory + material.properties.map_Ks   : 'default_specular.jpg';
				var normalMap   = (material.properties.map_norm) ? directory + material.properties.map_norm : 'default_normal.jpg';

				var vertexArray = createVertexArrayFromMeshInfo(object);

				var drawCall = app.createDrawCall(defaultShader, vertexArray)
				.uniformBlock('SceneUniforms', sceneUniforms)
				.texture('u_diffuse_map', diffuseTexture)
				.texture('u_specular_map', loadTexture(specularMap))
				.texture('u_normal_map', loadTexture(normalMap));

				var precomputeDrawCall = app.createDrawCall(precomputeShader, vertexArray)
				.uniformBlock('SceneUniforms', sceneUniforms)
				.texture('u_diffuse_map', diffuseTexture)
				.texture('u_specular_map', loadTexture(specularMap))
				.texture('u_normal_map', loadTexture(normalMap));

				var shadowMappingDrawCall = app.createDrawCall(shadowMapShader, vertexArray);

				meshes.push({
					modelMatrix: modelMatrix || mat4.create(),
					drawCall: drawCall,
					precomputeDrawCall: precomputeDrawCall,
					shadowMapDrawCall: shadowMappingDrawCall
				});

			});
		});
	});

}

////////////////////////////////////////////////////////////////////////////////
// Initialization etc.

function init() {

	if (!checkWebGL2Compability()) {
		return;
	}

	var canvas = document.getElementById('canvas');
	app = PicoGL.createApp(canvas, { antialias: true });
	app.floatRenderTargets();
	app.linearFloatTextures();

	stats = new Stats();
	stats.showPanel(1); // (frame time)
	document.body.appendChild(stats.dom);

	gpuTimePanel = stats.addPanel(new Stats.Panel('MS (GPU)', '#ff8', '#221'));
	picoTimer = app.createTimer();
	picoPrecomputeTimer = app.createTimer();

	gui = new dat.GUI();
	gui.add(settings, 'target_fps', 0, 120).name('Target FPS');
	gui.add(settings, 'environment_brightness', 0.0, 2.0).name('Environment brightness');

	var probe = gui.addFolder('Probe stuff');
	probe.add({ f: function() { performPrecomputeThisFrame = true }}, 'f').name('Precompute');
	probe.add(settings, 'render_probe_locations').name('Render locations');
	probe.add(settings, 'do_debug_show_probe').name('Show probe');
	probe.add(settings, 'debug_show_probe_index', 0, 64).name('... probe index');
	probe.add(settings, 'debug_show_probe_map', settings.debug_show_probe_map_options).name('... texture');
	probe.open();

	var irradiance = probe.addFolder('Irradiance');
	irradiance.add(settings, 'irradiance_num_samples', 1, 4096).name('Num samples');
	irradiance.add(settings, 'irradiance_lobe_size', 0.0, 1.0).name('Cos lobe size');

	var filteredDistance = probe.addFolder('Filtered distance');
	filteredDistance.add(settings, 'filtered_distance_lobe_size', 0.0, 0.5).name('Cos lobe size');

	window.addEventListener('keydown', function(e) {
		if (e.keyCode == 80 /* p(recompute) */) performPrecomputeThisFrame = true;
	});

	//////////////////////////////////////
	// Basic GL state

	app.clearColor(0, 0, 0, 1);
	app.cullBackfaces();
	app.noBlend();

	//////////////////////////////////////
	// Camera stuff

	var cameraPos = vec3.fromValues(-2, 1.75, -2);
	var cameraRot = quat.fromEuler(quat.create(), -15, -150, 0);
	camera = new Camera(cameraPos, cameraRot);

	//////////////////////////////////////
	// Scene setup

	directionalLight = new DirectionalLight(vec3.fromValues(0.35, -0.7, -1.0), vec3.fromValues(0.2, 0.2, 0.2));
	setupDirectionalLightShadowMapFramebuffer(shadowMapSize);

	var spotPos = vec3.fromValues(-3.2, 2.2, 0.5);
	var spotDir = vec3.fromValues(-1, 0, 0.3);
	spotLight = new SpotLight(spotPos, spotDir, 20, vec3.fromValues(1.0, 0.6, 20.0));

	environmentMap = loadTexture('environments/ocean.jpg', {
		minFilter: PicoGL.NEAREST,
		magFilter: PicoGL.NEAREST,
		wrapS: PicoGL.CLAMP_TO_EDGE,
		wrapT: PicoGL.CLAMP_TO_EDGE
	});

	setupSceneUniforms();

	var shaderLoader = new ShaderLoader('src/shaders/');
	shaderLoader.addShaderFile('common.glsl');
	shaderLoader.addShaderFile('octahedral.glsl')
	shaderLoader.addShaderFile('scene_uniforms.glsl');
	shaderLoader.addShaderFile('mesh_attributes.glsl');
	shaderLoader.addShaderFile('light_field_probe.glsl');
	shaderLoader.addShaderFile('light_field_probe_diffuse.glsl');
	shaderLoader.addShaderProgram('unlit', 'unlit.vert.glsl', 'unlit.frag.glsl');
	shaderLoader.addShaderProgram('default', 'default.vert.glsl', 'default.frag.glsl');
	shaderLoader.addShaderProgram('precompute', 'default.vert.glsl', 'precompute.frag.glsl');
	shaderLoader.addShaderProgram('environment', 'environment.vert.glsl', 'environment.frag.glsl');
	shaderLoader.addShaderProgram('textureBlit', 'screen_space.vert.glsl', 'texture_blit.frag.glsl');
	shaderLoader.addShaderProgram('textureArrayBlit', 'screen_space.vert.glsl', 'texture_array_blit.frag.glsl');
	shaderLoader.addShaderProgram('cubemapBlit', 'screen_space.vert.glsl', 'cubemap_blit.frag.glsl');
	shaderLoader.addShaderProgram('shadowMapping', 'shadow_mapping.vert.glsl', 'shadow_mapping.frag.glsl');
	shaderLoader.addShaderProgram('octahedralMap', 'screen_space.vert.glsl', 'octahedral.frag.glsl');
	shaderLoader.addShaderProgram('irradianceMap', 'screen_space.vert.glsl', 'irradiance.frag.glsl');
	shaderLoader.load(function(data) {

		var fullscreenVertexArray = createFullscreenVertexArray();

		var textureBlitShader = makeShader('textureBlit', data);
		blitTextureDrawCall = app.createDrawCall(textureBlitShader, fullscreenVertexArray);
		var textureArrayBlitShader = makeShader('textureArrayBlit', data);
		blitTextureArrayDrawCall = app.createDrawCall(textureArrayBlitShader, fullscreenVertexArray);
		var cubemapBlitShader = makeShader('cubemapBlit', data);
		blitCubemapDrawCall = app.createDrawCall(cubemapBlitShader, fullscreenVertexArray);

		var octahedralShader = makeShader('octahedralMap', data);
		octahedralDrawCall = app.createDrawCall(octahedralShader, fullscreenVertexArray);

		var irradianceShader = makeShader('irradianceMap', data);
		irradianceDrawCall = app.createDrawCall(irradianceShader, fullscreenVertexArray);
		irradianceDrawCall.uniformBlock('SphereSamples', createSpherSamplesUniformBuffer());

		var environmentShader = makeShader('environment', data);
		environmentDrawCall = app.createDrawCall(environmentShader, fullscreenVertexArray)
		.texture('u_environment_map', environmentMap);

		var unlitShader = makeShader('unlit', data);
		var probeVertexArray = createSphereVertexArray(0.08, 8, 8);

		placeProbes();
		setupProbeDrawCall(probeVertexArray, unlitShader);

		defaultShader = makeShader('default', data);
		precomputeShader = makeShader('precompute', data);
		shadowMapShader = makeShader('shadowMapping', data);

/*		{
			let m = mat4.create();
			let r = quat.fromEuler(quat.create(), 0, 0, 0);
			let t = vec3.fromValues(0, 0, 0);
			let s = vec3.fromValues(1, 1, 1);
			mat4.fromRotationTranslationScale(m, r, t, s);
			loadObject('test_room/', 'test_room.obj', 'test_room.mtl', m);
		}
*/

		{
			let m = mat4.create();
			let r = quat.fromEuler(quat.create(), 0, 0, 0);
			let t = vec3.fromValues(0, 0, -7);
			let s = vec3.fromValues(1.8, 1.8, 1.8);
			mat4.fromRotationTranslationScale(m, r, t, s);
			loadObject('living_room/', 'living_room.obj', 'living_room.mtl', m);
		}

/*
		{
			let m = mat4.create();
			let r = quat.fromEuler(quat.create(), 0, 0, 0);
			let t = vec3.fromValues(0, 0, 0);
			let s = vec3.fromValues(4, 4, 4);
			mat4.fromRotationTranslationScale(m, r, t, s);
			loadObject('cornell/', 'cornell.obj', 'cornell.mtl', m);
		}
*/
		//loadObject('sponza/', 'sponza.obj', 'sponza.mtl');
/*
		{
			let m = mat4.create();
			let r = quat.fromEuler(quat.create(), 0, 45, 0);
			let t = vec3.fromValues(0, 1, 0);
			let s = vec3.fromValues(0.06, 0.06, 0.06);
			mat4.fromRotationTranslationScale(m, r, t, s);
			loadObject('teapot/', 'teapot.obj', 'default.mtl', m);
		}

		{
			let m = mat4.create();
			let r = quat.fromEuler(quat.create(), 0, 35, 0);
			let t = vec3.fromValues(-15, 4, -4);
			let s = vec3.fromValues(3, 3, 3);
			mat4.fromRotationTranslationScale(m, r, t, s);
			loadObject('quad/', 'quad.obj', 'quad.mtl', m);
		}
*/
		setupProbes(256, 1024);

	});

}

function createFullscreenVertexArray() {

	var positions = app.createVertexBuffer(PicoGL.FLOAT, 3, new Float32Array([
		-1, -1, 0,
		+3, -1, 0,
		-1, +3, 0
	]));

	var vertexArray = app.createVertexArray()
	.vertexAttributeBuffer(0, positions);

	return vertexArray;

}

function createSphereVertexArray(radius, rings, sectors) {

	var positions = [];

	var R = 1.0 / (rings - 1);
	var S = 1.0 / (sectors - 1);

	var PI = Math.PI;
	var TWO_PI = 2.0 * PI;

	for (var r = 0; r < rings; ++r) {
		for (var s = 0; s < sectors; ++s) {

			var y = Math.sin(-(PI / 2.0) + PI * r * R);
			var x = Math.cos(TWO_PI * s * S) * Math.sin(PI * r * R);
			var z = Math.sin(TWO_PI * s * S) * Math.sin(PI * r * R);

			positions.push(x * radius);
			positions.push(y * radius);
			positions.push(z * radius);

		}
	}

	var indices = [];

	for (var r = 0; r < rings - 1; ++r) {
		for (var s = 0; s < sectors - 1; ++s) {

			var i0 = r * sectors + s;
			var i1 = r * sectors + (s + 1);
			var i2 = (r + 1) * sectors + (s + 1);
			var i3 = (r + 1) * sectors + s;

			indices.push(i2);
			indices.push(i1);
			indices.push(i0);

			indices.push(i3);
			indices.push(i2);
			indices.push(i0);

		}
	}

	var positionBuffer = app.createVertexBuffer(PicoGL.FLOAT, 3, new Float32Array(positions));
	var indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_SHORT, 3, new Uint16Array(indices));

	var vertexArray = app.createVertexArray()
	.vertexAttributeBuffer(0, positionBuffer)
	.indexBuffer(indexBuffer);

	return vertexArray;

}

function setupDirectionalLightShadowMapFramebuffer(size) {

	var colorBuffer = app.createTexture2D(size, size, {
		format: PicoGL.RED,
		internalFormat: PicoGL.R16F,
		type: PicoGL.FLOAT,
		minFilter: PicoGL.NEAREST,
		magFilter: PicoGL.NEAREST
	});

	var depthBuffer = app.createTexture2D(size, size, {
		format: PicoGL.DEPTH_COMPONENT,
		internalFormat: PicoGL.DEPTH_COMPONENT32F
	});

	shadowMapFramebuffer = app.createFramebuffer()
	.colorTarget(0, colorBuffer)
	.depthTarget(depthBuffer);

}

function setupSceneUniforms() {

	//
	// TODO: Fix all this! I got some weird results when I tried all this before but it should work...
	//

	sceneUniforms = app.createUniformBuffer([
		PicoGL.FLOAT_VEC4 /* 0 - ambient color */   //,
		//PicoGL.FLOAT_VEC4 /* 1 - directional light color */,
		//PicoGL.FLOAT_VEC4 /* 2 - directional light direction */,
		//PicoGL.FLOAT_MAT4 /* 3 - view from world matrix */,
		//PicoGL.FLOAT_MAT4 /* 4 - projection from view matrix */
	])
	.set(0, sceneSettings.ambientColor)
	//.set(1, directionalLight.color)
	//.set(2, directionalLight.direction)
	//.set(3, camera.viewMatrix)
	//.set(4, camera.projectionMatrix)
	.update();

/*
	camera.onViewMatrixChange = function(newValue) {
		sceneUniforms.set(3, newValue).update();
	};

	camera.onProjectionMatrixChange = function(newValue) {
		sceneUniforms.set(4, newValue).update();
	};
*/

}

function createPointsInSphere(count) {

	var size = count * 3;
	var points = new Float32Array(size);

	for (var i = 0; i < count; ++i) {

		var x, y, z;
		var lengthSquared;

		do {
			x = Math.random() * 2.0 - 1.0;
			y = Math.random() * 2.0 - 1.0;
			z = Math.random() * 2.0 - 1.0;
			lengthSquared = x*x + y*y + z*z;
		} while (lengthSquared >= 1.0);

		var length = Math.sqrt(lengthSquared);

		points[3 * i + 0] = x / length;
		points[3 * i + 1] = y / length;
		points[3 * i + 2] = z / length;
	}

	return points;
}

function createSpherSamplesUniformBuffer() {

	// Make sure this matches the value in the shader!
	var size = 4096;

	var description = new Array(size).fill(PicoGL.FLOAT_VEC4);
	var uniformBuffer = app.createUniformBuffer(description);

	var samples = createPointsInSphere(size);

	for (var i = 0; i < size; ++i) {
		var sample = vec4.fromValues(
			samples[3 * i + 0],
			samples[3 * i + 1],
			samples[3 * i + 2],
			0.0
		);
		uniformBuffer.set(i, sample);
	}

	uniformBuffer.update();
	return uniformBuffer;
}

function createVertexArrayFromMeshInfo(meshInfo) {

	var positions = app.createVertexBuffer(PicoGL.FLOAT, 3, meshInfo.positions);
	var normals   = app.createVertexBuffer(PicoGL.FLOAT, 3, meshInfo.normals);
	var tangents  = app.createVertexBuffer(PicoGL.FLOAT, 4, meshInfo.tangents);
	var texCoords = app.createVertexBuffer(PicoGL.FLOAT, 2, meshInfo.uvs);

	var vertexArray = app.createVertexArray()
	.vertexAttributeBuffer(0, positions)
	.vertexAttributeBuffer(1, normals)
	.vertexAttributeBuffer(2, texCoords)
	.vertexAttributeBuffer(3, tangents);

	return vertexArray;

}

function placeProbes() {

	probeOrigin = vec3.fromValues(-3.0, 1.0, -3.0);
	probeStep   = vec3.fromValues(2.0, 2.0, 2.0);
	probeCount  = new Int32Array([4, 2, 4]);

/*
	probeOrigin = vec3.fromValues(-1.5, 0.25, 2.5);
	probeStep   = vec3.fromValues(2.5, 2.5, 2.5);
	probeCount  = new Int32Array([2, 2, 2]);
*/
/*
	probeOrigin = vec3.fromValues(-22.0, 6.0, -8.0);
	probeStep   = vec3.fromValues(15.6, 8.0, 5.35);
	probeCount  = new Int32Array([4, 4, 4]);
*/
/*
	probeOrigin = vec3.fromValues(-6.0, 1.5, -4.2);
	probeStep   = vec3.fromValues(3.0, 3.0, 3.0);
	probeCount  = new Int32Array([4, 4, 4]);
*/
	var totalCount = probeCount[0] * probeCount[1] * probeCount[2];
	probeLocations = new Array(totalCount);
	var index = 0;

	for (var z = 0; z < probeCount[2]; ++z) {
		for (var y = 0; y < probeCount[1]; ++y) {
			for (var x = 0; x < probeCount[0]; ++x) {

				var location = vec3.create();
				var diff = vec3.create();

				vec3.mul(diff, vec3.fromValues(x, y, z), probeStep);
				vec3.add(location, probeOrigin, diff);

				probeLocations[index++] = location;

			}
		}
	}

}

function setupProbeDrawCall(vertexArray, shader) {

	if (probeLocations.length === 0) {
		return;
	}

	var probeLocationBuffer = new Float32Array(probeLocations.length * 3);
	for (var i = 0, len = probeLocations.length; i < len; ++i) {
		probeLocationBuffer[3 * i + 0] = probeLocations[i][0];
		probeLocationBuffer[3 * i + 1] = probeLocations[i][1];
		probeLocationBuffer[3 * i + 2] = probeLocations[i][2];
	}

	// Set up for instanced drawing at the probe locations
	var translations = app.createVertexBuffer(PicoGL.FLOAT, 3, probeLocationBuffer);
	vertexArray.instanceAttributeBuffer(10, translations);

	probeDrawCall = app.createDrawCall(shader, vertexArray)
	.uniform('u_color', vec3.fromValues(0, 1, 0));

}

function setupProbes(cubemapSize, octahedralSize) {

	// Cubemap stuff

	probeRenderingFramebuffer = app.createFramebuffer();
	probeCubeSize = cubemapSize;

	//
	// NOTE: We use redundantly high precision formats for the cubemaps so that
	// we get an optimal transfer to the octahedrals. Can definitely be optimized!
	//

	probeCubemaps['radiance'] = app.createCubemap({
		width: cubemapSize,
		height: cubemapSize,
		type: PicoGL.HALF_FLOAT,
		format: PicoGL.RGBA,
		internalFormat: PicoGL.RGBA16F
	});

	probeCubemaps['depth'] = app.createCubemap({
		width: cubemapSize,
		height: cubemapSize,
		type: PicoGL.FLOAT,
		format: PicoGL.DEPTH_COMPONENT,
		internalFormat: PicoGL.DEPTH_COMPONENT16F
	});

	probeCubemaps['normals'] = app.createCubemap({
		width: cubemapSize,
		height: cubemapSize,
		type: PicoGL.FLOAT,
		format: PicoGL.RGBA,
		internalFormat: PicoGL.RGBA16F
	});

	probeCubemaps['distance'] = app.createCubemap({
		width: cubemapSize,
		height: cubemapSize,
		type: PicoGL.FLOAT,
		format: PicoGL.RG,
		internalFormat: PicoGL.RG16F
	});

	// Octahedral stuff

	octahedralFramebuffer = app.createFramebuffer();
	probeOctahedralSize = octahedralSize;

	octahedralFramebufferLow = app.createFramebuffer();
	var lowSize = octahedralSize / lowPrecisionSizeDownsample;
	probeOctahedralSizeLow = lowSize;

	//
	// NOTE: Formats below taken from the paper!
	//

	var numProbes = probeLocations.length;

	probeOctahedrals['radiance'] = app.createTextureArray(octahedralSize, octahedralSize, numProbes, {
		type: PicoGL.FLOAT,
		format: PicoGL.RGB,
		internalFormat: PicoGL.R11F_G11F_B10F,
		minFilter: PicoGL.NEAREST,
		magFilter: PicoGL.NEAREST
	});

	// TODO: Probably encode normals as RG8 instead to compress it a bit (like in the paper). We don't need much precision anyway...
	probeOctahedrals['normals'] = app.createTextureArray(octahedralSize, octahedralSize, numProbes, {
		type: PicoGL.UNSIGNED_BYTE,
		format: PicoGL.RGB,
		internalFormat: PicoGL.RGB8,
		minFilter: PicoGL.NEAREST,
		magFilter: PicoGL.NEAREST
	});

	probeOctahedrals['distanceHigh'] = app.createTextureArray(octahedralSize, octahedralSize, numProbes, {
		type: PicoGL.FLOAT,
		format: PicoGL.RED,
		internalFormat: PicoGL.R16F,
		minFilter: PicoGL.NEAREST,
		magFilter: PicoGL.NEAREST
	});

	probeOctahedrals['distanceLow'] = app.createTextureArray(lowSize, lowSize, numProbes, {
		type: PicoGL.FLOAT,
		format: PicoGL.RED,
		internalFormat: PicoGL.R16F,
		minFilter: PicoGL.NEAREST,
		magFilter: PicoGL.NEAREST
	});

	//
	// Currently not octahedrals but actually a sphere-map (for spacial coherency & linear sampling)
	//

	irradianceFramebuffer = app.createFramebuffer();
	probeOctahedrals['irradiance'] = app.createTextureArray(irradianceSize, irradianceSize, numProbes, {
		type: PicoGL.FLOAT,
		format: PicoGL.RGB,
		internalFormat: PicoGL.R11F_G11F_B10F,
		minFilter: PicoGL.LINEAR,
		magFilter: PicoGL.LINEAR,
		wrapS: PicoGL.CLAMP_TO_EDGE,
		wrapT: PicoGL.CLAMP_TO_EDGE
	});

	probeOctahedrals['filteredDistance'] = app.createTextureArray(irradianceSize, irradianceSize, numProbes, {
		type: PicoGL.FLOAT,
		format: PicoGL.RG,
		internalFormat: PicoGL.RG16F,
		minFilter: PicoGL.LINEAR,
		magFilter: PicoGL.LINEAR,
		wrapS: PicoGL.CLAMP_TO_EDGE,
		wrapT: PicoGL.CLAMP_TO_EDGE
	});

}

////////////////////////////////////////////////////////////////////////////////

function resize() {

	var w = window.innerWidth;
	var h = window.innerHeight;

	app.resize(w, h);
	camera.resize(w, h);

}

////////////////////////////////////////////////////////////////////////////////
// Rendering

function render() {
	var startStamp = new Date().getTime();

	stats.begin();
	picoTimer.start();
	{
		camera.update();

		renderShadowMap();

		if (performPrecomputeThisFrame) {
			let start = new Date().getTime();

			//precompute();
			precomputeProbe(precomputeIndex);

			let end = new Date().getTime();
			let timePassed = end - start;
			console.log('Precompute for probe ' + precomputeIndex + ' took ' + timePassed + 'ms');
			precomputeIndex++;

			if (precomputeIndex == probeLocations.length) {
				performPrecomputeThisFrame = false;
				precomputeIndex = 0;
			}
		}

		if (settings.do_debug_show_probe) {

			var name = settings.debug_show_probe_map;
			var layer = settings.debug_show_probe_index;
			var isDepthMap = name.indexOf('istance') != -1;
			renderTextureArrayToScreen(probeOctahedrals[name], layer, isDepthMap);

		} else {

			renderScene();

			var viewProjection = mat4.mul(mat4.create(), camera.projectionMatrix, camera.viewMatrix);

			if (settings.render_probe_locations) {
			renderProbeLocations(viewProjection);
			}

			var inverseViewProjection = mat4.invert(mat4.create(), viewProjection);
			renderEnvironment(inverseViewProjection)

		}

	}
	picoTimer.end();
	stats.end();

	if (picoTimer.ready()) {
		gpuTimePanel.update(picoTimer.gpuTime, 35);
	}

	requestAnimationFrame(render);
}

function shadowMapNeedsRendering() {

	var lastDirection = shadowMapNeedsRendering.lastDirection || vec3.create();
	var lastMeshCount = shadowMapNeedsRendering.lastMeshCount || 0;

	if (vec3.equals(lastDirection, directionalLight.direction) && lastMeshCount === meshes.length) {

		return false;

	} else {

		shadowMapNeedsRendering.lastDirection = vec3.copy(lastDirection, directionalLight.direction);
		shadowMapNeedsRendering.lastMeshCount = meshes.length;

		return true;

	}


}

function renderShadowMap() {

	if (!directionalLight) return;
	if (!shadowMapNeedsRendering()) return;

	var lightViewProjection = directionalLight.getLightViewProjectionMatrix();

	app.drawFramebuffer(shadowMapFramebuffer)
	.viewport(0, 0, shadowMapSize, shadowMapSize)
	.depthTest()
	.depthFunc(PicoGL.LEQUAL)
	.noBlend()
	.clear();

	for (var i = 0, len = meshes.length; i < len; ++i) {

		var mesh = meshes[i];

		mesh.shadowMapDrawCall
		.uniform('u_world_from_local', mesh.modelMatrix)
		.uniform('u_light_projection_from_world', lightViewProjection)
		.draw();

	}

}

function renderScene() {

	var dirLightViewDirection = directionalLight.viewSpaceDirection(camera);
	var lightViewProjection = directionalLight.getLightViewProjectionMatrix();
	var shadowMap = shadowMapFramebuffer.depthTexture;

	var spotLightViewPosition = spotLight.viewSpacePosition(camera);
	var spotLightViewDirection = spotLight.viewSpaceDirection(camera);

	app.defaultDrawFramebuffer()
	.defaultViewport()
	.depthTest()
	.depthFunc(PicoGL.LEQUAL)
	.noBlend()
	.clear();

	for (var i = 0, len = meshes.length; i < len; ++i) {

		var mesh = meshes[i];

		mesh.drawCall

		// Default uniforms
		.uniform('u_camera_position', camera.position)
		.uniform('u_world_from_local', mesh.modelMatrix)
		.uniform('u_view_from_world', camera.viewMatrix)
		.uniform('u_projection_from_view', camera.projectionMatrix)
		.uniform('u_dir_light_color', directionalLight.color)
		.uniform('u_dir_light_view_direction', dirLightViewDirection)
		.uniform('u_light_projection_from_world', lightViewProjection)
		.texture('u_shadow_map', shadowMap)
		.uniform('u_spot_light_color', spotLight.color)
		.uniform('u_spot_light_cone', spotLight.cone)
		.uniform('u_spot_light_view_position', spotLightViewPosition)
		.uniform('u_spot_light_view_direction', spotLightViewDirection)
		.texture('u_environment_map', environmentMap)

		// GI uniforms
		.texture('L.radianceProbeGrid', probeOctahedrals['radiance'])
		.texture('L.normalProbeGrid', probeOctahedrals['normals'])
		.texture('L.distanceProbeGrid', probeOctahedrals['distanceHigh'])
		.texture('L.lowResolutionDistanceProbeGrid', probeOctahedrals['distanceLow'])
		.texture('L.irradianceProbeGrid', probeOctahedrals['irradiance'])
		.texture('L.meanDistProbeGrid', probeOctahedrals['filteredDistance'])
		.uniform('L.probeCounts', probeCount)
		.uniform('L.probeStartPosition', probeOrigin)
		.uniform('L.probeStep', probeStep)
		.uniform('L.lowResolutionDownsampleFactor', lowPrecisionSizeDownsample)

		.draw();

	}

}

function renderProbeLocations(viewProjection) {

	if (probeDrawCall) {

		app.defaultDrawFramebuffer()
		.defaultViewport()
		.depthTest()
		.depthFunc(PicoGL.LEQUAL)
		.noBlend();

		probeDrawCall
		.uniform('u_projection_from_world', viewProjection)
		.draw();

	}

}

function renderEnvironment(inverseViewProjection) {

	if (environmentDrawCall) {

		app.defaultDrawFramebuffer()
		.defaultViewport()
		.depthTest()
		.depthFunc(PicoGL.EQUAL)
		.noBlend();

		environmentDrawCall
		.uniform('u_camera_position', camera.position)
		.uniform('u_world_from_projection', inverseViewProjection)
		.uniform('u_environment_brightness', settings.environment_brightness)
		.draw();

	}

}

/*function precompute() {

	for (var i = 0, len = probeLocations.length; i < len; ++i) {
		precomputeProbe(i)
	}

}*/

function precomputeProbe(index) {

	//
	// Render probe cubemaps
	//

	var location = probeLocations[index];

	var projectionMatrix = mat4.create();
	mat4.perspective(projectionMatrix, Math.PI / 2.0, 1.0, 0.1, 100.0);

	var CUBE_LOOK_DIR = [
		vec3.fromValues(1.0, 0.0, 0.0),
		vec3.fromValues(-1.0, 0.0, 0.0),
		vec3.fromValues(0.0, 1.0, 0.0),
		vec3.fromValues(0.0, -1.0, 0.0),
		vec3.fromValues(0.0, 0.0, 1.0),
		vec3.fromValues(0.0, 0.0, -1.0)
	];

	var CUBE_LOOK_UP = [
		vec3.fromValues(0.0, -1.0, 0.0),
		vec3.fromValues(0.0, -1.0, 0.0),
		vec3.fromValues(0.0, 0.0, 1.0),
		vec3.fromValues(0.0, 0.0, -1.0),
		vec3.fromValues(0.0, -1.0, 0.0),
		vec3.fromValues(0.0, -1.0, 0.0)
	];

	for (var side = 0; side < 6; side++) {

		var viewMatrix = mat4.create();
		var lookPos = vec3.add(vec3.create(), location, CUBE_LOOK_DIR[side]);
		mat4.lookAt(viewMatrix, location, lookPos, CUBE_LOOK_UP[side]);

		var sideTarget = PicoGL.TEXTURE_CUBE_MAP_POSITIVE_X + side;
		probeRenderingFramebuffer.colorTarget(0, probeCubemaps['radiance'], sideTarget);
		probeRenderingFramebuffer.colorTarget(1, probeCubemaps['normals'], sideTarget);
		probeRenderingFramebuffer.colorTarget(2, probeCubemaps['distance'], sideTarget);
		probeRenderingFramebuffer.depthTarget(probeCubemaps['depth'], sideTarget);

		validateFramebuffer(probeRenderingFramebuffer); // NOTE

		// TODO: Fix this shit
		// Create mock camera to be able to get the view space light direction. Probably clean this up some day...
		var matrix3 = mat3.create();
		mat3.fromMat4(matrix3, viewMatrix);
		var quaternion = quat.create();
		quat.fromMat3(quaternion, matrix3);
		quat.conjugate(quaternion, quaternion); // (since the lookat already accounts for the inverse)
		quat.normalize(quaternion, quaternion);
		var cam = { orientation: quaternion, viewMatrix: viewMatrix };

		var dirLightViewDirection = directionalLight.viewSpaceDirection(cam);
		var lightViewProjection = directionalLight.getLightViewProjectionMatrix();
		var shadowMap = shadowMapFramebuffer.depthTexture;

		var spotLightViewPosition = spotLight.viewSpacePosition(cam);
		var spotLightViewDirection = spotLight.viewSpaceDirection(cam);

		app.drawFramebuffer(probeRenderingFramebuffer)
		.viewport(0, 0, probeCubeSize, probeCubeSize)
		.depthTest()
		.depthFunc(PicoGL.LEQUAL)
		.noBlend()
		.clear();

		for (var i = 0, len = meshes.length; i < len; ++i) {

			var mesh = meshes[i];

			mesh.precomputeDrawCall
			.uniform('u_world_from_local', mesh.modelMatrix)
			.uniform('u_view_from_world', viewMatrix)
			.uniform('u_projection_from_view', projectionMatrix)
			.uniform('u_dir_light_color', directionalLight.color)
			.uniform('u_dir_light_view_direction', dirLightViewDirection)
			.uniform('u_light_projection_from_world', lightViewProjection)
			.texture('u_shadow_map', shadowMap)
			.uniform('u_spot_light_color', spotLight.color)
			.uniform('u_spot_light_cone', spotLight.cone)
			.uniform('u_spot_light_view_position', spotLightViewPosition)
			.uniform('u_spot_light_view_direction', spotLightViewDirection)
			.draw();

		}

		var inverseViewProjection = mat4.create();
		mat4.mul(inverseViewProjection, projectionMatrix, viewMatrix);
		mat4.invert(inverseViewProjection, inverseViewProjection);

		if (environmentDrawCall) {

			app.depthFunc(PicoGL.EQUAL);

			// Since we don't use HDR rendering on the main buffer, but sort of here, increase the brightness
			// so that the environment appears brighter in reflections than in the sky (which would be/is saturated)
			var brightness = settings.environment_brightness;// * 1.35; or not..?

			environmentDrawCall
			.uniform('u_camera_position', camera.position)
			.uniform('u_world_from_projection', inverseViewProjection)
			.uniform('u_environment_brightness', brightness)
			.draw();

		}
	}

	// Make sure all cubemaps are fully rendered before using them in the following steps
	// It really shouldn't be needed right, but it sure is.
	app.gl.flush();

	//
	// Project cubemaps to octahedrals
	//

	octahedralFramebuffer.colorTarget(0, probeOctahedrals['distanceHigh'], index);
	octahedralFramebuffer.colorTarget(1, probeOctahedrals['radiance'], index);
	octahedralFramebuffer.colorTarget(2, probeOctahedrals['normals'], index);

	validateFramebuffer(octahedralFramebuffer); // NOTE!

	octahedralFramebufferLow.colorTarget(0, probeOctahedrals['distanceLow'], index);

	validateFramebuffer(octahedralFramebufferLow); // NOTE!

	app.noDepthTest().noBlend();

	octahedralDrawCall
	.texture('u_radiance_cubemap', probeCubemaps['radiance'])
	.texture('u_normals_cubemap', probeCubemaps['normals'])
	.texture('u_distance_cubemap', probeCubemaps['distance']);

	app.drawFramebuffer(octahedralFramebuffer)
	.viewport(0, 0, probeOctahedralSize, probeOctahedralSize);
	octahedralDrawCall.draw();

	app.drawFramebuffer(octahedralFramebufferLow)
	.viewport(0, 0, probeOctahedralSizeLow, probeOctahedralSizeLow);
	octahedralDrawCall.draw();

	//
	// Prefilter irradiance
	//

	if(!irradianceDrawCall) return;

	irradianceFramebuffer.colorTarget(0, probeOctahedrals['irradiance'], index);
	validateFramebuffer(irradianceFramebuffer);

	app.drawFramebuffer(irradianceFramebuffer)
	.viewport(0, 0, irradianceSize, irradianceSize)
	.noDepthTest().noBlend();

	irradianceDrawCall
	.texture('u_radiance_cubemap', probeCubemaps['radiance'])
	.uniform('u_num_samples', settings.irradiance_num_samples)
	.uniform('u_lobe_size', settings.irradiance_lobe_size)
	.draw();

	//
	// Chebychev stuff (filter distances)
	//

	irradianceFramebuffer.colorTarget(0, probeOctahedrals['filteredDistance'], index);
	validateFramebuffer(irradianceFramebuffer);

	app.drawFramebuffer(irradianceFramebuffer)
	.viewport(0, 0, irradianceSize, irradianceSize)
	.noDepthTest().noBlend();

	irradianceDrawCall
	.texture('u_radiance_cubemap', probeCubemaps['distance'])
	.uniform('u_num_samples', settings.irradiance_num_samples)
	.uniform('u_lobe_size', settings.filtered_distance_lobe_size)
	.draw();

}

function renderTextureToScreen(texture, isDepthMap) {

	//
	// NOTE:
	//
	//   This function can be really helpful for debugging!
	//   Just call this whenever and you get the texture on
	//   the screen (just make sure nothing is drawn on top)
	//

	if (!blitTextureDrawCall) {
		return;
	}

	app.defaultDrawFramebuffer()
	.defaultViewport()
	.noDepthTest()
	.noBlend();

	blitTextureDrawCall
	.texture('u_texture', texture)
	.uniform('u_is_depth_map', isDepthMap || false)
	.draw();

}

function renderTextureArrayToScreen(texture, layer, isDepthMap) {

	if (!blitTextureArrayDrawCall) {
		return;
	}

	app.defaultDrawFramebuffer()
	.defaultViewport()
	.noDepthTest()
	.noBlend();

	blitTextureArrayDrawCall
	.texture('u_texture', texture)
	.uniform('u_layer', layer)
	.uniform('u_is_depth_map', isDepthMap || false)
	.draw();

}

function renderCubemapToScreen(cubemap) {

	if (!blitCubemapDrawCall) {
		return;
	}

	app.defaultDrawFramebuffer()
	.defaultViewport()
	.noDepthTest()
	.noBlend();

	blitCubemapDrawCall
	.texture('u_cubemap', cubemap)
	.draw();

}

////////////////////////////////////////////////////////////////////////////////
