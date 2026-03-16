import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        stone: {
          950: "#0e0d0c",
          900: "#1a1917",
          850: "#201f1c",
          800: "#2a2926",
          700: "#3d3b37",
          600: "#5a5751",
          500: "#7a766e",
          400: "#9e9a90",
          300: "#bfbab0",
          200: "#d9d4ca",
          100: "#eee9e0",
          50:  "#f7f4ef",
        },
        gold: {
          DEFAULT: "#c8a96e",
          light: "#dfc28e",
          dark: "#a68a4e",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Georgia", "serif"],
      },
      animation: {
        "spin-slow": "spin 2s linear infinite",
        "pulse-subtle": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
