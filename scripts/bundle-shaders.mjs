/**
 * 将 Shaders/ 下的 GLSL 内联为 JS 模块，供浏览器直接使用，无需运行时 fetch。
 * 运行：node scripts/bundle-shaders.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shadersRoot = join(
  __dirname,
  "../src/AtmosphereFromThreeGeospatial/Shaders"
);

const files = [
  "bruneton/definitions.glsl",
  "bruneton/common.glsl",
  "bruneton/runtime.glsl",
  "sky.glsl",
  "aerialPerspectiveEffect.frag",
];

const entries = files.map((name) => {
  const source = readFileSync(join(shadersRoot, name), "utf8");
  return `  ${JSON.stringify(name)}: ${JSON.stringify(source)},`;
});

const output = `/**
 * 自动生成的内联 shader 模块，请勿手动编辑。
 * 重新生成：node scripts/bundle-shaders.mjs
 */

/** @type {Readonly<Record<string, string>>} */
export const BUNDLED_SHADERS = {
${entries.join("\n")}
};
`;

const outDir = join(__dirname, "../src/shaders");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "bundledShaders.js"), output);
console.log("bundledShaders.js generated");
