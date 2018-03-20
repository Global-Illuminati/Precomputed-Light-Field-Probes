#ifndef LIGHT_FIELD_PROBE_GLSL
#define LIGHT_FIELD_PROBE_GLSL

#include <common.glsl>
#include <octahedral.glsl>

//
// NOTE:
//
// Some of the code in this file is taken more or less directly from the supplemental code from the paper that inspired
// this work. The code and research can be found at:
//
//     http://research.nvidia.com/publication/real-time-global-illumination-using-precomputed-light-field-probes
//

///////////////////////////////////////////////////////////////////////////////
// Settings etc.

// Points exactly on the boundary in octahedral space (x = 0 and y = 0 planes) map to two different
// locations in octahedral space. We shorten the segments slightly to give unambigous locations that lead
// to intervals that lie within an octant.
const float ray_bump_epsilon = 0.001; // meters

///////////////////////////////////////////////////////////////////////////////
// Ray stuff

struct Ray
{
	vec3 origin;
	vec3 direction;
};

Ray make_ray(in vec3 origin, in vec3 direction)
{
	Ray ray;
	ray.origin = origin;
	ray.direction = normalize(direction);
	return ray;
}

///////////////////////////////////////////////////////////////////////////////
// Light field surface definitions and helpers

#define TraceResult int
#define TRACE_RESULT_MISS    0
#define TRACE_RESULT_HIT     1
#define TRACE_RESULT_UNKNOWN 2

struct LightFieldSurface
{
	sampler2D      radiance_probe;
	sampler2D      normals_probe;
	sampler2D      distance_probe;
	sampler2D      low_res_distance_probe;

	int            low_res_downsample_factor;
};

vec3 probe_location(in LightFieldSurface L, int probe_index)
{
	// TODO: Actually implement!

	if (probe_index == 0)
	{
		return vec3(-10.0, 4.0, 0.0);
	}
}



/**
 * Two-element sort: maybe swaps a and b so that a' = min(a, b), b' = max(a, b).
 */
void min_swap(inout float a, inout float b) {
	float temp = min(a, b);
	b = max(a, b);
	a = temp;
}

/**
 * Sort the three values in v from least to greatest using an exchange network (i.e., no branches)
 */
void sort(inout vec3 v) {
	minSwap(v.x, v.y);
	minSwap(v.y, v.z);
	minSwap(v.x, v.y);
}

/**
 *
 * Segments a ray into the piecewise-continuous rays or line segments that each lie within
 * one Euclidean octant, which correspond to piecewise-linear projections in octahedral space.
 *
 *  - boundary_Ts: all boundary distance ("time") values in units of world-space distance
 *    along the ray. In the (common) case where not all five elements are needed, the unused
 *    values are all equal to t_max, creating degenerate ray segments.
 *
 *  - origin: Ray origin in the Euclidean object space of the probe
 *  - directionFrac: 1.0 / ray.direction
 *
 */
void compute_ray_segments(vec3 origin, vec3 direction_frac, float t_min, float t_max, out float boundary_Ts[5])
{
	boundary_Ts[0] = t_min;
	boundary_Ts[4] = t_max;

	// Time values for intersection with x = 0, y = 0, and z = 0 planes, sorted in increasing order
	vec3 t = origin * -direction_frac;
	sort(t);

	// Copy the values into the interval boundaries. (This loop expands at compile time and eliminates
	// the relative indexing, so it is just three conditional move operations)
	for (int i = 0; i < 3; ++i)
	{
		boundary_Ts[i + 1] = clamp(t[i], t_min, t_max);
	}
}

/**
 *
 * Returns the distance along v from the origin to the intersection
 * with ray R (which it is assumed to intersect)
 *
 */
float distance_to_intersection(in Ray R, in vec3 v)
{
    float numer;
    float denom = v.y * R.direction.z - v.z * R.direction.y;

    if (abs(denom) > 0.1) {
        numer = R.origin.y * R.direction.z - R.origin.z * R.direction.y;
    } else {
        // We're in the yz plane; use another one
        numer = R.origin.x * R.direction.y - R.origin.y * R.direction.x;
        denom = v.x * R.direction.y - v.y * R.direction.x;
    }

    return numer / denom;
}

///////////////////////////////////////////////////////////////////////////////
// Light field ray tracing

TraceResult high_resolution_trace_one_segment(
	LightFieldSurface L,
	Ray probe_space_ray,
	vec2 start_tex_coord,
	vec2 end_tex_coord,
	inout float t_min,
	inout float t_max,
	inout vec2 hit_tex_coord)
{
	// TODO! (also make sure the arguments are correct)
}

bool low_resolution_trace_one_segment(
	LightFieldSurface L,
	Ray probe_space_ray,
	inout vec2 tex_coord,
	vec2 segment_end_tex_coord,
	inout vec2 end_high_res_tex_coord)
{
	vec2 low_res_size     = textureSize(L.low_res_distance_probe);
	vec2 low_res_inv_size = vec2(1.0) / low_res_size;

	// Convert the texels to pixel coordinates:
	vec2 P0 = tex_coord * low_res_size;
	vec2 P1 = segment_end_tex_coord * low_res_size;

	// If the line is degenerate, make it cover at least one pixel
	// to avoid handling zero-pixel extent as a special case later
	P1 += vec2((distanceSquared(P0, P1) < 0.0001) ? 0.01 : 0.0);
	// In pixel coordinates
	vec2 delta = P1 - P0;

	// Permute so that the primary iteration is in x to reduce large branches later
	bool permute = false;
	if (abs(delta.x) < abs(delta.y))
	{
		// This is a more-vertical line
		permute = true;
		delta = delta.yx; P0 = P0.yx; P1 = P1.yx;
	}

	float step_dir = sign(delta.x);
	float invdx = step_dir / delta.x;
	vec2  dP = vec2(step_dir, delta.y * invdx);

	vec3 initial_direction_from_probe = octDecode(tex_coord * vec2(2.0) - vec2(1.0));
	float prev_radial_dist_max_estimate = max(0.0, distance_to_intersection(probe_space_ray, initial_direction_from_probe));
	// Slide P from P0 to P1
	float end = P1.x * step_dir;

	float absInvdPY = 1.0 / abs(dP.y);

	// Don't ever move farther from texCoord than this distance, in texture space,
	// because you'll move past the end of the segment and into a different projection
	float maxTexCoordDistance = lengthSquared(segmentEndTexCoord - texCoord);

	for (Point2 P = P0; ((P.x * sign(delta.x)) <= end); ) {

		Point2 hitPixel = permute ? P.yx : P;

		float sceneRadialDistMin = texelFetch(lightFieldSurface.lowResolutionDistanceProbeGrid.sampler, int3(hitPixel, probeIndex), 0).r;

		// Distance along each axis to the edge of the low-res texel
		Vector2 intersectionPixelDistance = (sign(delta) * 0.5 + 0.5) - sign(delta) * frac(P);

		// abs(dP.x) is 1.0, so we skip that division
		// If we are parallel to the minor axis, the second parameter will be inf, which is fine
		float rayDistanceToNextPixelEdge = min(intersectionPixelDistance.x, intersectionPixelDistance.y * absInvdPY);

		// The exit coordinate for the ray (this may be *past* the end of the segment, but the
		// callr will handle that)
		endHighResTexCoord = (P + dP * rayDistanceToNextPixelEdge) * lowResInvSize;
		endHighResTexCoord = permute ? endHighResTexCoord.yx : endHighResTexCoord;

		if (lengthSquared(endHighResTexCoord - texCoord) > maxTexCoordDistance) {
				// Clamp the ray to the segment, because if we cross a segment boundary in oct space
				// then we bend the ray in probe and world space.
				endHighResTexCoord = segmentEndTexCoord;
		}

		// Find the 3D point *on the trace ray* that corresponds to the tex coord.
		// This is the intersection of the ray out of the probe origin with the trace ray.
		Vector3 directionFromProbe = octDecode(endHighResTexCoord * 2.0 - 1.0);
		float distanceFromProbeToRay = max(0.0, distanceToIntersection(probeSpaceRay, directionFromProbe));

		float maxRadialRayDistance = max(distanceFromProbeToRay, prevRadialDistMaxEstimate);
		prevRadialDistMaxEstimate = distanceFromProbeToRay;

		if (sceneRadialDistMin < maxRadialRayDistance) {
				// A conservative hit.
				//
				//  -  endHighResTexCoord is already where the ray would have LEFT the texel
				//     that created the hit.
				//
				//  -  texCoord should be where the ray entered the texel
				texCoord = (permute ? P.yx : P) * lowResInvSize;
				return true;
		}

		// Ensure that we step just past the boundary, so that we're slightly inside the next
		// texel, rather than at the boundary and randomly rounding one way or the other.
		const float epsilon = 0.001; // pixels
		P += dP * (rayDistanceToNextPixelEdge + epsilon);
	} // for each pixel on ray

	// If exited the loop, then we went *past* the end of the segment, so back up to it (in practice, this is ignored
	// by the caller because it indicates a miss for the whole segment)
	texCoord = segmentEndTexCoord;

	return false;
}

TraceResult trace_one_ray_segment(
	LightFieldSurface L,
	Ray probe_space_ray,
	float t0,
	float t1,
	inout float t_min, // out only (well, says so in the original file..?)
	inout float t_max,
	out vec2  hit_tex_coord)
{
	// Euclidean probe-space line segment
	vec3 probe_space_start_point = probe_space_ray.origin + probe_space_ray.direction * (t0 + ray_bump_epsilon);
	vec3 probe_space_end_point   = probe_space_ray.origin + probe_space_ray.direction * (t1 - ray_bump_epsilon);

	// If the original ray origin is really close to the probe origin, then probeSpaceStartPoint will be close to zero
	// and we get NaN when we normalize it. One common case where this can happen is when the camera is at the probe
	// center. (The end point is also potentially problematic, but the chances of the end landing exactly on a probe
	// are relatively low.) We only need the *direction* to the start point, and using probeSpaceRay.direction
	// is safe in that case.
	if (squaredLength(probe_space_start_point) < 0.001) {
		probe_space_start_point = probe_space_ray.direction;
	}

	// Corresponding octahedral ([-1, +1]^2) space line segment.
	// Because the points are in probe space, we don't have to subtract off the probe's origin
	vec2 start_oct_coord = octEncode(normalize(probe_space_start_point));
	vec2 end_oct_coord   = octEncode(normalize(probe_space_end_point));

	// Texture coordinates on [0, 1]
	vec2 tex_coord             = start_oct_coord * 0.5 + 0.5;
	vec2 segment_end_tex_coord = end_oct_coord   * 0.5 + 0.5;

	while (true)
	{
		vec2 end_tex_coord;

		vec2 original_start_coord = tex_coord;
		if (!low_resolution_trace_one_segment(L, probe_space_ray, tex_coord, segment_end_tex_coord, end_tex_coord))
		{
			// The low-resolution trace didn't hit anything
			return TRACE_RESULT_MISS;
		}
		else
		{
			// The low-res trace already guaranted that endTexCoord is no farther along the ray than segment_end_tex_coord
			// if this point is reached, so we don't need to clamp to the segment length
			TraceResult result = high_resolution_trace_one_segment(L, probe_space_ray, tex_coord, end_tex_coord, t_min, t_max, hit_tex_coord);
			if (result != TRACE_RESULT_MISS)
			{
				// High-resolution either hit or went behind something, which must be the result for the whole segment trace
				return result;
			}
		}

		// We didn't hit anything (or got a unknown) this time, so step past the processed texels and continue from there

		vec2 current_to_end = segment_end_tex_coord - tex_coord;
		vec2 tex_coord_ray_direction = normalize(current_to_end);
		vec2 texel_size = vec2(1.0) / textureSize(L.distance_probe, 0);

		if (dot(tex_coord_ray_direction, current_to_end) <= texel_size.x)
		{
			// The high resolution trace reached the end of the segment; we've failed to find a hit
			return TRACE_RESULT_MISS;
		}
		else
		{
			// We made it to the end of the low-resolution texel using the high-resolution trace, so that's
			// the starting point for the next low-resolution trace. Bump the ray to guarantee that we advance
			// instead of getting stuck back on the low-res texel we just verified...but, if that fails on the
			// very first texel, we'll want to restart the high-res trace exactly where we left off, so
			// don't bump by an entire high-res texel
			tex_coord = end_tex_coord + tex_coord_ray_direction * texel_size.x * 0.1;
		}
	}

	// Reached the end of the segment, and this ray segment definitely missed
	return TRACE_RESULT_MISS;
}

/**
 *
 * Trace a world space ray agains a specific probe.
 *
 *  - t_max: On call, the stop distance for the trace. On return, the distance to the new hit, if one was found. Always finite.
 *  - t_min: On call, the start distance for the trace. On return, the start distance of the ray right before the first "unknown" step.
 *
 */
TraceResult trace_one_probe_oct(
	LightFieldSurface L,
	Ray world_space_ray,
	inout float t_min,
	inout float t_max,
	out vec2 hit_tex_coord)
{
	const float degenerate_epsilon = 0.001; // meters

	// TODO: Take in index parameter! (instead of using 0)
	vec3 probe_origin = probe_location(L, 0);

	Ray probe_space_ray;
	probe_space_ray.origin = world_space_ray.origin - probe_origin;
	probe_space_ray.direction = world_space_ray.direction;

	// Compute the boundary points when projecting onto the octahedral map (max 4 of them,
	// so 5 boundaries including t_min and t_max and the XYZ-plane intersections)
	float boundary_Ts[5];
	compute_ray_segments(probe_space_ray.origin, vec3(1.0) / probe_space_ray.direction, t_min, t_max, boundary_Ts);

	// for each open interval (t[i], t[i + 1])...
	for (int i = 0; i < 4; ++i)
	{
		// ...that is not degenerate
		if (abs(boundary_Ts[i] - boundary_Ts[i + 1]) >= degenerate_epsilon)
		{
			TraceResult result = trace_one_ray_segment(L, probe_space_ray, boundary_Ts[i], boundary_Ts[i + 1], t_min, t_max, hit_tex_coord);

			switch (result)
			{
				// Definite hit
				case TRACE_RESULT_HIT:
					return TRACE_RESULT_HIT;

				// No hit in this specific probe but we don't yet know if some other probe could have a hit
				case TRACE_RESULT_UNKNOWN:
					return TRACE_RESULT_UNKNOWN;
			}
		}
	}

	// We've traced the whole probe and found no hit nor unknowns, must be a miss
	return TRACE_RESULT_MISS;
}

/**
 *
 * Trace a world space ray against the full light field.
 *
 */
bool trace(
	LightFieldSurface L,
	Ray world_space_ray,
	inout float t_max,
	out vec2 hit_tex_coord)
{
	float t_min = 0.0;
	TraceResult result = trace_one_probe_oct(L, world_space_ray, t_min, t_max, hit_tex_coord);

	return result != TRACE_RESULT_HIT;
}

///////////////////////////////////////////////////////////////////////////////
// Utility (TODO: maybe move these functions to the main shader?)

vec3 compute_glossy_ray(LightFieldSurface L, vec3 world_space_pos, vec3 wo, vec3 normal)
{
	// TODO: Don't assume perfect mirror!!!
	vec3 wi = normalize(reflect(wo, normal));
	vec3 origin = world_space_pos + 0.001 * wi;
	Ray world_space_ray = make_ray(origin, wi);

	float hit_distance = 10000.0;
	vec3  hit_tex_coord;

	if (!trace(L, world_space_ray, hit_distance, hit_tex_coord))
	{
		// TODO: Missed scene, use some fallback method
		return vec3(1.0, 0.0, 1.0);
	}
	else
	{
		// TODO: Sample into a texture array and use the probe_index
		return textureLod(L.radiance_probe, vec2(hit_tex_coord), 0).rgb;
	}

}


#endif // LIGHT_FIELD_PROBE_GLSL
