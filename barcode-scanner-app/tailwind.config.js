/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "surface-container-highest": "var(--color-surface-container-highest)",
                "secondary-fixed": "#d9e2ff",
                "on-tertiary": "#ffffff",
                "on-tertiary-fixed-variant": "#7b2e12",
                "on-primary-container": "var(--color-on-primary-container)",
                "on-tertiary-fixed": "#390c00",
                "background": "var(--color-surface)",
                "inverse-surface": "#2f3132",
                "secondary-fixed-dim": "#b0c6ff",
                "secondary-container": "var(--color-secondary)",
                "primary": "var(--color-primary)",
                "outline-variant": "var(--color-outline-variant)",
                "on-primary": "var(--color-on-primary)",
                "primary-fixed-dim": "#bdc2ff",
                "on-background": "var(--color-on-surface)",
                "tertiary-fixed-dim": "#ffb59d",
                "on-error": "var(--color-on-error)",
                "surface-container-high": "var(--color-surface-container-high)",
                "secondary": "var(--color-secondary)",
                "surface": "var(--color-surface)",
                "inverse-on-surface": "#f0f0f2",
                "on-surface-variant": "var(--color-on-surface-variant)",
                "surface-bright": "var(--color-surface)",
                "on-primary-fixed": "var(--color-on-primary-container)",
                "on-secondary-fixed": "var(--color-on-secondary)",
                "surface-container-lowest": "var(--color-surface-container-lowest)",
                "surface-variant": "var(--color-surface-container-highest)",
                "tertiary-fixed": "#ffdbd0",
                "on-secondary-container": "#fefcff",
                "on-primary-fixed-variant": "#343d96",
                "primary-container": "var(--color-primary-container)",
                "surface-container-low": "var(--color-surface-container-low)",
                "surface-dim": "#d9dadc",
                "on-surface": "var(--color-on-surface)",
                "on-tertiary-container": "#e17c5a",
                "primary-fixed": "#e0e0ff",
                "error-container": "#ffdad6",
                "on-secondary": "var(--color-on-secondary)",
                "on-secondary-fixed-variant": "#00429b",
                "tertiary-container": "#5c1800",
                "error": "var(--color-error)",
                "success": "#22c55e",
                "surface-container": "var(--color-surface-container)",
                "on-error-container": "#93000a",
                "tertiary": "#380b00",
                "inverse-primary": "#bdc2ff",
                "surface-tint": "#4c56af",
                "outline": "#767683"
            },
            borderRadius: {
                "DEFAULT": "1rem",
                "lg": "2rem",
                "xl": "3rem",
                "full": "9999px"
            },
            fontFamily: {
                "headline": ["Manrope", "sans-serif"],
                "body": ["Inter", "sans-serif"],
                "label": ["Inter", "sans-serif"]
            }
        }
    },
    plugins: [],
  }
