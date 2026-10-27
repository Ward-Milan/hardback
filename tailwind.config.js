/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "SFMono-Regular",
          "ui-monospace",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        notion: {
          bg: "#FFFFFF",
          sidebar: "#F7F7F5",
          hover: "#EFEFED",
          border: "#E9E9E7",
          text: "#37352F",
          muted: "#787774",
          subtle: "#9B9A97",
          accent: "#2383E2",
          success: "#0F7B6C",
          warning: "#D9730D",
          danger: "#E03E3E",
        },
      },
    },
  },
  plugins: [],
};

