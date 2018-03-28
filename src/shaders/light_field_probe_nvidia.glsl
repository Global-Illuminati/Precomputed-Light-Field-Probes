#ifndef LIGHT_FIELD_PROBE_NVIDIA_GLSL
#define LIGHT_FIELD_PROBE_NVIDIA_GLSL

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

    //return iPos;
    return ivec3(0, 0, 0); // @Simplification
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
    //return L.probeStep * Vector3(c) + L.probeStartPosition;
    return vec3(-10.0, 4.0, 0.0); // @Simplification
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


/** Two-element sort: maybe swaps a and b so that a' = min(a, b), b' = max(a, b). */
void minSwap(inout float a, inout float b) {
    float temp = min(a, b);
    b = max(a, b);
    a = temp;
}


/** Sort the three values in v from least to 
    greatest using an exchange network (i.e., no branches) */
void sort(inout vec3 v) {
    minSwap(v[0], v[1]);
    minSwap(v[1], v[2]);
    minSwap(v[0], v[1]);
}

vec3 sortFailsafeAndStupid(in vec3 v)
{
    float lowest  = min(min(v.x, v.y), min(v.y, v.z));
    float highest = max(max(v.x, v.y), max(v.y, v.z));

    bool xRep = v.x == lowest || v.x == highest;
    bool yRep = v.y == lowest || v.y == highest;
    bool zRep = v.z == lowest || v.z == highest;

    float middle;
    if      (!xRep) middle = v.x;
    else if (!yRep) middle = v.y;
    else if (!zRep) middle = v.z;

    return vec3(lowest, middle, highest);
}


/** Segments a ray into the piecewise-continuous rays or line segments that each lie within
    one Euclidean octant, which correspond to piecewise-linear projections in octahedral space.
        
    \param boundaryT  all boundary distance ("time") values in units of world-space distance 
      along the ray. In the (common) case where not all five elements are needed, the unused 
      values are all equal to tMax, creating degenerate ray segments.

    \param origin Ray origin in the Euclidean object space of the probe

    \param directionFrac 1 / ray.direction
 */
void computeRaySegments
   (in Point3           origin, 
    in Vector3          directionFrac, 
    in float            tMin,
    in float            tMax,
    out float           boundaryTs[5]) {

    boundaryTs[0] = tMin;
    
    // Time values for intersection with x = 0, y = 0, and z = 0 planes, sorted
    // in increasing order
    Vector3 t = origin * -directionFrac;  
    sort(t);

/*
    t = sortFailsafeAndStupid(t); // @Simplification
    float diff = tMax - tMin;
    float step = diff / 5.0;
    for (int i = 0; i < 3; ++i) {
        boundaryTs[i + 1] = tMin + (step + 1.0);
    }
*/
    // Copy the values into the interval boundaries.
    // This loop expands at compile time and eliminates the
    // relative indexing, so it is just three conditional move operations
    for (int i = 0; i < 3; ++i) {
        boundaryTs[i + 1] = clamp(t[i], tMin, tMax);
    }

    boundaryTs[4] = tMax;
}


/** Returns the distance along v from the origin to the intersection 
    with ray R (which it is assumed to intersect) */
float distanceToIntersection(in Ray R, in Vector3 v) {
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


/**
  On a TRACE_RESULT_MISS, bumps the endTexCoord slightly so that the next segment will start at the
  right place. We do that in the high res trace because
  the ray direction variables are already available here.

  TRACE_RESULT_HIT:      This probe guarantees there IS a surface on this segment
  TRACE_RESULT_MISS:     This probe guarantees there IS NOT a surface on this segment
  TRACE_RESULT_UNKNOWN:  This probe can't provide any information
*/
TraceResult highResolutionTraceOneRaySegment
   (in LightFieldSurface lightFieldSurface,
    in Ray      probeSpaceRay,
    in Point2   startTexCoord, 
    in Point2   endTexCoord,    
    in ProbeIndex probeIndex,
    inout float tMin,
    inout float tMax,
    inout vec2  hitProbeTexCoord) {    
      
    Vector2 texCoordDelta        = endTexCoord - startTexCoord;
    float texCoordDistance       = length(texCoordDelta);
    Vector2 texCoordDirection    = texCoordDelta * (1.0 / texCoordDistance);

    float texCoordStep = invSize(lightFieldSurface.distanceProbeGrid).x * (texCoordDistance / maxComponent(abs(texCoordDelta)));
    
    Vector3 directionFromProbeBefore = octDecode(startTexCoord * 2.0 - 1.0);
    float distanceFromProbeToRayBefore = max(0.0, distanceToIntersection(probeSpaceRay, directionFromProbeBefore));

    // Special case for singularity of probe on ray
    if (false) {
        float cosTheta = dot(directionFromProbeBefore, probeSpaceRay.direction);
        if (abs(cosTheta) > 0.9999) {        
            // Check if the ray is going in the same direction as a ray from the probe through the start texel
            if (cosTheta > 0.0) {
                // If so, return a hit
                
                // @TextureArray
                //float distanceFromProbeToSurface = texelFetch(lightFieldSurface.distanceProbeGrid,
                //    ivec3(lightFieldSurface.distanceProbeGrid.size.xy * startTexCoord, probeIndex), 0).r;
                float distanceFromProbeToSurface = texelFetch(lightFieldSurface.distanceProbeGrid,
                    ivec2(size(lightFieldSurface.distanceProbeGrid) * startTexCoord), 0).r;

                tMax = length(probeSpaceRay.origin - directionFromProbeBefore * distanceFromProbeToSurface);
                hitProbeTexCoord = startTexCoord;
                return TRACE_RESULT_HIT;
            } else {
                // If it is going in the opposite direction, we're never going to find anything useful, so return false
                return TRACE_RESULT_UNKNOWN;
            }
        }
    }

    for (float d = 0.0f; d <= texCoordDistance; d += texCoordStep) {
        Point2 texCoord = (texCoordDirection * min(d + texCoordStep * 0.5, texCoordDistance)) + startTexCoord;

        // @TextureArray
        // Fetch the probe data
        //float distanceFromProbeToSurface = texelFetch(lightFieldSurface.distanceProbeGrid,
        //    ivec3(lightFieldSurface.distanceProbeGrid.size.xy * texCoord, probeIndex), 0).r;
        float distanceFromProbeToSurface = texelFetch(lightFieldSurface.distanceProbeGrid,
            ivec2(size(lightFieldSurface.distanceProbeGrid) * texCoord), 0).r;

        // Find the corresponding point in probe space. This defines a line through the 
        // probe origin
        Vector3 directionFromProbe = octDecode(texCoord * 2.0 - 1.0);
        
        Point2 texCoordAfter = (texCoordDirection * min(d + texCoordStep, texCoordDistance)) + startTexCoord;
        Vector3 directionFromProbeAfter = octDecode(texCoordAfter * 2.0 - 1.0);
        float distanceFromProbeToRayAfter = max(0.0, distanceToIntersection(probeSpaceRay, directionFromProbeAfter));
        float maxDistFromProbeToRay = max(distanceFromProbeToRayBefore, distanceFromProbeToRayAfter);

        if (maxDistFromProbeToRay >= distanceFromProbeToSurface) {
            // At least a one-sided hit; see if the ray actually passed through the surface, or was behind it

            float minDistFromProbeToRay = min(distanceFromProbeToRayBefore, distanceFromProbeToRayAfter);

            // Find the 3D point *on the trace ray* that corresponds to the tex coord.
            // This is the intersection of the ray out of the probe origin with the trace ray.
            float distanceFromProbeToRay = (minDistFromProbeToRay + maxDistFromProbeToRay) * 0.5;

            // Use probe information
            Point3 probeSpaceHitPoint = distanceFromProbeToSurface * directionFromProbe;
            float distAlongRay = dot(probeSpaceHitPoint - probeSpaceRay.origin, probeSpaceRay.direction);

            // @TextureArray
            // Read the normal for use in detecting backfaces
            //vec3 normal = octDecode(texelFetch(lightFieldSurface.normalProbeGrid, ivec3(lightFieldSurface.distanceProbeGrid.size.xy * texCoord, probeIndex), 0).xy * lightFieldSurface.normalProbeGrid.readMultiplyFirst.xy + lightFieldSurface.normalProbeGrid.readAddSecond.xy);
            vec3 packedNormal = texelFetch(lightFieldSurface.normalProbeGrid,
                ivec2(size(lightFieldSurface.distanceProbeGrid) * texCoord), 0).rgb;
            vec3 normal = unpackNormal(packedNormal);

            // Only extrude towards and away from the view ray, not perpendicular to it
            // Don't allow extrusion TOWARDS the viewer, only away
            float surfaceThickness = minThickness
                + (maxThickness - minThickness) * 

                // Alignment of probe and view ray
                max(dot(probeSpaceRay.direction, directionFromProbe), 0.0) * 

                // Alignment of probe and normal (glancing surfaces are assumed to be thicker because they extend into the pixel)
                (2.0 - abs(dot(probeSpaceRay.direction, normal))) *

                // Scale with distance along the ray
                clamp(distAlongRay * 0.1, 0.05, 1.0);


            if ((minDistFromProbeToRay < distanceFromProbeToSurface + surfaceThickness) && (dot(normal, probeSpaceRay.direction) < 0.0)) {
                // Two-sided hit
                // Use the probe's measure of the point instead of the ray distance, since
                // the probe is more accurate (floating point precision vs. ray march iteration/oct resolution)
                tMax = distAlongRay;
                hitProbeTexCoord = texCoord;
                
                return TRACE_RESULT_HIT;
            } else {
                // "Unknown" case. The ray passed completely behind a surface. This should trigger moving to another
                // probe and is distinguished from "I successfully traced to infinity"
                
                // Back up conservatively so that we don't set tMin too large
                Point3 probeSpaceHitPointBefore = distanceFromProbeToRayBefore * directionFromProbeBefore;
                float distAlongRayBefore = dot(probeSpaceHitPointBefore - probeSpaceRay.origin, probeSpaceRay.direction);
                
                // Max in order to disallow backing up along the ray (say if beginning of this texel is before tMin from probe switch)
                // distAlongRayBefore in order to prevent overstepping
                // min because sometimes distAlongRayBefore > distAlongRay
                tMin = max(tMin, min(distAlongRay,distAlongRayBefore));

                return TRACE_RESULT_UNKNOWN;
            }
        }
        distanceFromProbeToRayBefore = distanceFromProbeToRayAfter;
    } // ray march

    return TRACE_RESULT_MISS;
}


/** Returns true on a conservative hit, false on a guaranteed miss.
    On a hit, advances lowResTexCoord to the next low res texel *after*
    the one that produced the hit.

    The texture coordinates are not texel centers...they are sub-texel 
    positions true to the actual ray. This allows chopping up the ray
    without distorting it.

    segmentEndTexCoord is the coordinate of the endpoint of the entire segment of the ray

    texCoord is the start coordinate of the segment crossing
    the low-res texel that produced the conservative hit, if the function 
    returns true.  endHighResTexCoord is the end coordinate of that 
    segment...which is also the start of the NEXT low-res texel to cross
    when resuming the low res trace.

  */
bool lowResolutionTraceOneSegment
   (in LightFieldSurface lightFieldSurface, 
    in Ray               probeSpaceRay, 
    in ProbeIndex        probeIndex, 
    inout Point2         texCoord, 
    in Point2            segmentEndTexCoord, 
    inout Point2         endHighResTexCoord) {
        
    Vector2 lowResSize    = size(lightFieldSurface.lowResolutionDistanceProbeGrid);
    Vector2 lowResInvSize = invSize(lightFieldSurface.lowResolutionDistanceProbeGrid);

    // Convert the texels to pixel coordinates:
    Point2 P0 = texCoord           * lowResSize;
    Point2 P1 = segmentEndTexCoord * lowResSize;

    // If the line is degenerate, make it cover at least one pixel
    // to avoid handling zero-pixel extent as a special case later
    P1 += vec2((distanceSquared(P0, P1) < 0.0001) ? 0.01 : 0.0);
    // In pixel coordinates
    Vector2 delta = P1 - P0;

    // Permute so that the primary iteration is in x to reduce
    // large branches later
    bool permute = false;
    if (abs(delta.x) < abs(delta.y)) { 
        // This is a more-vertical line
        permute = true;
        delta = delta.yx; P0 = P0.yx; P1 = P1.yx; 
    }

    float   stepDir = sign(delta.x);
    float   invdx = stepDir / delta.x;
    Vector2 dP = vec2(stepDir, delta.y * invdx);
    
    Vector3 initialDirectionFromProbe = octDecode(texCoord * 2.0 - 1.0);
    float prevRadialDistMaxEstimate = max(0.0, distanceToIntersection(probeSpaceRay, initialDirectionFromProbe));
    // Slide P from P0 to P1
    float  end = P1.x * stepDir;
    
    float absInvdPY = 1.0 / abs(dP.y);

    // Don't ever move farther from texCoord than this distance, in texture space,
    // because you'll move past the end of the segment and into a different projection
    float maxTexCoordDistance = lengthSquared(segmentEndTexCoord - texCoord);

    for (Point2 P = P0; ((P.x * sign(delta.x)) <= end); ) {
        
        Point2 hitPixel = permute ? P.yx : P;
        
        // @TextureArray
        //float sceneRadialDistMin = texelFetch(lightFieldSurface.lowResolutionDistanceProbeGrid, int3(hitPixel, probeIndex), 0).r;
        float sceneRadialDistMin = texelFetch(lightFieldSurface.lowResolutionDistanceProbeGrid, ivec2(hitPixel), 0).r;

        // Distance along each axis to the edge of the low-res texel
        Vector2 intersectionPixelDistance = (sign(delta) * 0.5 + 0.5) - sign(delta) * fract(P);

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


TraceResult traceOneRaySegment
   (in LightFieldSurface lightFieldSurface, 
    in Ray      probeSpaceRay, 
    in float    t0, 
    in float    t1,    
    in ProbeIndex probeIndex,
    inout float tMin, // out only
    inout float tMax, 
    inout vec2  hitProbeTexCoord) {

    // Euclidean probe-space line segment, composed of two points on the probeSpaceRay
    Vector3 probeSpaceStartPoint = probeSpaceRay.origin + probeSpaceRay.direction * (t0 + rayBumpEpsilon);
    Vector3 probeSpaceEndPoint   = probeSpaceRay.origin + probeSpaceRay.direction * (t1 - rayBumpEpsilon);

    // If the original ray origin is really close to the probe origin, then probeSpaceStartPoint will be close to zero
    // and we get NaN when we normalize it. One common case where this can happen is when the camera is at the probe
    // center. (The end point is also potentially problematic, but the chances of the end landing exactly on a probe 
    // are relatively low.) We only need the *direction* to the start point, and using probeSpaceRay.direction
    // is safe in that case.
    if (lengthSquared(probeSpaceStartPoint) < 0.001) {
        probeSpaceStartPoint = probeSpaceRay.direction;
    }

    // Corresponding octahedral ([-1, +1]^2) space line segment.
    // Because the points are in probe space, we don't have to subtract off the probe's origin
    Point2 startOctCoord         = octEncode(normalize(probeSpaceStartPoint));
    Point2 endOctCoord           = octEncode(normalize(probeSpaceEndPoint));

    // Texture coordinates on [0, 1]
    Point2 texCoord              = startOctCoord * 0.5 + 0.5;
    Point2 segmentEndTexCoord    = endOctCoord   * 0.5 + 0.5;

    while (true) {
        Point2 endTexCoord;

        // Trace low resolution, min probe until we:
        // - reach the end of the segment (return "miss" from the whole function)
        // - "hit" the surface (invoke high-resolution refinement, and then iterate if *that* misses)
            
        // If lowResolutionTraceOneSegment conservatively "hits", it will set texCoord and endTexCoord to be the high-resolution texture coordinates.
        // of the intersection between the low-resolution texel that was hit and the ray segment.
        Vector2 originalStartCoord = texCoord;
        if (! lowResolutionTraceOneSegment(lightFieldSurface, probeSpaceRay, probeIndex, texCoord, segmentEndTexCoord, endTexCoord)) {
            // The whole trace failed to hit anything           
            return TRACE_RESULT_MISS;
            //return TRACE_RESULT_UNKNOWN;
        } else {

            // The low-resolution trace already guaranted that endTexCoord is no farther along the ray than segmentEndTexCoord if this point is reached,
            // so we don't need to clamp to the segment length

#if 0            
            TraceResult result = highResolutionTraceOneRaySegment(lightFieldSurface, probeSpaceRay, texCoord, endTexCoord, probeIndex, tMin, tMax, hitProbeTexCoord);

            if (result != TRACE_RESULT_MISS) {
                // High-resolution hit or went behind something, which must be the result for the whole segment trace
                return result;
            }
#else

            // Low res hit assumed to be okay @Simplification
            hitProbeTexCoord = endTexCoord;
            return TRACE_RESULT_HIT;
#endif
        } // else...continue the outer loop; we conservatively refined and didn't actually find a hit

        // Recompute each time around the loop to avoid increasing the peak register count
        Vector2 texCoordRayDirection = normalize(segmentEndTexCoord - texCoord);

        if (dot(texCoordRayDirection, segmentEndTexCoord - endTexCoord) <= invSize(lightFieldSurface.distanceProbeGrid).x) {
            // The high resolution trace reached the end of the segment; we've failed to find a hit
            return TRACE_RESULT_MISS;
        } else {
            // We made it to the end of the low-resolution texel using the high-resolution trace, so that's
            // the starting point for the next low-resolution trace. Bump the ray to guarantee that we advance
            // instead of getting stuck back on the low-res texel we just verified...but, if that fails on the 
            // very first texel, we'll want to restart the high-res trace exactly where we left off, so
            // don't bump by an entire high-res texel
            texCoord = endTexCoord + texCoordRayDirection * invSize(lightFieldSurface.distanceProbeGrid).x * 1.01;
        }
    } // while low-resolution trace

    // Reached the end of the segment
    return TRACE_RESULT_MISS;
}



/**
  \param tMax On call, the stop distance for the trace. On return, the distance 
        to the new hit, if one was found. Always finite.
  \param tMin On call, the start distance for the trace. On return, the start distance
        of the ray right before the first "unknown" step.
  \param hitProbeTexCoord Written to only on a hit
  \param index probe index
 */
TraceResult traceOneProbeOct(in LightFieldSurface lightFieldSurface, in ProbeIndex index, in Ray worldSpaceRay, inout float tMin, inout float tMax, inout vec2 hitProbeTexCoord) {
    // How short of a ray segment is not worth tracing?
    const float degenerateEpsilon = 0.001; // meters
    
    //Point3 probeOrigin = probeLocation(lightFieldSurface, index);
    Point3 probeOrigin = Point3(-10.0, 4.0, 0.0);// @Simplification
    
    Ray probeSpaceRay;
    probeSpaceRay.origin    = worldSpaceRay.origin - probeOrigin;
    probeSpaceRay.direction = worldSpaceRay.direction;

    // Maximum of 5 boundary points when projecting ray onto octahedral map; 
    // ray origin, ray end, intersection with each of the XYZ planes.
    float boundaryTs[5];
    computeRaySegments(probeSpaceRay.origin, Vector3(1.0) / probeSpaceRay.direction, tMin, tMax, boundaryTs);
    
    // for each open interval (t[i], t[i + 1]) that is not degenerate
    for (int i = 0; i < 4; ++i) {
        if (abs(boundaryTs[i] - boundaryTs[i + 1]) >= degenerateEpsilon) {
            TraceResult result = traceOneRaySegment(lightFieldSurface, probeSpaceRay, boundaryTs[i], boundaryTs[i + 1], index, tMin, tMax, hitProbeTexCoord);
#if 1
            if (result == TRACE_RESULT_HIT)
            {
                // Hit!
                return TRACE_RESULT_HIT;
            }

            if (result == TRACE_RESULT_UNKNOWN)
            {
                // Failed to find anything conclusive
                return TRACE_RESULT_UNKNOWN;
            }
#else
            switch (result) {
            case TRACE_RESULT_HIT:
                // Hit!            
                return TRACE_RESULT_HIT;

            case TRACE_RESULT_UNKNOWN:
                // Failed to find anything conclusive
                return TRACE_RESULT_UNKNOWN;
            } // switch
#endif
        } // if 
    } // For each segment

    return TRACE_RESULT_MISS;
}


/** Traces a ray against the full lightfield.
    Returns true on a hit and updates \a tMax if there is a ray hit before \a tMax. 
   Otherwise returns false and leaves tMax unmodified 
   
   \param hitProbeTexCoord on [0, 1]
   
   \param fillHoles If true, this function MUST return a hit even if it is forced to use a coarse approximation
 */
bool trace(LightFieldSurface lightFieldSurface, Ray worldSpaceRay, inout float tMax, out Point2 hitProbeTexCoord, out ProbeIndex hitProbeIndex, const bool fillHoles) {
    
    hitProbeIndex = -1;

    // TODO: This variable doesn't exist in the source, but this makes sense I guess
    ProbeIndex baseIndex = 0;

    int i = nearestProbeIndices(lightFieldSurface, worldSpaceRay.origin);
    int probesLeft = 8;
    float tMin = 0.0f;
    while (probesLeft > 0) {
        TraceResult result = traceOneProbeOct(lightFieldSurface, relativeProbeIndex(lightFieldSurface, baseIndex, i),
            worldSpaceRay, tMin, tMax, hitProbeTexCoord);
        if (result == TRACE_RESULT_UNKNOWN) {
            i = nextCycleIndex(i);
            --probesLeft;
        } else {
            if (result == TRACE_RESULT_HIT) {
                hitProbeIndex = relativeProbeIndex(lightFieldSurface, baseIndex, i);
            }
            // Found the hit point
            break;
        }
    }
    
    if ((hitProbeIndex == -1) && fillHoles) {
        // No probe found a solution, so force some backup plan 
        Point3 ignore;
        hitProbeIndex = nearestProbeIndex(lightFieldSurface, worldSpaceRay.origin, ignore);
        hitProbeTexCoord = octEncode(worldSpaceRay.direction) * 0.5 + 0.5;

        // @TextureArray
        //float probeDistance = texelFetch(lightFieldSurface.distanceProbeGrid, ivec3(ivec2(hitProbeTexCoord * lightFieldSurface.distanceProbeGrid.size.xy), hitProbeIndex), 0).r;
        float probeDistance = texelFetch(lightFieldSurface.distanceProbeGrid,
            ivec2(hitProbeTexCoord * size(lightFieldSurface.distanceProbeGrid)), 0).r;

        if (probeDistance < 10000.0) {
            Point3 hitLocation = probeLocation(lightFieldSurface, hitProbeIndex) + worldSpaceRay.direction * probeDistance;
            tMax = length(worldSpaceRay.origin - hitLocation);
            return true;
        }
    }

    return (hitProbeIndex != -1);
}

///////////////////////////////////////////////////////////////////////////////
// "Utility" (TODO: maybe move these functions to the main shader?)

/**
 Trace a single probe and return result as is
 */
TraceResult trace_simple(LightFieldSurface lightFieldSurface, Ray worldSpaceRay, inout float tMax, out Point2 hitProbeTexCoord, out ProbeIndex hitProbeIndex) {

    hitProbeIndex = -1;
    float tMin = 0.0f;
    ProbeIndex baseIndex = 0;

    TraceResult result = traceOneProbeOct(lightFieldSurface, relativeProbeIndex(lightFieldSurface, baseIndex, 0),
            worldSpaceRay, tMin, tMax, hitProbeTexCoord);

    return result;
}

vec3 compute_glossy_ray(LightFieldSurface L, vec3 world_space_pos, vec3 wo, vec3 normal)
{
	// TODO: Don't assume perfect mirror!!!
	vec3 wi = normalize(reflect(-wo, normal));
	vec3 origin = world_space_pos + 0.2 * normal + 0.1 * wi;
	Ray world_space_ray = makeRay(origin, wi);

	float hit_distance = 10000.0;
	ProbeIndex hit_probe_index;
	vec2 hit_tex_coord;

	TraceResult result = trace_simple(L, world_space_ray, hit_distance, hit_tex_coord, hit_probe_index);

    if (result == TRACE_RESULT_HIT)
    {
        return textureLod(L.radianceProbeGrid, vec2(hit_tex_coord), 0.0).rgb;
    }
    else if (result == TRACE_RESULT_MISS)
    {
        // TODO: Sample from environment!
		return vec3(0.0, 0.0, 1.0);
    }
    else if (result == TRACE_RESULT_UNKNOWN)
    {
        return vec3(1.0, 0.0, 1.0);
    }
/*
	switch (result)
	{
		case TRACE_RESULT_HIT:
			return textureLod(L.radianceProbeGrid, vec2(hit_tex_coord), 0.0).rgb;

		case TRACE_RESULT_MISS:
			// TODO: Sample from environment!
			return vec3(0.0, 0.0, 1.0);

		case TRACE_RESULT_UNKNOWN:
			return vec3(1.0, 0.0, 1.0);
	}
*/
/*
	if (!trace(L, world_space_ray, hit_distance, hit_tex_coord, hit_probe_index, true))
	{
		// TODO: Missed scene, use some fallback method
		return vec3(1.0, 0.0, 1.0);
	}
	else
	{
		// TODO: Texture Array - Sample into a texture array and use the probe_index
		return textureLod(L.radianceProbeGrid, vec2(hit_tex_coord), 0.0).rgb;
	}
*/
}

#endif // Header guard
