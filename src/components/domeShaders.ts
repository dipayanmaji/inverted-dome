export const VERTEX_SHADER = `#version 300 es
precision highp float;

// Fullscreen triangle: 3 vertices covering the whole clip space, no VBO needed
// beyond a plain vertex index (drawn via gl.drawArrays(TRIANGLES, 0, 3)).
const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}
`;

// Warps the whole tiled grid as one continuous surface (like a barrel/fisheye
// lens) instead of tilting each tile independently, so the black gutters
// between tiles curve too — matching the "inside of a dome" look.
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform vec2 uOffset;
uniform float uTileW;
uniform float uTileH;
uniform float uGap;
uniform float uBorderRadius;
uniform float uCurve;
uniform float uCurveRadius;
uniform float uZoom;
uniform float uTileRotation;
uniform float uGrayscale;
uniform float uVignette;
uniform vec4 uBgColor;
uniform sampler2D uAtlas;
uniform float uAtlasCols;
uniform float uAtlasRows;
uniform float uAtlasCount;
uniform float uSeed;

out vec4 outColor;

// Integer hash (no sin/float involved) so this produces bit-for-bit the same
// result as hashCellToIndex() in glUtils.ts, which the JS-side click hit
// test uses. A sin()-based float hash here would drift from its JS
// counterpart — GLSL's sin operates in 32-bit float vs JS's 64-bit double —
// so clicking a tile could open a different image than the one rendered.
uint hashCell(int col, int row, int seed) {
  int h = col * 374761393 + row * 668265263 + seed * -2048144777;
  uint hu = uint(h) ^ (uint(h) >> 13u);
  int h2 = int(hu) * 1274126177;
  return uint(h2) ^ (uint(h2) >> 16u);
}

void main() {
  vec2 res = uResolution;
  vec2 center = res * 0.5;
  // Flip Y so (0,0) is top-left, matching CSS/pointer-event coordinates.
  vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec2 d = p - center;
  float r = length(d);
  vec2 dir = r > 0.0001 ? d / r : vec2(0.0);

  float halfDiag = max(length(center), 1.0);
  float lensReach = max(halfDiag * uCurveRadius, 1.0);

  // Inverse-cubic ("pincushion") mapping: r' = r / (1 + k * r^2). Screen
  // radius grows faster than the source radius it samples, so a fixed patch
  // of grid content is spread across more screen pixels near the edges —
  // tiles stretch outward, like the rim of a dome seen from underneath.
  // The k*r^2 term is clamped so the mapping stays monotonic (no folding)
  // even at extreme curve/curveRadius combinations.
  float k = uCurve / (lensReach * lensReach);
  float kr2 = min(k * r * r, 0.95);
  float distortedR = r / (1.0 + kr2);

  float zoomFactor = max(1.0 + uZoom, 0.01);
  vec2 samplePoint = center + dir * distortedR / zoomFactor;
  vec2 gridPos = samplePoint + uOffset;

  float cellW = uTileW + uGap;
  float cellH = uTileH + uGap;
  vec2 cellF = floor(vec2(gridPos.x / cellW, gridPos.y / cellH));
  vec2 localPx = vec2(mod(gridPos.x, cellW), mod(gridPos.y, cellH));

  vec2 tileLocal = localPx - vec2(uGap * 0.5);
  vec2 tileHalf = vec2(uTileW, uTileH) * 0.5;
  vec2 tileCenter = tileHalf;

  float rad = min(uBorderRadius, min(uTileW, uTileH) * 0.5);
  vec2 q = abs(tileLocal - tileCenter) - (tileHalf - rad);
  float distOutside = length(max(q, 0.0)) - rad;

  if (distOutside > 0.75) {
    if (uBgColor.a < 0.001) discard;
    outColor = uBgColor;
    return;
  }
  float edgeAlpha = 1.0 - smoothstep(-0.75, 0.75, distOutside);

  vec2 rel = tileLocal - tileCenter;
  float cosR = cos(-uTileRotation);
  float sinR = sin(-uTileRotation);
  vec2 relRot = vec2(rel.x * cosR - rel.y * sinR, rel.x * sinR + rel.y * cosR);
  vec2 uvInTile = clamp((relRot + tileCenter) / vec2(uTileW, uTileH), 0.0, 1.0);

  uint h = hashCell(int(cellF.x), int(cellF.y), int(uSeed));
  float idx = float(h % uint(max(uAtlasCount, 1.0)));
  float ax = mod(idx, uAtlasCols);
  float ay = floor(idx / uAtlasCols);

  vec2 atlasCellSize = vec2(1.0 / uAtlasCols, 1.0 / uAtlasRows);
  vec2 atlasUV = vec2(ax, ay) * atlasCellSize + uvInTile * atlasCellSize;

  // textureLod(..., 0.0) instead of texture(...): the lens warp can make
  // atlasUV change extremely sharply between two adjacent on-screen pixels
  // near strong-curvature regions. GPUs compute implicit derivatives across
  // each 2x2 pixel quad for automatic mip/LOD selection even when a texture
  // has no mipmaps — an extreme derivative there was observed to corrupt the
  // sampled result into flat color bands on some drivers, even though the
  // stored texture data and the atlasUV math both check out as correct in
  // isolation. Forcing LOD 0 explicitly skips that derivative computation.
  vec4 texColor = textureLod(uAtlas, atlasUV, 0.0);

  float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 colorRGB = mix(texColor.rgb, vec3(lum), uGrayscale);

  float vign = uVignette * smoothstep(0.2, 1.0, r / halfDiag);
  colorRGB *= (1.0 - vign);

  outColor = vec4(colorRGB, texColor.a * edgeAlpha);
}
`;
