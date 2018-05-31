
function ShaderLoader(pathPrefix) {

	this.pathPrefix = pathPrefix;
	this.includeRegEx = /#include\s*<([a-zA-Z_][\w|.]*)>/g;

	this.loadCounter = 0;

	this.shaderFiles = [];
	this.shaders = {};

	this.shaderPrograms = [];

}

ShaderLoader.prototype = (function() {

	var makeTextDataRequest = function(path, fileName, callback) {

		fetch(path, { method: 'GET' }).then(function(response) {
			return response.text();
		}).then(function(textData) {
			callback(fileName, textData);
		});
	};

	return {

		constructor: ShaderLoader,

		pathForFileName: function(fileName) {

			return this.pathPrefix + fileName;

		},

		resolveSource: function(source) {

			var matches = this.includeRegEx.exec(source);
			if (matches != null) {

				var includeFileName = matches[1];
				if (this.shaders.hasOwnProperty(includeFileName)) {

					var includedSource = this.resolveSource(this.shaders[includeFileName]);
					var resolved = source.replace(matches[0], includedSource);

					// Recursively resolve until there is nothing more to resolve
					return this.resolveSource(resolved);

				} else {

					console.error('ShaderLoader: shader file trying to include other file ("' + includeFileName +'") not added!');

				}

			} else {

				return source;

			}

		},

		onCompletion: function(onload) {

			var result = {};

			for (var i = 0, len = this.shaderPrograms.length; i < len; ++i) {

				var programInfo = this.shaderPrograms[i];
				var name = programInfo.name;

				var unresolvedVsSource = this.shaders[programInfo.vsFileName];
				var unresolvedFsSource = this.shaders[programInfo.fsFileName];

				var vsSource = this.resolveSource(unresolvedVsSource);
				var fsSource = this.resolveSource(unresolvedFsSource);

				result[name] = {
					vertexSource: vsSource,
					fragmentSource: fsSource
				};

			}

			// Empty array of shader programs and the list of shaders to load, but keep the already loaded shaders
			this.shaderPrograms = [];
			this.shaderFiles = [];

			onload(result);

		},

		addShaderFile: function(fileName) {

			// If the file is not already queued for loading and isn't already loaded, queue it
			if (!this.shaderFiles.includes(fileName) && !this.shaders.hasOwnProperty(fileName)) {

				this.shaderFiles.push(fileName);
				this.loadCounter += 1;

			}

		},

		addShaderProgram: function(name, vsFileName, fsFileName) {

			this.addShaderFile(vsFileName);
			this.addShaderFile(fsFileName);

			this.shaderPrograms.push({
				name: name,
				vsFileName: vsFileName,
				fsFileName: fsFileName
			});

		},

		load: function(onload) {

			// In case there is nothing to load but programs can be assembled from what is already loaded.
			// E.g.:
			//   loader.addShaderFile('fileA');
			//   loader.addShaderFile('fileB');
			//   loader.load(...)
			//   loader.addShaderProgram('program', 'fileA', 'fileB');
			// * loader.load(...)
			//
			// The last load call should still return the program!
			//
			if (this.loadCounter === 0) {
				this.onCompletion(onload);
				return;
			}

			var scope = this;

			for (var i = 0, len = this.shaderFiles.length; i < len; ++i) {

				var fileName = this.shaderFiles[i];
				var path = this.pathForFileName(fileName);

				makeTextDataRequest(path, fileName, function(file, source) {

					scope.shaders[file] = source;
					scope.loadCounter -= 1;

					if (scope.loadCounter === 0) {
						scope.onCompletion(onload);
					}

				});

			}

		}

	};

})();
