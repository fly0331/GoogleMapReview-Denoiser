/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lumora: {
          paper: "#FCFBF8",
          ink: "#20201E",
          muted: "#686862",
          iris: "#6941A5",
          sage: "#526B54",
          ochre: "#94602D",
          error: "#913F39",
          border: "#E6E3DD",
        },
      },
    },
  },
  plugins: [],
};
