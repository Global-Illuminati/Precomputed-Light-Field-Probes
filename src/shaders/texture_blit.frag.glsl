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

		// Well, not really a depth map but a linear distance map
		float val = o_color.r;
		float remapped = val / (val + 1.0);
		o_color.rgb = vec3(pow(abs(remapped), 25.0));

		// Actually a depth map:
		//o_color.rgb = vec3(pow(abs(o_color.r), 25.0));
	}
}
