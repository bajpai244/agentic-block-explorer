import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101418",
        moss: "#49633f",
        acid: "#b7f26d",
        paper: "#f7f7f2",
      },
    },
  },
  plugins: [],
};

export default config;
