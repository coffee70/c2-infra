/**
 * Copy Cesium static assets from node_modules to public/cesium at build time.
 * Keeps the repo from tracking 392+ vendored files and ensures assets match the installed cesium version.
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const source = path.join(projectRoot, "node_modules", "cesium", "Build", "Cesium");
const dest = path.join(projectRoot, "public", "cesium");

if (!fs.existsSync(source)) {
  console.warn("copy-cesium: source not found (run npm install first):", source);
  process.exit(0);
}

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true });
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(source, dest, { recursive: true });
console.log("copy-cesium: copied", source, "->", dest);
