
function Camera(position, orientation) {

	this.position = position || vec3.create();
	this.orientation = orientation || quat.create();

	this.near = 0.01;
	this.far = 1000.0;
	this.fovDegrees = 50.5;

	this.viewMatrix = mat4.create();
	this.projectionMatrix = mat4.create();

	this.updateViewMatrix();
	this.updateProjectionMatrix();

	this.onViewMatrixChange = null;
	this.onProjectionMatrixChange = null;

	//

	this.moveSpeed = 0.05;
	this.rotationSpeed = 0.007;

	//

	this.controlsEnabled = false;

	this.currentMousePos = vec2.create();
	this.lastMousePos = null;

	this.keys = {
		w: 0, up: 0,
		s: 0, down: 0,
		a: 0, left: 0,
		d: 0, right: 0,
		space: 0, shift: 0,
		q: 0, e: 0
	};

	function setKeyState(map, keyCode, val) {

		if      (keyCode === 87) map['w'] = val;
		else if (keyCode === 38) map['up'] = val;

		else if (keyCode === 83) map['s'] = val;
		else if (keyCode === 40) map['down'] = val;

		else if (keyCode === 65) map['a'] = val;
		else if (keyCode === 37) map['left'] = val;

		else if (keyCode === 68) map['d'] = val;
		else if (keyCode === 39) map['right'] = val;

		else if (keyCode === 32) map['space'] = val;
		else if (keyCode === 16) map['shift'] = val;

		else if (keyCode === 81) map['q'] = val;
		else if (keyCode === 69) map['e'] = val;

	}

	var scope = this;

	window.addEventListener('keydown', function(e) {

		setKeyState(scope.keys, e.keyCode, 1);

		if (e.keyCode === 27 /* escape */) {
			scope.controlsEnabled = false;
		}

		else if (e.keyCode === 17 /* ctrl */) {
			scope.controlsEnabled = true;
			scope.lastMousePos = null;
		}

	});

	window.addEventListener('keyup', function(e) {

		setKeyState(scope.keys, e.keyCode, 0);

	});

	window.addEventListener('mousemove', function(e) {

		scope.currentMousePos[0] = e.screenX;
		scope.currentMousePos[1] = e.screenY;

	});

}

Camera.prototype = {

	constructor: Camera,

	resize: function(width, height) {

		var aspectRatio = width / height;
		this.updateProjectionMatrix(aspectRatio);

	},

	updateProjectionMatrix: function(aspectRatio) {

		var fovy = this.fovDegrees / 180.0 * Math.PI;
		mat4.perspective(this.projectionMatrix, fovy, aspectRatio, this.near, this.far);

		if (this.onProjectionMatrixChange) {
			this.onProjectionMatrixChange(this.projectionMatrix);
		}

	},

	updateViewMatrix: function() {

		mat4.fromRotationTranslation(this.viewMatrix, this.orientation, this.position);
		mat4.invert(this.viewMatrix, this.viewMatrix);

		if (this.onViewMatrixChange) {
			this.onViewMatrixChange(this.viewMatrix);
		}

	},

	update: function() {

		if (!this.controlsEnabled) {
			return;
		}

		if (this.lastMousePos === null) {
			this.lastMousePos = vec2.copy(vec2.create(), this.currentMousePos);
		}

		var didChange = false;

		// Translation
		{
			var keys = this.keys;
			var translation = vec3.fromValues(
				Math.sign(keys['d'] + keys['right'] - keys['a'] - keys['left']),
				Math.sign(keys['space'] - keys['shift']),
				Math.sign(keys['s'] + keys['down'] - keys['w'] - keys['up'])
			);

			if (translation[0] != 0 || translation[1] != 0 || translation[2] != 0) {

				vec3.normalize(translation, translation);
				vec3.scale(translation, translation, this.moveSpeed);

				vec3.transformQuat(translation, translation, this.orientation);
				vec3.add(this.position, this.position, translation);

				didChange = true;

			}
		}

		// Rotation
		{
			var dx = this.currentMousePos[0] - this.lastMousePos[0];
			var dy = this.currentMousePos[1] - this.lastMousePos[1];
			var dz = this.keys['e'] - this.keys['q'];

			if (dx != 0 || dy != 0 || dz != 0) {

				// Rotate around global up (0, 1, 0)
				var yRot = quat.create();
				quat.rotateY(yRot, yRot, -dx * this.rotationSpeed);

				// Rotate around local right-axis
				var rightAxis = vec3.fromValues(1, 0, 0);
				vec3.transformQuat(rightAxis, rightAxis, this.orientation);
				var xRot = quat.create();
				quat.setAxisAngle(xRot, rightAxis, -dy * this.rotationSpeed);

				// Rotate around local forward-axis
				var forwardAxis = vec3.fromValues(0, 0, -1);
				vec3.transformQuat(forwardAxis, forwardAxis, this.orientation);
				var zRot = quat.create();
				quat.setAxisAngle(zRot, forwardAxis, dz * this.rotationSpeed * 2.0);

				// Apply rotation
				quat.multiply(this.orientation, yRot, this.orientation);
				quat.multiply(this.orientation, xRot, this.orientation);
				quat.multiply(this.orientation, zRot, this.orientation);

				// current mouse pos -> last mouse pos
				vec2.copy(this.lastMousePos, this.currentMousePos);

				didChange = true;

			}
		}

		if (didChange) {
			this.updateViewMatrix();
		}

	}

};
