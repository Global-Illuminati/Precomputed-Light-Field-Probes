
function SpotLight(position, direction, coneAngle, color) {

	this.position = position || vec3.fromValues(0, 2, 0);
	this.direction = direction || vec3.fromValues(0.3, -0.3, 0.3);
	vec3.normalize(this.direction, this.direction);

	this.color = color || new Float32Array([1.5, 1.5, 1.5]);

	//

	this.cone = glMatrix.toRadian(coneAngle || 20.0);

	this.lightViewMatrix = mat4.create();
	this.lightProjectionMatrix = mat4.create();
	this.lightViewProjection = mat4.create();

}

SpotLight.prototype = {

	constructor: SpotLight,

	viewSpaceDirection: function(camera) {

		var inverseRotation = quat.conjugate(quat.create(), camera.orientation);

		var result = vec3.create();
		vec3.transformQuat(result, this.direction, inverseRotation);

		return result;

	},

	viewSpacePosition: function(camera) {

		var result = vec3.transformMat4(vec3.create(), this.position, camera.viewMatrix);
		return result;

	},

	getLightViewMatrix: function() {

		var lookatPoint = vec3.add(vec3.create(), this.position, this.direction);
		var up          = vec3.fromValues(0, 1, 0);
		mat4.lookAt(this.lightViewMatrix, position, lookatPoint, up);

		return this.lightViewMatrix;

	},

	getLightProjectionMatrix: function() {

		var fov = cone / 2.0;
		var near = 0.2;
		var far = 100.0;
		mat4.perspective(this.lightProjectionMatrix, fov, 1.0, near, far);

		return this.lightProjectionMatrix;

	},

	getLightViewProjectionMatrix: function () {

		var lightViewMatrix = this.getLightViewMatrix();
		var lightProjMatrix = this.getLightProjectionMatrix();
		mat4.multiply(this.lightViewProjection, lightProjMatrix, lightViewMatrix);

		return this.lightViewProjection;

	}

};