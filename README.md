# cesium-clouds-atmosphere

基于 **Cesium** 的体积云 + Bruneton 大气 + 空中透视 + 镜头光晕一体化渲染库。

> ## 📌 来源声明
>
> 本库的**体积云与大气渲染实现**改编自开源项目
> [**three-geospatial**](https://github.com/takram-design-engineering/three-geospatial)
> （作者：takram-design-engineering，MIT License）。
>
> 原项目使用 **three.js + React** 实现上述渲染。本库将其移植为**纯 Cesium**
> 的实现形式：
> - 大气：基于 Bruneton 预计算 LUT（transmittance / irradiance / scattering /
>   single Mie / higher-order scattering）的 `Cesium.PostProcessStage`。
> - 体积云：`Cesium.PostProcessStage` 内的 raymarch，复用同一套大气 LUT。
> - 云地面投影 / 丁达尔：通过**原生 WebGL** 的 Beer Shadow Map（BSM）级联实现。
> - 时域抗锯齿（TAA）：原生 WebGL PBO 双缓冲。
>
> 详见 [LICENSE](./LICENSE)。

## 特性

- ☁️ **体积云 raymarch**：多层云、形状/细节 3D 纹理、weather 图驱动覆盖、湍流位移、风力/演化、远处天际线衰减。
- 🌫️ **Beer Shadow Map（BSM）**：4 级联正交阴影，实现**云在地面投影**与**丁达尔光束**；与大气/空中透视共享同一份 shadow buffer。
- 🌅 **Bruneton 预计算大气**：天空 + 太阳圆盘 + 与场景几何合成；曝光可随仿真时间（太阳高度角）在白天/夜晚间插值。
- 📐 **空中透视（Aerial Perspective）**：基于几何前向半直线交点判定的体积大气散射，可单独作用于几何像素，避免与天空 pass 双重叠加。
- ✨ **镜头光晕泛光（Lens Flare Bloom）**：bloom + ghost + halo。
- 🎛️ **dat.gui 调参面板**：运行时可视化调试云密度、阴影、曝光、光晕等参数。

## 依赖

| 依赖 | 说明 |
|---|---|
| **Cesium** | 本库使用的Cesium版本是 **1.132** 。 |
| **three** | 仅在 `loadBinThreeGeospatial.js` 中用于把 `.bin` 解析为 `Data3DTexture`（解析阶段不涉及 Cesium）。 |
| **dat.gui** | 运行时调参面板。 |

## 目录结构

```
cesium-clouds-atmosphere/
├─ src/
│  ├─ index.js                         # 统一出口
│  ├─ ThreeGeospatialPipeline.js       # 主入口：云 + 大气 + 空中透视一体化编排
│  ├─ CloudShadowPass.js               # BSM 渲染 pass（动态 import）
│  ├─ ShadowResolvePass.js             # BSM 时域 resolve pass（动态 import）
│  ├─ CloudShadowFrag.glsl.js          # BSM fragment 源（ES import）
│  ├─ loadBinThreeGeospatial.js        # .bin → Data3DTexture 解析（three）
│  └─ AtmosphereFromThreeGeospatial/
│     ├─ AtmosphereParameters.js       # 大气参数与预计算常量
│     ├─ AtmospherePostProcess.js      # 天空 / 大气后处理
│     ├─ AerialPerspectiveEffect.js    # 空中透视后处理
│     ├─ PrecomputedTexturesLoader.js  # .bin LUT → Cesium 纹理
│     ├─ AtmosphereForClouds.js        # 大气对体积云的接口常量
│     ├─ LensFlareBloomStage.js        # 镜头光晕泛光
│     ├─ Shaders/                      # 运行时 fetch 的 GLSL
│     │  ├─ bruneton/{definitions,common,runtime}.glsl
│     │  ├─ sky.glsl
│     │  └─ aerialPerspectiveEffect.frag
│     └─ assets/                       # 运行时 fetch 的大气 LUT（.bin）
│        ├─ transmittance.bin
│        ├─ irradiance.bin
│        ├─ scattering.bin
│        ├─ single_mie_scattering.bin
│        └─ higher_order_scattering.bin
└─ public/                             # 运行时 fetch 的体积云纹理
   ├─ clouds-assets/                   # shape.bin / shape_detail.bin / stbn.bin / local_weather.png / turbulence.png
   └─ data/noisePic/noisergba256.png   # 蓝噪声
```

> **关于 shader 加载方式**：除 `CloudShadowFrag.glsl.js` 是通过 ES `import` 加载外，
> 其余 `.glsl` / `.frag` 均在运行时通过 `fetch()` 加载并字符串拼接为单个 fragment 源
> （precision 头 + `#define` + definitions + common + runtime + main）。
> 因此 `src/AtmosphereFromThreeGeospatial/Shaders/` 与 `assets/` 必须部署在可被 fetch 的路径下。

## 渲染管线顺序

（取自 `ThreeGeospatialPipeline.js` 顶部注释，与 three-geospatial 对齐）

1. **PostProcessStage**：体积云 raymarch（含 BSM 采样、shadowLength、haze）。
2. **PostProcessStage**：`AtmospherePostProcess` 天空。
3. **PostProcessStage**：`AerialPerspectiveEffect` 几何透视 + tonemap。

其中 BSM（Beer Shadow Map）与 TAA 通过**原生 WebGL** 在 `preRender` / `postRender` 执行；
BSM 数据通过 `setCloudShadow` 同步到大气与 Aerial 两侧，实现丁达尔与地面云影。

## 快速开始
### 开始之前请申请好自己的Cesium ion Token 然后放到main.js的 这里Cesium.Ion.defaultAccessToken ="你的token"

### 运行 demo（clone 即跑）

```bash
npm install
npm run demo
```

浏览器会自动打开 `http://localhost:5173/demo/index.html`，即可看到体积云 + Bruneton 大气 +
空中透视 + 镜头光晕的完整效果，右上 dat.gui 面板可实时调参。

- demo 用 Cesium 1.132（CDN 全局引入，无需 ion token，离线地球）。
- 云纹理 / 大气 LUT 直接 fetch 仓库内的 `public/` 与 `src/AtmosphereFromThreeGeospatial/assets/`。
- demo 入口见 [`demo/main.js`](./demo/main.js)：核心就一行 `createCloudAtmosphere(viewer, {...})`。

### 在自己的项目中使用

```js
import {
  ThreeGeospatialPipeline,
  LensFlareBloomStage,
  AtmosphereParameters,
} from "cesium-clouds-atmosphere";

// 前置条件：viewer 已创建，且 window.Cesium 全局可用。
// 建议关闭 Cesium 自带天空盒/大气，交由本库接管：
//   new Cesium.Viewer("map", { skyBox: false, skyAtmosphere: false });

const atmosphereParams = new AtmosphereParameters();

// 3) 组合管线：体积云 + 大气 + 空中透视
const pipeline = new ThreeGeospatialPipeline(viewer, { atmosphereParams });
await pipeline.init();

const lensFlare = new LensFlareBloomStage(viewer, {
  bloomIntensity: 0.6,
  ghostIntensity: 1.1,
  haloIntensity: 0.2,
});
lensFlare.init();
```

## 资源路径配置

为使本库可在任意部署路径下使用，**所有运行时 fetch 的资源根路径均为可配置**，
并带有面向本库默认目录结构的相对路径默认值（相对宿主页面 base）。

`ThreeGeospatialPipeline` 支持的构造 `options`：

| 选项 | 默认值 | 用途 |
|---|---|---|
| `cloudsAssetsBase` | `"./public/clouds-assets/"` | 体积云纹理目录（shape/stbn/local_weather/turbulence） |
| `brunetonShaderBase` | `"./src/AtmosphereFromThreeGeospatial/Shaders/bruneton/"` | Bruneton `definitions/common/runtime.glsl` 目录 |
| `blueNoiseUrl` | `"./public/data/noisePic/noisergba256.png"` | 蓝噪声图 URL |
| `atmosphereAssetsBase` | `"./src/AtmosphereFromThreeGeospatial/assets/"` | 大气 LUT `.bin` 目录（透传给 AtmospherePostProcess / AerialPerspectiveEffect） |
| `atmosphereShaderBase` | `"./src/AtmosphereFromThreeGeospatial/Shaders/"` | `sky.glsl` / `aerialPerspectiveEffect.frag` 等目录（透传） |

若你的资源部署在与默认值不同的位置（例如打包后资源在 `/assets/clouds/` 下），
只需在构造时覆盖对应选项即可：

```js
const pipeline = new ThreeGeospatialPipeline(viewer, {
  atmosphereParams,
  cloudsAssetsBase: "/assets/clouds/",
  atmosphereAssetsBase: "/assets/atmosphere/",
  atmosphereShaderBase: "/assets/atmosphere/shaders/",
});
```

`AtmospherePostProcess` 与 `AerialPerspectiveEffect` 也各自支持
`assetsBaseUrl` / `shaderBaseUrl` 选项，便于独立使用（不经过 Pipeline）。

> ⚠️ 由于 shader 与 LUT 在运行时通过相对 URL `fetch`，请确保宿主页面 base 下
> 能解析到这些路径（典型做法：把本库 `src/` 与 `public/` 作为静态资源发布，
> 或在 Vite/Webpack 中配置 `publicDir` / `copy` 插件把它们复制到产物根目录）。


## 演示视频
https://www.bilibili.com/video/BV184NQ65Ei7/?vd_source=773b21781ece9bf7d32824e31d11a418
## License

MIT — 详见 [LICENSE](./LICENSE)。

体积云与大气渲染的实现来源于开源项目
[three-geospatial](https://github.com/takram-design-engineering/three-geospatial)
（MIT License, Copyright © takram-design-engineering），在此致谢。
