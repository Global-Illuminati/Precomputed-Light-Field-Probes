#version 300 es
precision highp float;

#include <common.glsl>
#include <octahedral.glsl>

in vec2 v_tex_coord;

uniform samplerCube u_cubemap;

layout(location = 0) out vec4 o_color;

void main()
{
	vec3 direction = octDecode(v_tex_coord);

	o_color = texture(u_cubemap, direction);

	// For enhancing details in a depth map
	//o_color.rgb = vec3(pow(o_color.r, 25.0));
}
