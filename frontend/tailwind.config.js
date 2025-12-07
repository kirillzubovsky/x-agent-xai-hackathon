/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'x-black': '#000000',
        'x-white': '#FFFFFF',
        'x-gray': '#71767B',
        'x-blue': '#1D9BF0',
        'x-dark': '#15202B',
        'x-border': '#2F3336',
      }
    },
  },
  plugins: [],
}