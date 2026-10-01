/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./application/**/*.{ts,tsx}",
    "./infrastructure/**/*.{ts,tsx}",
    "./interfaces/**/*.{ts,tsx}",
  ],
  theme: {
    fontFamily: {
      sans: ["var(--font-body)"],
    },
    extend: {
      colors: {
        background: "rgb(var(--color-background) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        surfaceHighlight: "rgb(var(--color-surface-highlight) / <alpha-value>)",
        border: "rgb(var(--color-border) / var(--border-opacity))",
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        primaryHover: "rgb(var(--color-primary-hover) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        label: "rgb(var(--color-label) / <alpha-value>)",
        labelSecondary: "rgb(var(--color-label-secondary) / <alpha-value>)",
        labelTertiary: "rgb(var(--color-label-tertiary) / <alpha-value>)",
        fill: "rgb(var(--color-fill) / <alpha-value>)",
        onPrimary: "rgb(var(--color-on-primary) / <alpha-value>)",
        accentText: "rgb(var(--color-accent-text) / <alpha-value>)",
        dangerText: "rgb(var(--color-danger-text) / <alpha-value>)",
        warningText: "rgb(var(--color-warning-text) / <alpha-value>)",
        successText: "rgb(var(--color-success-text) / <alpha-value>)",
        infoText: "rgb(var(--color-info-text) / <alpha-value>)",
        tile: "var(--tile)",
        scrim: "var(--scrim)",
        track: "var(--track)",
        overlay: "rgb(var(--color-overlay) / <alpha-value>)",
        borderStrong: "rgb(var(--color-border) / var(--border-opacity-strong))",
      },
      spacing: {
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
      },
      boxShadow: {
        pop: "var(--shadow-pop)",
        toast: "var(--shadow-toast)",
        footer: "var(--shadow-footer)",
        glow: "var(--shadow-glow)",
        row: "var(--shadow-row)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
