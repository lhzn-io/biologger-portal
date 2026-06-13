export default {
  content: [
    "./app/index.html",
    "./app/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Space Grotesk', 'sans-serif'],
        mono: ['Space Grotesk', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
