#version 300 es
precision highp int;
precision highp float;
precision highp sampler2DArray;

in vec2 v_tex_coord;

uniform sampler2DArray u_texture;
uniform int  u_layer;
uniform bool u_is_depth_map;

layout(location = 0) out vec4 o_color;

void main()
{
	o_color = texture(u_texture, vec3(v_tex_coord, float(u_layer)));

	if (u_is_depth_map) {

		// Well, not really a depth map but a linear distance map
		float val = o_color.r;
		float remapped = val / (val + 1.0);
		o_color.rgb = vec3(pow(abs(remapped), 15.0));

		// Actually a depth map:
		//o_color.rgb = vec3(pow(abs(o_color.r), 25.0));
	}
}
