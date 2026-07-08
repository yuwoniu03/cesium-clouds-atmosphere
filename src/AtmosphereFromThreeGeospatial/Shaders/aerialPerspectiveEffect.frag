// Cesium/PostProcessStage 版 AerialPerspectiveEffect 片元主体。
// 该文件不包含任何 #include；Bruneton 的 definitions/common/runtime 由 JS 侧拼接在它之前。

uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;

uniform vec3 u_cameraPosition; // km
uniform vec3 u_altitudeCorrection; // km
uniform vec3 u_sunDirection;
// 曝光在上一 pass（AtmospherePostProcess）线性段完成；此处仅做 ACES + gamma
// three-geospatial 对齐：直接采样 shadowLengthBuffer（这里沿用现有 uniform 命名）
uniform int u_cloudShadowLengthEnabled;
uniform float u_cloudShadowLengthScale;
uniform sampler2D u_cloudShadowLengthTexture;
// BSM 地面太阳遮光（与 AtmospherePostProcess 中 getGroundSunTransmittance 一致；applyGroundAtmosphere=false 时仅靠本 pass 生效）
uniform sampler2D u_cloudShadowBuffer;
uniform float u_cloudShadowScale;
uniform vec4 u_cloudShadowDecode;
uniform int u_cloudShadowEnabled;
uniform mat4 u_cloudShadowMatrices[4];
uniform vec2 u_cloudShadowIntervals[4];
uniform float u_cloudShadowFar;
uniform float u_cloudShadowTopHeight;
uniform float u_cloudShadowBottomRadius;
uniform float u_bsmGroundOpticalDepthScale;

const float METER_TO_LENGTH_UNIT = 0.001; // m -> km

vec3 ACESFilmic(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// AtmospherePostProcess 已输出曝光后的线性 HDR；本 pass 只做一次 OETF（勿再乘曝光）
vec4 tonemapDisplay(vec3 linearHdr, float a) {
  vec3 c = ACESFilmic(linearHdr);
  c = pow(c, vec3(1.0 / 2.2));
  return vec4(c, a);
}

void reconstructRay(out vec3 ro, out vec3 rd) {
  ro = u_cameraPosition + u_altitudeCorrection;
  vec2 uv = v_textureCoordinates * 2.0 - 1.0;
  vec4 clipPos = vec4(uv, 1.0, 1.0);
  vec4 viewPos = czm_inverseProjection * clipPos;
  viewPos /= viewPos.w;
  vec4 worldPos4 = czm_inverseView * viewPos;
  vec3 worldPosKm = worldPos4.xyz * METER_TO_LENGTH_UNIT + u_altitudeCorrection;
  rd = normalize(worldPosKm - ro);
}

// 射线 o + t*d 与以原点为球心、半径 R 的球在 t>eps 上是否存在交点（前向半直线）
bool rayForwardHitsSphere(vec3 o, vec3 d, float R) {
  float b = dot(o, d);
  float c = dot(o, o) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) {
    return false;
  }
  float s = sqrt(disc);
  float t0 = -b - s;
  float t1 = -b + s;
  return (t0 > 1e-6) || (t1 > 1e-6);
}

// 是否处于 bottom/top 大气壳层之间（不含恰贴内球心的情况，地表略大于 bottom 时算壳层内）
bool cameraInAtmosphereShell(vec3 o, float bottomR, float topR) {
  float r = length(o);
  return r > bottomR + 1e-5 && r < topR - 1e-5;
}

// 2×2 图集：cascade 0=左上, 1=右上, 2=左下, 3=右下（与 AtmospherePostProcess 一致）
vec2 getCloudShadowAtlasOffset(int ci) {
  float x = mod(float(ci), 2.0) * 0.5;
  float y = (ci < 2) ? 0.5 : 0.0;
  return vec2(x, y);
}

// rawWorldPosMeters：ECEF 米；u_cloudShadowBottomRadius / TopHeight 与管线 setCloudShadow 一致（米）
float getGroundSunTransmittance(vec3 rawWorldPosMeters) {
  if (u_cloudShadowEnabled == 0) return 1.0;
  vec3 groundNormal = normalize(rawWorldPosMeters);
  float sunSinElev = dot(u_sunDirection, groundNormal);

  // 1) 昼夜线遮挡：太阳低于该地面点本地地平线时，地面点已入夜，无云阴影。
  //    这是「地球曲面遮挡直射阳光」的几何判据。
  float horizonFade = smoothstep(-0.02, 0.02, sunSinElev);
  if (horizonFade <= 0.0) return 1.0;

  // 阴影射线：从地面点沿太阳方向(指向太阳)打向云顶壳。
  // 注意：Cesium 椭球(≈6378137m)与地形点都位于 Bruneton bottom 球(≈6371860m)外侧，
  // 阴影射线朝太阳(向外)，不会重新进入 bottom 球，故「地球曲面遮挡直射阳光」由上面的
  // horizonFade(昼夜线)承担；低空长阴影的淡出由下面的 lowSunFade / rayLenFade 承担。
  float R = u_cloudShadowBottomRadius;
  float topShellR = R + u_cloudShadowTopHeight;
  vec3 rd = u_sunDirection;
  float bS = dot(rd, rawWorldPosMeters);
  float cTop = dot(rawWorldPosMeters, rawWorldPosMeters) - topShellR * topShellR;
  float discTop = bS * bS - cTop;
  if (discTop <= 0.0) return 1.0; // 射线不与云顶壳相交：云在地球曲面以下不可见
  float distToShadowTop = -bS + sqrt(discTop);
  if (distToShadowTop <= 0.0) return 1.0;

  // 2) 低太阳角阴影衰减：太阳越低，云阴影在地面被拉得越长(掠射 distToShadowTop 巨大)。
  //    按常理这种长阴影应被地球曲面/大气逐步吞没，而非以全强度无限延伸。这里按太阳高度角
  //    与阴影射线长度双重衰减，使日出/日落的长阴影自然淡出，避免天际线处硬条带。
  //    sunSinElev∈[0,0.087](约0°~5°)渐变；射线长度超过 cloudTopHeight*6 时开始衰减。
  float lowSunFade = smoothstep(0.0, 0.087, sunSinElev);
  float rayLenFade = 1.0 - smoothstep(u_cloudShadowTopHeight * 6.0,
                                       u_cloudShadowTopHeight * 20.0,
                                       distToShadowTop);
  float fade = horizonFade * lowSunFade * rayLenFade;
  if (fade <= 0.0) return 1.0;

  float scale = max(u_cloudShadowScale, 1e-6);
  for (int ci = 0; ci < 4; ci++) {
    vec4 clip = u_cloudShadowMatrices[ci] * vec4(rawWorldPosMeters, 1.0);
    clip /= clip.w;
    vec2 uv = clip.xy * 0.5 + 0.5;
    if (uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99) continue;
    vec2 atlasUv = getCloudShadowAtlasOffset(ci) + uv * 0.5;
    vec4 shadow = (texture(u_cloudShadowBuffer, atlasUv) / scale) * u_cloudShadowDecode;
    // 与 three-geospatial readShadowOpticalDepth 对齐：用 distanceToTop 钳制 opticalDepth，
    // 使阴影强度随阴影射线长度衰减(远处云阴影更淡)，而不是恒取 maxOpticalDepth(shadow.b)。
    float opticalDepth = min(shadow.b, shadow.g * max(0.0, distToShadowTop - shadow.r));
    opticalDepth *= max(u_bsmGroundOpticalDepthScale, 0.0);
    float shade = exp(-opticalDepth);
    return mix(1.0, shade, fade);
  }
  return 1.0;
}

void main() {
  vec4 originalColor = texture(colorTexture, v_textureCoordinates);
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  // 非清空深度（用于太空视点的透视兜底，见下）
  const float DEPTH_SKY_EPS = 1e-4;
  bool hasSceneDepth = depth < 1.0 - DEPTH_SKY_EPS;

  vec3 cameraPosition = u_cameraPosition;
  float camRadius = length(cameraPosition);
  vec3 rayDirection;
  reconstructRay(cameraPosition, rayDirection);

  float bottomR = ATMOSPHERE.bottom_radius;
  float topR = ATMOSPHERE.top_radius;
  bool inShell = cameraInAtmosphereShell(cameraPosition, bottomR, topR);
  bool hitBottom = rayForwardHitsSphere(cameraPosition, rayDirection, bottomR);
  bool hitTop = rayForwardHitsSphere(cameraPosition, rayDirection, topR);

  // 地心指向相机的单位向量（ECEF）；视线与其点积：<0 朝地心/地表一侧，>0 朝外（天空/深空）
  // 仅用 hitBottom 会错：Cesium 地表往往在 Bruneton bottom 球之外，斜视时射线可无 bottom 前向交点但仍指向地面 → 误透传原色
  vec3 radialOut = normalize(cameraPosition);
  float muLook = dot(rayDirection, radialOut);

  bool passOriginal = false;
  if (inShell) {
    passOriginal = false;
  } else if (camRadius > topR + 1e-5) {
    // 太空：朝外深空 → 透传；朝地球(mu<0)必做透视，避免仅靠 hitTop 在 grazing 时漏判
    float skyMuEps = 1e-5;
    passOriginal = (muLook > skyMuEps) && !hitTop;
  } else {
    // r <= bottom（地表贴内球或数值在内球内侧）：一律按地面管线处理
    passOriginal = false;
  }

  // 壳层内：完全听 passOriginal（天际线上方 mu>0 常为原色）；天际线附近深度常非 1，若用深度强制透视会把天空染色。
  // 仅当相机在 top 球外（太空）时：深度非空则强制透视，修「太空看地整片原色」。
  bool cameraOutsideAtmosphere = camRadius > topR + 1e-5;
  bool forceAerialFromDepth = hasSceneDepth && cameraOutsideAtmosphere;
  if (passOriginal && !forceAerialFromDepth) {
    out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
    return;
  }

  // 壳层内：与 AtmospherePostProcess 一致用 0.014 宽带，避免相机运动时深度抖动导致误走透视/透传、天际线闪黑。
  if (inShell && !forceAerialFromDepth) {
    const float SHELL_SKY_DEPTH_SLOP = 0.014;
    const float MU_EXPLICIT_GROUND = -0.065;
    bool depthLikelySky = depth >= 1.0 - SHELL_SKY_DEPTH_SLOP;
    bool explicitGround =
      hitBottom || (hasSceneDepth && muLook < MU_EXPLICIT_GROUND);
    if (depthLikelySky && !explicitGround) {
      out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
      return;
    }
  }

  // 重建 ECEF 世界坐标（米），再转 km，得到几何点位置
  vec4 eyePos = czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0));
  if (abs(eyePos.w) < 1e-6) {
    if (!hasSceneDepth) {
      out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
      return;
    }
    // w 异常但深度表明有几何：用当前像素射线与 bottom 球最近前向交点作 scene 近似（太空地表常见）
    float bW = dot(cameraPosition, rayDirection);
    float cW = dot(cameraPosition, cameraPosition) - bottomR * bottomR;
    float discW = bW * bW - cW;
    if (discW < 0.0) {
      out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
      return;
    }
    float sW = sqrt(discW);
    float tHit = -bW - sW;
    if (tHit <= 1e-6) {
      tHit = -bW + sW;
    }
    if (tHit <= 1e-6) {
      out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
      return;
    }
    vec3 scenePosKmApprox = cameraPosition + rayDirection * tHit;
    vec3 transmittanceW;
    vec3 inscatterW = GetSkyRadianceToPoint(
      cameraPosition,
      scenePosKmApprox,
      0.0,
      u_sunDirection,
      transmittanceW
    );
    float sunTW = getGroundSunTransmittance(scenePosKmApprox / METER_TO_LENGTH_UNIT);
    vec3 finalColorW = originalColor.rgb * transmittanceW * sunTW + inscatterW;
    out_FragColor = tonemapDisplay(finalColorW, originalColor.a);
    return;
  }
  eyePos /= eyePos.w;
  if (eyePos.z >= 0.0 && !hasSceneDepth) {
    out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
    return;
  }

  vec3 scenePosKm;
  vec3 rawWorldPosMeters = vec3(0.0);
  if (eyePos.z >= 0.0 && hasSceneDepth) {
    // z>=0 但深度非空：远距/对数深度常见数值问题，眼→世界不可靠，用射线与 bottom 球前向交点作地表锚点
    float bz = dot(cameraPosition, rayDirection);
    float cz = dot(cameraPosition, cameraPosition) - bottomR * bottomR;
    float discz = bz * bz - cz;
    if (discz < 0.0) {
      out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
      return;
    }
    float sz = sqrt(discz);
    float tz = -bz - sz;
    if (tz <= 1e-6) {
      tz = -bz + sz;
    }
    if (tz <= 1e-6) {
      out_FragColor = tonemapDisplay(originalColor.rgb, originalColor.a);
      return;
    }
    scenePosKm = cameraPosition + rayDirection * tz;
  } else {
    vec4 worldPos4 = czm_inverseView * eyePos;
    rawWorldPosMeters = worldPos4.xyz;
    vec3 sceneWorldPosKm = rawWorldPosMeters * METER_TO_LENGTH_UNIT + u_altitudeCorrection;
    float sceneDist = length(sceneWorldPosKm - cameraPosition);
    scenePosKm = cameraPosition + rayDirection * sceneDist;
  }
  float shadowLength = 0.0;
  if (u_cloudShadowLengthEnabled > 0) {
    shadowLength = max(texture(u_cloudShadowLengthTexture, v_textureCoordinates).r, 0.0)
      * max(u_cloudShadowLengthScale, 0.0);
  }

  vec3 transmittance;
  vec3 inscatter = GetSkyRadianceToPoint(
    cameraPosition,
    scenePosKm,
    shadowLength,
    u_sunDirection,
    transmittance
  );

  vec3 rawForBSM;
  if (eyePos.z >= 0.0 && hasSceneDepth) {
    rawForBSM = scenePosKm / METER_TO_LENGTH_UNIT;
  } else {
    rawForBSM = rawWorldPosMeters;
  }
  float sunT = getGroundSunTransmittance(rawForBSM);
  vec3 finalColor = originalColor.rgb * transmittance * sunT + inscatter;

  out_FragColor = tonemapDisplay(finalColor, originalColor.a);
}

