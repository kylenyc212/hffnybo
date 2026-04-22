/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#b91c1c', dark: '#7f1d1d' }
      }
    }
  },
  plugins: []
};
