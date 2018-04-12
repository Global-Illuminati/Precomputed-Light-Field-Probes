#version 300 es
precision highp float;

#include <common.glsl>
#include <octahedral.glsl>

in vec2 v_tex_coord;

uniform samplerCube u_radiance_cubemap;
uniform samplerCube u_normals_cubemap;
uniform samplerCube u_distance_cubemap;

layout(location = 0) out vec4 o_distance;
layout(location = 1) out vec4 o_radiance;
layout(location = 2) out vec4 o_normals;

void main()
{
	//vec3 direction = direction_from_spherical(v_tex_coord);
	vec3 direction = octDecode(v_tex_coord * vec2(2.0) - vec2(1.0));

	o_radiance = vec4(texture(u_radiance_cubemap, direction).rgb, 1.0);
	o_distance = vec4(texture(u_distance_cubemap, direction).rg, 0.0, 0.0);

	o_normals = texture(u_normals_cubemap, direction);
}
