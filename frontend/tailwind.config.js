/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware palette: values resolve from CSS variables so a single
        // `light` class on <html> switches the whole UI between dark/light.
        // Variables hold "R G B" triplets; <alpha-value> keeps /opacity working.
        panel: {
          bg: 'rgb(var(--panel-bg) / <alpha-value>)',
          sidebar: 'rgb(var(--panel-sidebar) / <alpha-value>)',
          card: 'rgb(var(--panel-card) / <alpha-value>)',
          cardHover: 'rgb(var(--panel-cardHover) / <alpha-value>)',
          border: 'rgb(var(--panel-border) / <alpha-value>)',
          text: 'rgb(var(--panel-text) / <alpha-value>)',
          muted: 'rgb(var(--panel-muted) / <alpha-value>)',
          accent: 'rgb(var(--panel-accent) / <alpha-value>)',
          accentLight: 'rgb(var(--panel-accentLight) / <alpha-value>)',
          green: 'rgb(var(--panel-green) / <alpha-value>)',
          yellow: 'rgb(var(--panel-yellow) / <alpha-value>)',
          red: 'rgb(var(--panel-red) / <alpha-value>)',
          blue: 'rgb(var(--panel-blue) / <alpha-value>)',
          purple: 'rgb(var(--panel-purple) / <alpha-value>)',
          orange: 'rgb(var(--panel-orange) / <alpha-value>)',
        }
      }
    },
  },
  plugins: [],
}
