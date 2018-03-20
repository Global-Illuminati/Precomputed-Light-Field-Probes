#ifndef COMMON_GLSL
#define COMMON_GLSL

#define PI     (3.14159265358979323846)
#define TWO_PI (2.0 * PI)

float saturate(in float value) {
	return clamp(value, 0.0, 1.0);
}

float squaredLength(in vec2 v)
{
	return dot(v, v);
}

float squaredLength(in vec3 v)
{
	return dot(v, v);
}

void reortogonalize(in vec3 v0, inout vec3 v1)
{
	// Perform Gram-Schmidt's re-ortogonalization process to make v1 orthagonal to v1
	v1 = normalize(v1 - dot(v1, v0) * v0);
}

vec3 packNormal(vec3 N)
{
	return N * vec3(0.5) + vec3(0.5);
}

vec3 unpackNormal(vec3 packedNormal)
{
	return normalize(packedNormal * vec3(2.0) - vec3(1.0));
}

vec2 spherical_from_direction(vec3 direction)
{
	highp float theta = acos(clamp(direction.y, -1.0, 1.0));
	highp float phi = atan(direction.z, direction.x);
	if (phi < 0.0) phi += TWO_PI;

	return vec2(phi / TWO_PI, theta / PI);
}

vec3 direction_from_spherical(vec2 uv)
{
	float phi = uv.x * TWO_PI;
	float theta = uv.y * PI;

	return vec3(
		sin(phi) * sin(theta) * -1.0,
		cos(theta) * -1.0,
		cos(phi) * sin(theta) * -1.0
	);
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

struct Ray
{
	vec3 origin;
	vec3 direction;
};

Ray makeRay(in vec3 origin, in vec3 direction)
{
	Ray ray;
	ray.origin = origin;
	ray.direction = normalize(direction);
	return ray;
}

///////////////////////////////////
// Compability definitions (needed for the probe code)

#define Point2  vec2
#define Point3  vec3

#define Vector2 vec2
#define Vector3 vec3

// NOTE: We need this to be 32 bits to be able to findMSB
//precision highp ivec3;
#define Vector3int32 highp ivec3

// Not defined until GLSL 400
// https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/findMSB.xhtml
int findMSB(highp int val)
{
	if (val == 0 || val == -1) return -1;

	// For negative integers, set the sign bit to zero so we can use the same method for all numbers and not always get
	// bit 32 as the MSB for all negative numbers.
	// NOTE: It is 32 bits right?!
	if (val < 0) {
		val &= ~(1 << 31);
	}

	int pos = 0;
	while (val != 0) {
		pos += 1;
		val = val >> 1;
	}
	return pos;
}

#endif // COMMON_GLSL
