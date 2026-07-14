import { defineConfig } from "vite";

/**
 * Demo 的 dev server 配置。
 *
 * 关键点：
 *  - root: "."  以仓库根为 serve 根，保证库 local 模式下 fetch 的相对路径
 *    (./public/... 与 ./src/AtmosphereFromThreeGeospatial/assets/...) 能直接命中真实文件。
 *  - publicDir: false  关闭 Vite 默认 publicDir，避免把 public/ 做特殊路径映射；
 *    public/ 仍按普通静态目录由根目录提供。
 *  - optimizeDeps.include  预构建 three / dat.gui，确保库源码里的 bare import 在 dev 下立即可解析。
 */
export default defineConfig({
  root: ".",
  publicDir: false,
  server: {
    open: "/demo/index.html",
    port: 5173,
    fs: {
      // 允许 serve 仓库根下的所有文件（含 src/ 下的 .bin LUT 与 public/ 下的纹理）
      allow: ["."],
    },
  },
  optimizeDeps: {
    include: ["three", "dat.gui"],
  },
});
