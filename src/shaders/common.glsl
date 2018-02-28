#ifndef COMMON_GLSL
#define COMMON_GLSL

#define PI     (3.14159265358979323846)
#define TWO_PI (2.0 * PI)

float saturate(in float value) {
	return clamp(value, 0.0, 1.0);
}

void reortogonalize(in vec3 v0, inout vec3 v1)
{
	// Perform Gram-Schmidt's re-ortogonalization process to make v1 orthagonal to v1
	v1 = normalize(v1 - dot(v1, v0) * v0);
}

vec2 spherical_from_direction(vec3 direction)
{
	highp float theta = acos(clamp(direction.y, -1.0, 1.0));
	highp float phi = atan(direction.z, direction.x);
	if (phi < 0.0) phi += TWO_PI;

	return vec2(phi / TWO_PI, theta / PI);
}

float sample_shadow_map(in sampler2D shadow_map, in vec2 uv, in float comparison_depth, in float bias)
{
	float shadow_map_depth = texture(shadow_map, uv).r;
	return step(comparison_depth, shadow_map_depth + bias);
}

float sample_shadow_map_pcf(in sampler2D shadow_map, in vec2 uv, in float comparison_depth, vec2 texel_size, in float bias)
{
	float tx = texel_size.x;
	float ty = texel_size.y;

	float visibility = 0.0;

	//
	// TODO: Do we need a big 9x9 PCF? Maybe smaller is sufficient?
	//

	visibility += sample_shadow_map(shadow_map, uv + vec2(-tx, -ty), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(-tx,   0), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(-tx, +ty), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(  0, -ty), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(  0,   0), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(  0, +ty), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(+tx, -ty), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(+tx,   0), comparison_depth, bias);
	visibility += sample_shadow_map(shadow_map, uv + vec2(+tx, +ty), comparison_depth, bias);

	return visibility / 9.0;

}

#endif // COMMON_GLSL
