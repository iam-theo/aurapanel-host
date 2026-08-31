/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: '#131519',
          sidebar: '#1a1d24',
          card: '#1e2128',
          cardHover: '#252830',
          border: '#2a2d35',
          text: '#e4e7ec',
          muted: '#8b8f9a',
          accent: '#6c5ce7',
          accentLight: '#a29bfe',
          green: '#00b894',
          yellow: '#fdcb6e',
          red: '#e17055',
          blue: '#74b9ff',
          purple: '#a29bfe',
          orange: '#e17055',
        }
      }
    },
  },
  plugins: [],
}
