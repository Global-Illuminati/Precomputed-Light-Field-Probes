# Precomputed Light Field Probes

This is a WebGL 2.0 implementation of the paper ["Real-Time Global Illumination using Precomputed Light Field Probes"](http://research.nvidia.com/publication/real-time-global-illumination-using-precomputed-light-field-probes).

The code is based off of [our core framework](https://github.com/Global-Illuminati/CoreFramework/) and there further information regarding dependencies etc. can be found.

## Controls

First-person WASD controls, plus Q and E for rolling. Press ctrl to take control of the camera and escape to release control. Force a new precompute sequence by pressing *P*. Rotate the directional light using up and down arrow keys, preferrably when not in control of the camera.

## Glossy and diffuse indirect light

The paper details a probe based ray-tracing technique that allows for glossy reflections. For diffuse indirect light three different techniques are proposed (of which two of them are plausible). Since we want to achieve real-time performance we implemented the third proposed technique, “Irradiance with (Pre-)Filtered Visibility” detailed in section 5.2 of the original paper.

While we based our implementation off of their supplemental code we had to do a lot of manual rewriting to be compatible down to the GLSL version supported in WebGL 2.0 (version 300 es). We never managed to achieve great results with the glossy reflections, and since it is much slower and requires much more memory to use we have several branches that only contain code for the diffuse indirect light.

## Branches

The different branches in this repository contain slightly different variations of the technique and with different scenes.

[diffuse-living-room](https://github.com/Global-Illuminati/Precomputed-Light-Field-Probes/tree/diffuse-living-room) branch has only diffuse indirect light and is adjusted for a living room scene.

[diffuse-sponza](https://github.com/Global-Illuminati/Precomputed-Light-Field-Probes/tree/diffuse-sponza) branch has only diffuse indirect light and is adjusted for the sponza scene.

[sponza-with-reflections](https://github.com/Global-Illuminati/Precomputed-Light-Field-Probes/tree/sponza-with-reflections) implements the full technique with both diffuse and glossy indirect light, adjusted for the sponza scene. This is quite expensive to run for a weaker computer.

The [master](https://github.com/Global-Illuminati/Precomputed-Light-Field-Probes/tree/master) branch is identical to the diffuse-living-room branch and is used for providing a GitHub page as a demo.

## License

Copyright 2018 Marcus Bertilsson, Hannes von Essen, Daniel Hesslow, Niklas Jonsson, Simon Moos, Olle Persson

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
