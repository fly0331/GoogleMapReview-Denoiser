/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lumora: {
          midnight: "#0F172A",
          violet: "#8B5CF6",
          lavender: "#C4B5FD",
          cloud: "#F8FAFC",
          action: "#7C3AED",
          secondary: "#64748B",
          border: "#E2E8F0",
        },
      },
    },
  },
  plugins: [],
};
