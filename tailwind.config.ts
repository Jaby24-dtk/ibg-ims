import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0F172A',
          800: '#1E293B',
          700: '#334155',
          600: '#475569',
        },
        charcoal: '#111827',
        teal: {
          DEFAULT: '#2FA6B8',
          dark: '#1E7A8A',
          light: '#4BC4D8',
        },
        cyan: {
          accent: '#38BDF8',
        },
        brand: {
          bg: '#F8FAFC',
          success: '#22C55E',
          warning: '#F59E0B',
          danger: '#EF4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '8px',
        lg: '16px',
        xl: '20px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.07)',
        'card-hover': '0 4px 6px -1px rgba(0,0,0,0.10), 0 2px 4px -2px rgba(0,0,0,0.10)',
        modal: '0 20px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.10)',
      },
    },
  },
  plugins: [],
}

export default config
