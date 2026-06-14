import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Etesia palette — sampled from the June 2026 pitch deck (measured hex,
      // see FORNADAR 2026-06-10). Semantic mapping: positive PnL / long =
      // accent, negative PnL / short = negative — never generic green/red.
      colors: {
        bg: "#0E1F23",
        surface: "#1A2A2E",
        ink: "#E8EFEF",
        accent: "#3DA5B0",
        brand: "#125862",
        negative: "#A74F39",
        muted: "#92B0B3",
        faint: "#466267",
        cream: "#F5F3ED",
        sage: "#E5E8E3",
        border: "#243A40",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      backgroundImage: {
        // CTA gradient: Cushion-style pill, Etesia palette — brand → accent
        // interpolation (4 stops, same structure as the Cushion original).
        cta: "linear-gradient(90deg, #125862 0%, #21737D 35%, #2E8994 64%, #3DA5B0 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
