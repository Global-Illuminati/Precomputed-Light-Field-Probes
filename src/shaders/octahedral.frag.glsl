#version 300 es
precision highp float;

#include <common.glsl>
#include <octahedral.glsl>

in vec2 v_tex_coord;

uniform samplerCube u_radiance_distance_cubemap;
uniform samplerCube u_normals_cubemap;

layout(location = 0) out vec4 o_radiance;
layout(location = 1) out vec4 o_distance;
layout(location = 2) out vec4 o_normals;

void main()
{
	vec3 direction = octDecode(v_tex_coord * vec2(2.0) - vec2(1.0));

	vec4 radiance_distance = texture(u_radiance_distance_cubemap, direction);
	o_radiance = vec4(radiance_distance.rgb, 1.0);

	// TODO: Remove this scaling!!! Also, think about if we want the no-hit-clear-distance to be 0 or 1!
	//radiance_distance.a = radiance_distance.a / (radiance_distance.a + 1.0);
	o_distance = vec4(vec3(radiance_distance.a), 1.0);

	o_normals = texture(u_normals_cubemap, direction);
}
