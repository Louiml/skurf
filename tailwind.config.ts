import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#9fe870", active: "#cdffad", neutral: "#c5edab", pale: "#e2f6d5" },
        "on-primary": "#0e0f0c",
        ink: { DEFAULT: "#0e0f0c", deep: "#163300" },
        body: "#454745",
        mute: "#868685",
        canvas: { DEFAULT: "#ffffff", soft: "#e8ebe6" },
        positive: { DEFAULT: "#2ead4b", deep: "#054d28" },
        warning: { DEFAULT: "#ffd11a", deep: "#b86700", content: "#4a3b1c" },
        negative: {
          DEFAULT: "#d03238",
          deep: "#a72027",
          darkest: "#a7000d",
          bg: "#320707",
        },
        accent: { orange: "#ffc091", cyan: "#38c8ff" },
      },
      borderRadius: {
        none: "0px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "32px",
        pill: "9999px",
        full: "9999px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      typography: { DEFAULT: { css: { maxWidth: "none" } } },
    },
  },
  plugins: [],
}
export default config
