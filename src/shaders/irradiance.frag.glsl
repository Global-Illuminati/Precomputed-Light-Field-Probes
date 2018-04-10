#version 300 es
precision highp float;
precision highp sampler2D;
precision highp samplerCube;

#include <common.glsl>
#include <octahedral.glsl>

in vec2 v_tex_coord;

// For sampling "random" points in a sphere
const int  NUM_SPHERE_SAMPLES = 1024;
layout(std140) uniform SphereSamples
{
    // (must pad to 16 bytes, so .a is unused)
    vec4 u_sphere_samples[NUM_SPHERE_SAMPLES];
};

uniform samplerCube u_radiance_cubemap;
uniform int u_num_samples;
uniform float u_lobe_size;

layout(location = 0) out vec4 o_irradiance;

///////////////////////////////////////////////////////////////////////////////

vec3 pointOnUnitSphere(int i, int n)
{
    // Spread out the n samples over the total amount (assuming n < sample count)
    int k = NUM_SPHERE_SAMPLES / n;

    int index = i * k;
    vec3 point = u_sphere_samples[index % NUM_SPHERE_SAMPLES].xyz;

    return point;
}

///////////////////////////////////////////////////////////////////////////////

void main()
{
    //vec3 N = normalize(vec3(v_tex_coord.x, v_tex_coord.y, 1.0));//octDecode(v_tex_coord * 2.0 - 1.0);
    vec3 N = direction_from_spherical(v_tex_coord);
    vec3 irradiance = vec3(0.0);

    for (int i = 0; i < u_num_samples; ++i)
    {
        // Importance sample points in the hemisphere using the cosine lobe method which
        // conveniently bakes in the LdotN and pdf terms.
        vec3 offset = pointOnUnitSphere(i, u_num_samples);
        vec3 sampleDirection = normalize(N + u_lobe_size * offset);
        vec3 sampleIrradiance = texture(u_radiance_cubemap, sampleDirection).rgb;

        irradiance += sampleIrradiance;
    }

    // Average the samples together
    irradiance /= float(u_num_samples);

    // Apply the Lambert BRDF (albedo / PI)
    // NOTE: Not relevant for now since we currently aren't physically based
    //irradiance /= PI;

    o_irradiance = vec4(irradiance, 1.0);
}
