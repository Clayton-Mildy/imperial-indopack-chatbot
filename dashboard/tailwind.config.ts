import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand tokens (docs/superpowers/designs/Brand.dc.html) plus the UI tints the screen
        // designs use. Inline styles use the same hex values.
        brand: {
          leaf: "#88B44E",
          olive: "#586B34",
          lime: "#ADCF6D",
          pale: "#F5F8F2",
          charcoal: "#252C30",
          sage: "#B0B9AE",
          gold: "#C49A3C",
          "gold-deep": "#8A6A2A",
          page: "#F2F5EF",
          sidebar: "#F8FAF6",
          line: "#E1E7DC",
          ink: "#1F2421",
          muted: "#5F6B5A",
          link: "#445428",
        },
        primary: {
          50: "#F5F8F2",
          100: "#EAF2DD",
          400: "#ADCF6D",
          500: "#88B44E",
          600: "#6C9442",
          700: "#586B34",
          800: "#445428",
          900: "#252C30",
        },
        slate: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          500: "#64748B",
          700: "#1F1F1F",
          900: "#0A0A0A",
        },
        success: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          600: "#16A34A",
          700: "#15803D",
        },
        warning: {
          50: "#FFFBEB",
          100: "#FEF3C7",
          600: "#D97706",
          700: "#B45309",
        },
        error: {
          50: "#FFF1F2",
          100: "#FEE2E2",
          600: "#DC2626",
          700: "#B91C1C",
        },
        info: {
          50: "#F0F9FF",
          100: "#E0F2FE",
          600: "#0284C7",
          700: "#0369A1",
        },
      },
      fontFamily: {
        sans: ["Open Sans", "Arial", "system-ui", "sans-serif"],
        heading: ["Montserrat", "Arial", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      spacing: {
        sidebar: "240px",
        header: "56px",
      },
      maxWidth: {
        content: "1200px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        DEFAULT: "0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)",
        md: "0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)",
        lg: "0 10px 15px rgba(0,0,0,0.10), 0 4px 6px rgba(0,0,0,0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
