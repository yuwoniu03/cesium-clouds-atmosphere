/**
 * cesium-clouds-atmosphere demo 入口。
 *
 * 运行：npm install && npm run demo
 * 注意要把cesium ion的token放上去 不然底图和地形加载不了 ！！！
 */

import {
  createCloudAtmosphere,
  LensFlareBloomStage,
} from "../src/index.js";

const Cesium = window.Cesium;

//这里换上自己的 token ！！！！
Cesium.Ion.defaultAccessToken =
  ""; 


const viewer = new Cesium.Viewer("cesiumContainer", {
  // terrain: Cesium.Terrain.fromWorldTerrain(), // 暂时不要地形了，不然远处的云在地形没加载完时会抖动，还没解决
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: true, 
  timeline: true, 
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  skyBox: false, // 关闭自带天空盒
  skyAtmosphere: false, // 关闭自带大气
  requestRenderMode: false, 
});


viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(116.0, 40.0, 30000), // 北京上空约 30km（云层上方）
  orientation: {
    heading: 0.0,
    pitch: -Cesium.Math.PI_OVER_TWO * 0.4, 
    roll: 0.0,
  },
});

//    创建云 + 大气 + 空中透视 + BSM + TAA + dat.gui 面板
//    demo 页面在 /demo/ 子目录，库默认的相对路径会相对 /demo/ 解析而 404，
//    因此显式传入以 "/" 开头的根相对路径，直接对应仓库根下的真实资源布局，
//    完全离线 fetch 本地纹理/LUT，不依赖外网 CDN。
try {
  const pipeline = await createCloudAtmosphere(viewer, {
    cloudsAssetsBase: "/public/clouds-assets/",
    brunetonShaderBase:
      "/src/AtmosphereFromThreeGeospatial/Shaders/bruneton/",
    blueNoiseUrl: "/public/data/noisePic/noisergba256.png",
    atmosphereAssetsBase: "/src/AtmosphereFromThreeGeospatial/assets/",
    atmosphereShaderBase: "/src/AtmosphereFromThreeGeospatial/Shaders/",
  });

  const lensFlare = new LensFlareBloomStage(viewer, {
    bloomIntensity: 0.05,
    ghostIntensity: 1.1,
    haloIntensity: 0.2,
  });
  lensFlare.init();

  // ── AgX Tone Mapping（管线最末端，对齐 three 原版 ToneMappingEffect(mode=AGX)）──
  // 逐行移植 three.js AgXToneMapping：
  // three.js/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js
  const agxStage = new Cesium.PostProcessStage({
    name: 'AgXToneMapping',
    fragmentShader: `
      uniform sampler2D colorTexture;
      uniform float u_exposure;
      in vec2 v_textureCoordinates;

      const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
        vec3(0.627403895934699, 0.069097289358232, 0.016391438875150),
        vec3(0.329283038377884, 0.919540189075459, 0.088013308657226),
        vec3(0.043313065687417, 0.011362521566309, 0.895595252467624)
      );
      const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
        vec3(1.660051002331074, -0.124550290301414, -0.018150706354685),
        vec3(-0.587480138524133, 1.132899897077961, -0.100578909194128),
        vec3(-0.072570863806942, -0.008349606776546, 1.118729615548812)
      );
      const mat3 AgXInsetMatrix = mat3(
        vec3(0.856627153315983, 0.137318645929070, 0.111898212964095),
        vec3(0.095121240538159, 0.761241990602591, 0.076799418603190),
        vec3(0.048251606145858, 0.101439036467562, 0.811302368396859)
      );
      const mat3 AgXOutsetMatrix = mat3(
        vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
        vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
        vec3(-0.016493938717834573, -0.016493938717834895, 1.2519364065950405)
      );
      const float AgxMinEv = -12.47393;
      const float AgxMaxEv = 4.026069;

      vec3 agxDefaultContrastApprox(vec3 x) {
        vec3 x2 = x * x;
        vec3 x4 = x2 * x2;
        return + 15.5   * x4 * x2
               - 40.14  * x4 * x
               + 31.96  * x4
               - 6.868  * x2 * x
               + 0.4298 * x2
               + 0.1191 * x
               - 0.00232;
      }

      vec3 AgXToneMapping(vec3 color) {
        color *= u_exposure;                          // toneMappingExposure
        color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
        color = AgXInsetMatrix * color;
        color = max(color, 1e-10);
        color = log2(color);
        color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
        color = clamp(color, 0.0, 1.0);
        color = agxDefaultContrastApprox(color);
        color = AgXOutsetMatrix * color;
        color = pow(max(color, vec3(0.0)), vec3(2.2)); // "Linearize"
        color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
        return clamp(color, 0.0, 1.0);
      }

      // 线性 → sRGB 显示编码（对齐 postprocessing EffectPass 的 encodeOutput）
      vec3 sRGBEncode(vec3 c) {
        return mix(c * 12.92,
                   1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
                   step(vec3(0.0031308), c));
      }

      void main() {
        vec4 texel = texture(colorTexture, v_textureCoordinates);
        vec3 color = sRGBEncode(AgXToneMapping(texel.rgb));
        // dither：消除暗部色带（对齐 three 管线最后的 DitheringEffect）
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        color += (n - 0.5) / 255.0;
        out_FragColor = vec4(color, texel.a);
      }
    `,
    uniforms: {
      u_exposure: 10.0, // 对齐 three storybook 的 toneMappingExposure = 10
    },
  });
  viewer.scene.postProcessStages.add(agxStage);

  console.log("[demo] 云 + 大气管线就绪");

  window.__pipeline = pipeline;
  window.__lensFlare = lensFlare;
  window.__agxStage = agxStage;
  window.__viewer = viewer;
} catch (err) {
  console.error("[demo] 管线初始化失败：", err);
}

