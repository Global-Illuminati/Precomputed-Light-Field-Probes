#ifndef LIGHT_FIELD_PROBE_DIFFUSE_GLSL
#define LIGHT_FIELD_PROBE_DIFFUSE_GLSL

//
// NOTE:
//
//  This is a modified version of the supplemental code from the paper titled
//     "Real-Time Global Illumination using Precomputed Light Field Probe":
//
//  The supplemental code and the paper can be found at:
//  http://research.nvidia.com/publication/real-time-global-illumination-using-precomputed-light-field-probes
//

#include <common.glsl>
#include <octahedral.glsl>

///////////////////////////////////////////////////
// Temporary stuff! Clean up and optimize later! //
///////////////////////////////////////////////////

const vec2 TEX_SIZE       = vec2(1024.0);
const vec2 TEX_SIZE_SMALL = vec2(64.0);

const vec2 INV_TEX_SIZE       = vec2(1.0) / TEX_SIZE;
const vec2 INV_TEX_SIZE_SMALL = vec2(1.0) / TEX_SIZE_SMALL;

vec2 size(in sampler2D tex)
{
    return vec2(textureSize(tex, 0));
}

vec2 invSize(in sampler2D tex)
{
    return vec2(1.0) / size(tex);
}

///////////////////////////////////////////////////

const float minThickness = 0.03; // meters
const float maxThickness = 0.50; // meters

// Points exactly on the boundary in octahedral space (x = 0 and y = 0 planes) map to two different
// locations in octahedral space. We shorten the segments slightly to give unambigous locations that lead
// to intervals that lie within an octant.
const float rayBumpEpsilon    = 0.001; // meters

// If we go all the way around a cell and don't move farther than this (in m)
// then we quit the trace
const float minProgressDistance = 0.01;

//  zyx bit pattern indicating which probe we're currently using within the cell on [0, 7]
#define CycleIndex int

// On [0, L.probeCounts.x * L.probeCounts.y * L.probeCounts.z - 1]
#define ProbeIndex int

// probe xyz indices
#define GridCoord ivec3

// Enumerated value
#define TraceResult int
#define TRACE_RESULT_MISS    0
#define TRACE_RESULT_HIT     1
#define TRACE_RESULT_UNKNOWN 2

float distanceSquared(Point2 v0, Point2 v1) {
    Point2 d = v1 - v0;
    return dot(d, d);
}

/**
 \param probeCoords Integer (stored in float) coordinates of the probe on the probe grid
 */
ProbeIndex gridCoordToProbeIndex(in LightFieldSurface L, in Point3 probeCoords) {
    return int(probeCoords.x + probeCoords.y * float(L.probeCounts.x) + probeCoords.z * float(L.probeCounts.x) * float(L.probeCounts.y));
    //return int(int(probeCoords.x) + int(probeCoords.y) * L.probeCounts.x + int(probeCoords.z) * L.probeCounts.x * L.probeCounts.y);
    //return int(int(probeCoords.x + probeCoords.y) * L.probeCounts.x + int(probeCoords.z) * L.probeCounts.x * L.probeCounts.y);
}

GridCoord baseGridCoord(in LightFieldSurface L, Point3 X) {
    return clamp(GridCoord((X - L.probeStartPosition) / L.probeStep),
                GridCoord(0, 0, 0),
                GridCoord(L.probeCounts) - GridCoord(1, 1, 1));
}

/** Returns the index of the probe at the floor along each dimension. */
ProbeIndex baseProbeIndex(in LightFieldSurface L, Point3 X) {
    return gridCoordToProbeIndex(L, Point3(baseGridCoord(L, X)));
}


GridCoord probeIndexToGridCoord(in LightFieldSurface L, ProbeIndex index) {
    // Assumes probeCounts are powers of two.
    // Precomputing the MSB actually slows this code down substantially
    ivec3 iPos;
    iPos.x = index & (L.probeCounts.x - 1);
    iPos.y = (index & ((L.probeCounts.x * L.probeCounts.y) - 1)) >> findMSB(L.probeCounts.x);
    iPos.z = index >> findMSB(L.probeCounts.x * L.probeCounts.y);

    return iPos;
    //return ivec3(0, 0, 0); // @Simplification
}

/** probeCoords Coordinates of the probe, computed as part of the process. */
ProbeIndex nearestProbeIndex(in LightFieldSurface L, Point3 X, out Point3 probeCoords) {
    probeCoords = clamp(round((X - L.probeStartPosition) / L.probeStep),
                    Point3(0, 0, 0),
                    Point3(L.probeCounts) - Point3(1, 1, 1));

    return gridCoordToProbeIndex(L, probeCoords);
}

/**
    \param neighbors The 8 probes surrounding X
    \return Index into the neighbors array of the index of the nearest probe to X
*/
CycleIndex nearestProbeIndices(in LightFieldSurface L, Point3 X) {
    Point3 maxProbeCoords = Point3(L.probeCounts) - Point3(1, 1, 1);
    Point3 floatProbeCoords = (X - L.probeStartPosition) / L.probeStep;
    Point3 baseProbeCoords = clamp(floor(floatProbeCoords), Point3(0, 0, 0), maxProbeCoords);

    float minDist = 10.0f;
    int nearestIndex = -1;

    for (int i = 0; i < 8; ++i) {
        Point3 newProbeCoords = min(baseProbeCoords + vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1), maxProbeCoords);
        float d = length(newProbeCoords - floatProbeCoords);
        if (d < minDist) {
            minDist = d;
            nearestIndex = i;
        }
    }

    return nearestIndex;
}


Point3 gridCoordToPosition(in LightFieldSurface L, GridCoord c) {
    return L.probeStep * Vector3(c) + L.probeStartPosition;
    //return vec3(-10.0, 4.0, 0.0); // @Simplification
}


Point3 probeLocation(in LightFieldSurface L, ProbeIndex index) {
    return gridCoordToPosition(L, probeIndexToGridCoord(L, index));
}


/** GLSL's dot on ivec3 returns a float. This is an all-integer version */
int idot(ivec3 a, ivec3 b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}


/**
   \param baseProbeIndex Index into L.radianceProbeGrid's TEXTURE_2D_ARRAY. This is the probe
   at the floor of the current ray sampling position.

   \param relativeIndex on [0, 7]. This is used as a set of three 1-bit offsets

   Returns a probe index into L.radianceProbeGrid. It may be the *same* index as
   baseProbeIndex.

   This will wrap when the camera is outside of the probe field probes...but that's OK.
   If that case arises, then the trace is likely to
   be poor quality anyway. Regardless, this function will still return the index
   of some valid probe, and that probe can either be used or fail because it does not
   have visibility to the location desired.

   \see nextCycleIndex, baseProbeIndex
 */
ProbeIndex relativeProbeIndex(in LightFieldSurface L, ProbeIndex baseProbeIndex, CycleIndex relativeIndex) {
    // Guaranteed to be a power of 2
    ProbeIndex numProbes = L.probeCounts.x * L.probeCounts.y * L.probeCounts.z;

    ivec3 offset = ivec3(relativeIndex & 1, (relativeIndex >> 1) & 1, (relativeIndex >> 2) & 1);
    ivec3 stride = ivec3(1, L.probeCounts.x, L.probeCounts.x * L.probeCounts.y);

    return (baseProbeIndex + idot(offset, stride)) & (numProbes - 1);
}


/** Given a CycleIndex [0, 7] on a cube of probes, returns the next CycleIndex to use.
    \see relativeProbeIndex
*/
CycleIndex nextCycleIndex(CycleIndex cycleIndex) {
    return (cycleIndex + 3) & 7;
}

vec3 computePrefilteredIrradiance(Point3 wsPosition, vec3 wsN) {
	GridCoord baseGridCoord = baseGridCoord(L, wsPosition);
	Point3 baseProbePos = gridCoordToPosition(L, baseGridCoord);
	vec3 sumIrradiance = vec3(0.0);
	float sumWeight = 0.0;
	// Trilinear interpolation values along axes
	Vector3 alpha = clamp((wsPosition - baseProbePos) / L.probeStep, Vector3(0), Vector3(1));

	// Iterate over the adjacent probes defining the surrounding vertex "cage"
	for (int i = 0; i < 8; ++i) {
		// Compute the offset grid coord and clamp to the probe grid boundary
		GridCoord  offset = ivec3(i, i >> 1, i >> 2) & ivec3(1);
		GridCoord  probeGridCoord = clamp(baseGridCoord + offset, GridCoord(0), GridCoord(L.probeCounts - 1));
		ProbeIndex p = gridCoordToProbeIndex(L, vec3(probeGridCoord));

		// Compute the trilinear weights based on the grid cell vertex to smoothly
		// transition between probes. Avoid ever going entirely to zero because that
		// will cause problems at the border probes.
		Vector3 trilinear = mix(1.0 - alpha, alpha, Vector3(offset));
		float weight = trilinear.x * trilinear.y * trilinear.z;

		// Make cosine falloff in tangent plane with respect to the angle from the surface to the probe so that we never
		// test a probe that is *behind* the surface.
		// It doesn't have to be cosine, but that is efficient to compute and we must clip to the tangent plane.
		Point3 probePos = gridCoordToPosition(L, probeGridCoord);
		Vector3 probeToPoint = wsPosition - probePos;
		Vector3 dir = normalize(-probeToPoint);

		// Smooth back-face test
		weight *= max(0.05, dot(dir, wsN));

		vec2 octDir = octEncode(-dir) * 0.5 + 0.5;
		vec2 temp = texture(L.meanDistProbeGrid, vec3(octDir, p)).rg;
		float mean = temp.x;
		float variance = abs(temp.y - (mean * mean));

		float distToProbe = length(probeToPoint);
		// http://www.punkuser.net/vsm/vsm_paper.pdf; equation 5
		float t_sub_mean = distToProbe - mean;
		float chebychev = variance / (variance + (t_sub_mean * t_sub_mean));

		weight *= ((distToProbe <= mean) ? 1.0 : max(chebychev, 0.0));

		// Avoid zero weight
		weight = max(0.0002, weight);

		sumWeight += weight;

		Vector3 irradianceDir = normalize(wsN);
		vec2 octUV = octEncode(irradianceDir) * 0.5 + 0.5;

		vec3 probeIrradiance = texture(L.irradianceProbeGrid, vec3(octUV, p)).rgb;

		// Debug probe contribution by visualizing as colors
		// probeIrradiance = 0.5 * probeIndexToColor(lightFieldSurface, p);

		sumIrradiance += weight * probeIrradiance;
	}

	return 2.0 * PI * sumIrradiance / sumWeight;
}

#endif // LIGHT_FIELD_PROBE_DIFFUSE_GLSL
