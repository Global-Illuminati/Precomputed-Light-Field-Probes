#version 300 es
precision highp float;

#include <common.glsl>

in vec2 v_tex_coord;

uniform samplerCube u_cubemap;

layout(location = 0) out vec4 o_color;

void main()
{
	vec3 direction = direction_from_spherical(v_tex_coord);

	// For showing a single face of the cubemap
	//float u = v_tex_coord.x * 2.0 - 1.0;
	//float v = v_tex_coord.y * 2.0 - 1.0;
	//vec3 direction = vec3(u, 1.0, v);

	o_color = texture(u_cubemap, direction);

	// For enhancing details in a depth map
	//o_color.rgb = vec3(pow(abs(o_color.r), 25.0));
}
