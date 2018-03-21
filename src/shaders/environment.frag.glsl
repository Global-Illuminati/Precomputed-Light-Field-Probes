#version 300 es
precision highp float;

#include <common.glsl>

in vec2 v_tex_coord;

uniform sampler2D u_environment_map;

uniform float u_environment_brightness;
uniform mat4 u_world_from_projection;
uniform vec3 u_camera_position;

layout(location = 0) out vec4 o_color;

void main()
{
	// Project the fragment to world space
	vec4 fragment_projected_pos = vec4(v_tex_coord * vec2(2.0) - vec2(1.0), 1.0, 1.0);
	vec4 fragment_world_pos = u_world_from_projection * fragment_projected_pos;
	fragment_world_pos.xyz /= fragment_world_pos.w;

	vec3 direction = normalize(fragment_world_pos.xyz - u_camera_position);

	vec2 uv = spherical_from_direction(direction);
	vec3 color = texture(u_environment_map, uv).rgb;
	color *= u_environment_brightness;

	// NOTE: This will be clamped to 1.0 for normal framebuffers, but for the float distance texture that is used for
	// the precompute step this will actually be 10000.0 which is the effectively inifinitely far away.
	o_color = vec4(color, 10000.0);

}
