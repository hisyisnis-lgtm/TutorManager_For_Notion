/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'system-ui', '-apple-system', 'sans-serif'],
        kjc: ['KimjungchulGothic', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fff0f1',
          100: '#ffd6d8',
          400: '#b8000a',
          500: '#9b0008',
          600: '#7f0005',
          700: '#620004',
        },
      },
    },
  },
  plugins: [],
};
