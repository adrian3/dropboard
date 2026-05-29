import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "tailwindcss";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const projectRoot = resolve(root, "..");

const tailwindCssFiles = {
  tailwindcss: resolve(root, "node_modules/tailwindcss/index.css"),
  "tailwindcss/preflight": resolve(root, "node_modules/tailwindcss/preflight.css"),
  "tailwindcss/theme": resolve(root, "node_modules/tailwindcss/theme.css"),
  "tailwindcss/utilities": resolve(root, "node_modules/tailwindcss/utilities.css")
};

export async function generateDropboardStyles() {
  const sourceModule = await import(pathToFileURL(resolve(projectRoot, "src/dropboardTailwind.js")).href);
  const { dropboardTailwindCandidates, dropboardTailwindSource } = sourceModule;

  const compiled = await compile(dropboardTailwindSource, {
    from: resolve(projectRoot, "src/dropboard.tailwind.css"),
    async loadStylesheet(id) {
      const path = tailwindCssFiles[id];
      if (!path) {
        throw new Error(`Unsupported Tailwind stylesheet import: ${id}`);
      }
      return {
        content: await readFile(path, "utf8"),
        base: dirname(path)
      };
    }
  });

  const css = compiled.build(dropboardTailwindCandidates);
  const escaped = JSON.stringify(css);
  const out = `export const dropboardStyles = ${escaped};\n`;
  await writeFile(resolve(projectRoot, "src/dropboardStyles.js"), out, "utf8");
  return css;
}
