import { defineConfig, presetAttributify, presetWebFonts , transformerAttributifyJsx  } from 'unocss'
// import transformerAttributifyJsx from '@unocss/transformer-attributify-jsx'

import presetWind4 from '@unocss/preset-wind4'

export default defineConfig({
  presets: [
    presetAttributify(),
    presetWind4(),
    presetWebFonts({
      provider: 'google',
      fonts: {
        sans: 'Inter',
        serif: 'Roboto Slab',
        mono: 'Fira Code',
      }
    })
  ],
  transformers: [
    transformerAttributifyJsx(), // <--
  ],
})
