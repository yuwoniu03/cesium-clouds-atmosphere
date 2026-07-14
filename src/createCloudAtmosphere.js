import { ThreeGeospatialPipeline } from "./ThreeGeospatialPipeline.js";
import { AtmosphereParameters } from "./AtmosphereFromThreeGeospatial/AtmosphereParameters.js";
import { resolveAssetPaths } from "./assetPaths.js";

/**
 * 一行创建并初始化体积云 + 大气管线（推荐入口）。
 *
 * 默认使用 jsDelivr CDN 加载纹理/LUT，shader 使用内联 bundle，无需手动复制静态资源。
 *
 * @param {Cesium.Viewer} viewer
 * @param {object} [options] - 透传给 ThreeGeospatialPipeline，额外支持：
 * @param {import('./assetPaths.js').ResolveAssetPathsOptions} [options.assets] - 资源路径配置，默认 { mode: 'cdn' }
 * @param {AtmosphereParameters} [options.atmosphereParams]
 * @returns {Promise<ThreeGeospatialPipeline>}
 *
 * @example
 * const pipeline = await createCloudAtmosphere(viewer);
 *
 * @example
 * // 本地开发（仓库根目录直接跑）
 * const pipeline = await createCloudAtmosphere(viewer, { assets: { mode: 'local' } });
 */
export async function createCloudAtmosphere(viewer, options = {}) {
  const { assets: assetOptions, atmosphereParams, ...pipelineOptions } = options;
  const paths = resolveAssetPaths(assetOptions);

  const pipeline = new ThreeGeospatialPipeline(viewer, {
    atmosphereParams: atmosphereParams ?? new AtmosphereParameters(),
    ...paths,
    ...pipelineOptions,
  });

  await pipeline.init();
  return pipeline;
}
