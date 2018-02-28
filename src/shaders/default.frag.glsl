#version 300 es
precision highp float;

#include <common.glsl>

//
// NOTE: All fragment calculations are in *view space*
//

in vec3 v_position;
in vec3 v_normal;
in vec3 v_tangent;
in vec3 v_bitangent;
in vec2 v_tex_coord;
in vec4 v_light_space_position;

#include <scene_uniforms.glsl>

uniform sampler2D u_diffuse_map;
uniform sampler2D u_specular_map;
uniform sampler2D u_normal_map;
uniform sampler2D u_shadow_map;

uniform vec3 u_dir_light_color;
uniform vec3 u_dir_light_view_direction;

layout(location = 0) out vec4 o_color;

void main()
{
	vec3 N = normalize(v_normal);
	vec3 T = normalize(v_tangent);
	vec3 B = normalize(v_bitangent);

	// NOTE: We probably don't really need all (or any) of these
	reortogonalize(N, T);
	reortogonalize(N, B);
	reortogonalize(T, B);
	mat3 tbn = mat3(T, B, N);

	// Rotate normal map normals from tangent space to view space (normal mapping)
	vec3 mapped_normal = texture(u_normal_map, v_tex_coord).xyz;
	mapped_normal = normalize(mapped_normal * vec3(2.0) - vec3(1.0));
	N = tbn * mapped_normal;

	vec3 diffuse = texture(u_diffuse_map, v_tex_coord).rgb;
	float shininess = texture(u_specular_map, v_tex_coord).r;

	vec3 wi = normalize(-u_dir_light_view_direction);
	vec3 wo = normalize(-v_position);

	float lambertian = saturate(dot(N, wi));

	//////////////////////////////////////////////////////////
	// ambient
	vec3 color = u_ambient_color.rgb * diffuse;

	//////////////////////////////////////////////////////////
	// directional light

	// shadow visibility
	// TODO: Probably don't hardcode bias
	// TODO: Send in shadow map pixel size as a uniform
	const float bias = 0.0029;
	vec2 texel_size = vec2(1.0) / vec2(textureSize(u_shadow_map, 0));
	vec3 light_space = v_light_space_position.xyz / v_light_space_position.w;
	float visibility = sample_shadow_map_pcf(u_shadow_map, light_space.xy, light_space.z, texel_size, bias);

	if (lambertian > 0.0 && visibility > 0.0)
	{
		vec3 wh = normalize(wi + wo);

		// diffuse
		color += visibility * diffuse * lambertian * u_dir_light_color;

		// specular
		float specular_angle = saturate(dot(N, wh));
		float specular_power = pow(2.0, 13.0 * shininess); // (fake glossiness from the specular map)
		float specular = pow(specular_angle, specular_power);
		color += visibility * shininess * specular * u_dir_light_color;
	}

	// output tangents
	o_color = vec4(color, 1.0);

}
