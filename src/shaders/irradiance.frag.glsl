#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp int;


#include <common.glsl>

in vec2 v_tex_coord;

uniform sampler2DArray u_radiance_octahedral;
uniform int u_layer;

layout(location = 0) out vec4 o_radiance;

void main()
{
  //Monte Carlo Integral...
  vec3 radiance = texture(u_radiance_octahedral, vec3(v_tex_coord, float(u_layer))).rgb;

  o_radiance = vec4(radiance, 1.0);
}
