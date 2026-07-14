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
  terrain: Cesium.Terrain.fromWorldTerrain(), // 全球地形
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
    bloomIntensity: 0.6,
    ghostIntensity: 1.1,
    haloIntensity: 0.2,
  });
  lensFlare.init();

  console.log("[demo] 云 + 大气管线就绪");

  window.__pipeline = pipeline;
  window.__lensFlare = lensFlare;
  window.__viewer = viewer;
} catch (err) {
  console.error("[demo] 管线初始化失败：", err);
}

