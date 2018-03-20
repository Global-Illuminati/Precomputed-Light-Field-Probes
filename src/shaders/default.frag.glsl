#version 300 es
precision highp float;
precision lowp sampler2D;
precision lowp sampler2DArray;

#include <common.glsl>

//
// NOTE: All fragment calculations are in *view space*
//

in vec3 v_position;
in vec3 v_normal;
in vec3 v_tangent;
in vec3 v_bitangent;
in vec2 v_tex_coord;
in vec3 v_world_position;
in vec3 v_world_space_normal;
in vec4 v_light_space_position;

#include <scene_uniforms.glsl>

uniform sampler2D u_diffuse_map;
uniform sampler2D u_specular_map;
uniform sampler2D u_normal_map;
uniform sampler2D u_shadow_map;

uniform vec3 u_dir_light_color;
uniform vec3 u_dir_light_view_direction;

uniform vec3 u_camera_position;

///////////////////////////////////
// GI related

uniform struct LightFieldSurface
{
	sampler2D/*Array*/      radianceProbeGrid;
	sampler2D/*Array*/      normalProbeGrid;
	sampler2D/*Array*/      distanceProbeGrid;
	sampler2D/*Array*/      lowResolutionDistanceProbeGrid;
	Vector3int32            probeCounts; // assumed to be a power of two!
	Point3                  probeStartPosition;
	Vector3                 probeStep;
	int                     lowResolutionDownsampleFactor;
	//TextureCubeArray        irradianceProbeGrid;
	//TextureCubeArray        meanDistProbeGrid;
} L;

#include <light_field_probe_theirs.glsl>

///////////////////////////////////

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
	mapped_normal = unpackNormal(mapped_normal);
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

	//////////////////////////////////////////////////////////
	// indirect light

	// TODO: Consider the specularity and energy conservation, yada yada...
	vec3 fragment_world_space_pos = v_world_position;
	vec3 fragment_world_space_normal = normalize(v_world_space_normal);
	vec3 fragment_to_camera_dir = normalize(u_camera_position - fragment_world_space_pos);
	vec3 indirect_light = compute_glossy_ray(L, fragment_world_space_pos, fragment_to_camera_dir, fragment_world_space_normal);
	color += indirect_light;

	//////////////////////////////////////////////////////////

	o_color = vec4(color, 1.0);

}
