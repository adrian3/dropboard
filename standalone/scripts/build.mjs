import { build } from "esbuild";
import { mkdir, writeFile, cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const projectRoot = resolve(root, "..");
const dist = resolve(root, "dist");

await mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, "src/main.jsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari16", "chrome110"],
  write: false,
  alias: {
    // Keep the standalone bundle on the same React instance as the shared core.
    react: resolve(projectRoot, "node_modules/react/index.js"),
    "react-dom/client": resolve(projectRoot, "node_modules/react-dom/client.js")
  },
  loader: { ".jsx": "jsx", ".js": "jsx" }
});

const js = result.outputFiles[0].text;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DropBoard</title>
</head>
<body>
  <div id="root"></div>
  <script>${js}</script>
</body>
</html>
`;

await writeFile(resolve(root, "DropBoard.html"), html, "utf8");
await writeFile(resolve(dist, "DropBoard.html"), html, "utf8");
await cp(resolve(root, "dropboard.default.json"), resolve(dist, "dropboard.default.json"));
await cp(resolve(root, "Start DropBoard.command"), resolve(dist, "Start DropBoard.command"));
await cp(resolve(root, "dropboard_server.py"), resolve(dist, "dropboard_server.py"));

console.log("Built DropBoard.html and copied runtime files to dist/");
