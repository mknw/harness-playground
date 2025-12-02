import { defineConfig } from "@solidjs/start/config";
import UnoCSS from "unocss/vite";
import presetWind4 from "@unocss/preset-wind4";
import { presetAttributify, transformerAttributifyJsx } from "unocss";

export default defineConfig({
  vite: {
    plugins: [
      UnoCSS({
        presets: [presetWind4(), presetAttributify()],
        transformers: [
          transformerAttributifyJsx()
        ]
      }),
    ],
    // Externalize WebAssembly-based packages for SSR (they only work client-side)
    // ssr: {
    //   external: ['solid-markdown-wasm'],
    //   noExternal: []
    // },
    // build: {
    //   rollupOptions: {
    //     external: ['solid-markdown-wasm']
    //   }
    // }
  }
});
