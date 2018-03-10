#version 300 es
precision highp float;

#include <common.glsl>
#include <octahedral.glsl>

in vec2 v_tex_coord;

uniform samplerCube u_radianceCubemap;
uniform samplerCube u_depthCubemap;
uniform samplerCube u_normalsCubemap;

layout(location = 0) out vec4 o_radiance;
layout(location = 1) out vec4 o_distance;
layout(location = 2) out vec4 o_normals;

void main()
{
	vec3 direction = octDecode(v_tex_coord * vec2(2.0) - vec2(1.0));

	o_radiance = texture(u_radianceCubemap, direction);
	o_distance = texture(u_depthCubemap, direction);
	o_normals = texture(u_normalsCubemap, direction);
}
