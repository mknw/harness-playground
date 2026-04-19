import { defineConfig, presetAttributify, presetWebFonts , transformerAttributifyJsx  } from 'unocss'
// import transformerAttributifyJsx from '@unocss/transformer-attributify-jsx'

import presetWind4 from '@unocss/preset-wind4'
import presetIcons from '@unocss/preset-icons'

export default defineConfig({
  presets: [
    presetAttributify(),
    presetWind4(),
    presetIcons({
      scale: 1.2,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
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
  },
  // Custom CSS for markdown rendering
  preflights: [
    {
      getCSS: () => `
        .prose-chat {
          line-height: 1.6;
          word-wrap: break-word;
        }
        .prose-chat p {
          margin: 0.5em 0;
        }
        .prose-chat p:first-child {
          margin-top: 0;
        }
        .prose-chat p:last-child {
          margin-bottom: 0;
        }
        .prose-chat code {
          background: rgba(0,255,255,0.1);
          padding: 0.2em 0.4em;
          border-radius: 4px;
          font-family: 'Fira Code', monospace;
          font-size: 0.9em;
        }
        .prose-chat pre {
          background: #0a0a0f;
          padding: 1em;
          border-radius: 8px;
          overflow-x: auto;
          margin: 0.75em 0;
          border: 1px solid #2a2a3a;
        }
        .prose-chat pre code {
          background: transparent;
          padding: 0;
          border-radius: 0;
        }
        .prose-chat ul, .prose-chat ol {
          margin: 0.5em 0;
          padding-left: 1.5em;
        }
        .prose-chat li {
          margin: 0.25em 0;
        }
        .prose-chat strong {
          color: #00ffff;
          font-weight: 600;
        }
        .prose-chat em {
          font-style: italic;
        }
        .prose-chat a {
          color: #00ffff;
          text-decoration: underline;
        }
        .prose-chat blockquote {
          border-left: 3px solid #4f46e5;
          padding-left: 1em;
          margin: 0.75em 0;
          color: #a1a1aa;
        }
        .prose-chat h1, .prose-chat h2, .prose-chat h3 {
          font-weight: 600;
          margin: 1em 0 0.5em;
        }
        .prose-chat h1 { font-size: 1.25em; }
        .prose-chat h2 { font-size: 1.15em; }
        .prose-chat h3 { font-size: 1.05em; }

        /* Graph entity interactive spans in chat messages */
        .graph-entity {
          cursor: pointer;
          border-bottom: 1px dashed rgba(0,255,255,0.4);
          transition: all 0.15s ease;
          border-radius: 2px;
          padding: 0 2px;
        }
        .graph-entity:hover {
          background: rgba(0,255,255,0.15);
          border-bottom-color: #00ffff;
          color: #00ffff;
        }
        .graph-entity.toggled {
          background: rgba(0,255,255,0.2);
          border-bottom: 1px solid #00ffff;
          color: #00ffff;
        }
      `
    }
  ]
})
