# 博文系列：用写作消化 three-geospatial → Cesium 大气/体积云

本目录是学习型写作材料，对应仓库 [`cesium-clouds-atmosphere`](../../) 与对照源码 [`three-geospatial/packages`](../../../three-geospatial-main/packages)。

## 已锁定方案：**8 篇完整版**

不采用 5 篇精简合并（除非后续时间不够再裁剪）。理由：BSM、云密度、云光照、空中透视各自足够一篇；合并后容易再次囫囵吞枣。

| 编号 | 标题 | 文稿 |
|------|------|------|
| P1 | 总览：为什么是后处理管线 | [01-pipeline-overview.md](./01-pipeline-overview.md) |
| P2 | Bruneton LUT | （待写） |
| P3 | 天空渲染 | （待写） |
| P4 | 空中透视与 tonemap | （待写） |
| P5 | 体积云密度场 | （待写） |
| P6 | 云光照与 raymarch | （待写） |
| P7 | BSM、丁达尔、地形抖动 | （待写） |
| P8 | 移植合路与工程坑 | （待写） |

- [系列大纲（锁定）](./00-series-outline.md)
- [对照阅读清单](./reading-map.md)

## 每篇固定模板

1. 现象 / 目标截图  
2. 概念（少公式，多直觉）  
3. three-geospatial 侧关键路径  
4. Cesium 侧映射与差异  
5. 一个小实验（改 GUI 参数）  
6. 本篇遗留问题 → 下一篇  
