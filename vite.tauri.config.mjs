import { defineConfig } from "vite"
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import path from "node:path"

export default defineConfig({
    root: ".",
    publicDir: "public",
    plugins: [svelte({ configFile: false, compilerOptions: { hmr: false, compatibility: { componentApi: 4 } }, preprocess: vitePreprocess(), onwarn(warning, handler) { if (!warning.code.startsWith("a11y_") && !warning.code.startsWith("a11y-")) handler(warning) } })],
    resolve: { dedupe: ["svelte"], alias: { "/src": path.resolve("src") } },
    optimizeDeps: { entries: ["index.html"] },
    server: { host: "127.0.0.1", port: 3000, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/tauri-test-output/**", "**/dist-local/**", "**/dist-tauri/**"] } },
    build: { outDir: "dist-tauri", emptyOutDir: true, target: "esnext" },
    clearScreen: false
})
