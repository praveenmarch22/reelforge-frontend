// Theme taken from the Stitch design system ("Synthetic Cinema"): near-black background,
// frosted glass surfaces, violet to cyan accent gradient, Space Grotesk + Inter.

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {DEFAULT: '#07070B', 800: '#0D0D14', 700: '#13131C', 600: '#1B1B27'},
        violet: {DEFAULT: '#7C5CFF', soft: '#A594FF'},
        cyan: {DEFAULT: '#22D3EE'},
        line: 'rgba(255,255,255,0.08)',
        muted: '#9A9AB5',
        ok: '#34D399',
        warn: '#FBBF24',
        bad: '#F87171',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        brand: 'linear-gradient(90deg, #7C5CFF 0%, #22D3EE 100%)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,92,255,0.35), 0 8px 40px -8px rgba(124,92,255,0.45)',
        card: '0 20px 60px -20px rgba(0,0,0,0.7)',
      },
      borderRadius: {xl2: '1.25rem'},
      keyframes: {
        float: {'0%,100%': {transform: 'translateY(0)'}, '50%': {transform: 'translateY(-10px)'}},
        shimmer: {'0%': {backgroundPosition: '-200% 0'}, '100%': {backgroundPosition: '200% 0'}},
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
      },
    },
  },
  plugins: [],
};
