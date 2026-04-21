import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0a0a0f",
          1: "#12121a",
          2: "#1a1a26",
          3: "#232333",
        },
        accent: {
          DEFAULT: "#6366f1",
          hover: "#818cf8",
          muted: "#4f46e5",
        },
        text: {
          primary: "#e2e8f0",
          secondary: "#94a3b8",
          muted: "#64748b",
        },
        border: {
          DEFAULT: "#1e293b",
          hover: "#334155",
        },
        status: {
          online: "#22c55e",
          offline: "#64748b",
          error: "#ef4444",
        },
      },
      fontWeight: {
        "medium-bold": "530",
      },
      fontSize: {
        xs:   ["0.867rem",  { lineHeight: "1.333rem" }], // 13px @ 15px base
        sm:   ["1rem",      { lineHeight: "1.467rem" }], // 15px @ 15px base
        base: ["1.133rem",  { lineHeight: "1.6rem"   }], // 17px @ 15px base
        lg:   ["1.267rem",  { lineHeight: "1.867rem" }], // 19px @ 15px base
        xl:   ["1.4rem",    { lineHeight: "2rem"     }], // 21px @ 15px base
      },
      fontFamily: {
        sans: ["Inter Variable", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        fadeIn: "fadeIn 0.3s ease-out forwards",
        fadeOut: "fadeOut 0.25s ease-in forwards",
        spin: "spin 0.8s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeOut: {
          "0%": { opacity: "1", transform: "translateX(0) translateY(0)" },
          "100%": { opacity: "0", transform: "translateX(6px) translateY(0)" },
        },
      },
      transitionDuration: {
        "400": "400ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
