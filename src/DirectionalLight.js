
function DirectionalLight(direction, color) {

	this.direction = direction || vec3.fromValues(0.3, -1.0, 0.3);
	vec3.normalize(this.direction, this.direction);

	this.color = color || new Float32Array([1.0, 1.0, 1.0]);

	//

	this.orthoProjectionSize = 120.0;

	this.lightViewMatrix = mat4.create();
	this.lightProjectionMatrix = mat4.create();
	this.lightViewProjection = mat4.create();

}

DirectionalLight.prototype = {

	constructor: DirectionalLight,

	viewSpaceDirection: function(camera) {

		var inverseRotation = quat.conjugate(quat.create(), camera.orientation);

		var result = vec3.create();
		vec3.transformQuat(result, this.direction, inverseRotation);

		return result;

	},

	getLightViewMatrix: function() {

		// Calculate as a look-at matrix from center to the direction (interpreted as a point)
		var eyePosition = vec3.fromValues(0, 0, 0);
		var up          = vec3.fromValues(0, 1, 0);

		mat4.lookAt(this.lightViewMatrix, eyePosition, this.direction, up);

		return this.lightViewMatrix;

	},

	getLightProjectionMatrix: function() {

		var size = this.orthoProjectionSize / 2.0;
		mat4.ortho(this.lightProjectionMatrix, -size, size, -size, size, -size, size);

		return this.lightProjectionMatrix;

	},

	getLightViewProjectionMatrix: function () {

		var lightViewMatrix = this.getLightViewMatrix();
		var lightProjMatrix = this.getLightProjectionMatrix();
		mat4.multiply(this.lightViewProjection, lightProjMatrix, lightViewMatrix);

		return this.lightViewProjection;

	}

};