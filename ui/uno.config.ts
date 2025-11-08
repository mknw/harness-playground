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
        lexend: 'Lexend Zetta:200',
        lexend_exa: 'Lexend Exa:200'
      }
    })
  ],
  transformers: [
    transformerAttributifyJsx(), // <--
  ],
  theme: {
    colors: {
      // Futuristic dark theme palette
      'cyber': {
        50: '#f0f4ff',
        100: '#e0e7ff',
        200: '#c7d7fe',
        300: '#a5b4fc',
        400: '#818cf8',
        500: '#6366f1',
        600: '#4f46e5',
        700: '#4338ca',
        800: '#3730a3',
        900: '#312e81',
        950: '#1e1b4b',
      },
      'neon': {
        cyan: '#00ffff',
        magenta: '#ff00ff',
        green: '#39ff14',
        orange: '#ff6600',
        purple: '#9d00ff',
        blue: '#0080ff',
        pink: '#ff007f',
      },
      'dark': {
        bg: {
          primary: '#0a0a0f',
          secondary: '#12121a',
          tertiary: '#1a1a24',
          hover: '#22222f',
        },
        border: {
          primary: '#2a2a3a',
          secondary: '#3a3a4a',
          accent: '#4a4a5a',
        },
        text: {
          primary: '#e4e4e7',
          secondary: '#a1a1aa',
          tertiary: '#71717a',
        }
      }
    }
  },
  shortcuts: {
    // Futuristic UI shortcuts
    'glass-panel': 'bg-dark-bg-secondary/50 backdrop-blur-lg border border-dark-border-primary',
    'neon-border': 'border-2 border-neon-cyan shadow-[0_0_10px_rgba(0,255,255,0.5)]',
    'cyber-button': 'bg-cyber-700 hover:bg-cyber-600 text-white font-medium px-4 py-2 rounded-md transition-all duration-200 hover:shadow-[0_0_15px_rgba(79,70,229,0.5)]',
  }
})
