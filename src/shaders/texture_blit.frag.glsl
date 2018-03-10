#version 300 es
precision highp float;

in vec2 v_tex_coord;

uniform sampler2D u_texture;
uniform bool u_is_depth_map;

layout(location = 0) out vec4 o_color;

void main()
{
	o_color = texture(u_texture, v_tex_coord);

	if (u_is_depth_map) {
		o_color.rgb = vec3(pow(o_color.r, 25.0));
	}
}
