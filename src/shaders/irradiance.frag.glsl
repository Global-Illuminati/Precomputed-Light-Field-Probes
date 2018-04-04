#version 300 es
precision highp float;

#include <common.glsl>

in vec2 v_tex_coord;

uniform sampler2D u_radiance_octahedral;

layout(location = 0) out vec4 o_radiance;

void main()
{
  //Monte Carlo Integral...
  vec3 radiance = texture(u_radiance_octahedral, v_tex_coord).rgb;

  o_radiance = vec4(radiance, 1.0);
}
