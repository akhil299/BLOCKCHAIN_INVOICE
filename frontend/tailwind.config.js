/** Design tokens: deep navy ink, cool paper, one teal signal colour, semantic risk colours. */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: { DEFAULT: "#0A1B3D", 900: "#071430", 800: "#0D2250", 700: "#14306B", 600: "#1E4290", 500: "#3A5FA8" },
        paper: { DEFAULT: "#F3F6FB", 100: "#EAEFF8", 200: "#DCE4F2" },
        signal: { DEFAULT: "#12B5A6", 600: "#0E9488", 100: "#D6F4F1", 50: "#EBFAF8" },
        risk: { low: "#12A150", medium: "#D98E04", high: "#D6455D" },
        line: "#D9E1EF",
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,27,61,.05), 0 4px 16px -6px rgba(10,27,61,.08)",
        pop: "0 12px 40px -12px rgba(10,27,61,.35)",
      },
      borderRadius: { xl2: "1.1rem" },
    },
  },
  plugins: [],
};
