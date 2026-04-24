import { defineConfig } from "@solidjs/start/config";
import UnoCSS from "unocss/vite";
import presetWind4 from "@unocss/preset-wind4";
import { presetAttributify, transformerAttributifyJsx } from "unocss";
import devtools from 'solid-devtools/vite'

export default defineConfig({
  vite: {
    server: {
      allowedHosts: ['host.docker.internal'],
    },
    plugins: [
      UnoCSS({
        presets: [presetWind4(), presetAttributify()],
        transformers: [
          transformerAttributifyJsx()
        ]
      }),
      devtools({
        autoname: true,
      })
    ],
  }
});
