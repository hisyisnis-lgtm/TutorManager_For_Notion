/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#FFF0F1',
          100: '#FFD6D8',
          400: '#C20013',
          500: '#A30010',
          600: '#830009',
          700: '#640007',
        },
      },
    },
  },
  plugins: [],
};
