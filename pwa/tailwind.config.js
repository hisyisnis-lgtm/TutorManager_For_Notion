import animate from "tailwindcss-animate";

/**
 * ⚠️ `npx shadcn@latest add <name>`이 **이 파일을 재포맷하며 주석을 지운다**(2026-08-28 실제 발생).
 *    CLI를 돌린 뒤에는 아래 항목이 살아있는지 확인할 것:
 *      · brand 스케일 (35개 파일이 brand-* 로 참조 중 — 건드리면 안 됨)
 *      · primary/secondary/muted/accent/destructive + warning/success (theme.js 토큰의 HSL 변환값)
 *      · borderRadius lg/md/sm (= --radius 12 기준)
 *      · collapsible 키프레임
 *    또 CLI가 `darkMode: ['class']`를 추가하는데, 이 앱은 **라이트 전용**이라 지운다.
 */
/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: [
  				'Pretendard',
  				'system-ui',
  				'-apple-system',
  				'sans-serif'
  			],
  			kjc: [
  				'KimjungchulGothic',
  				'Pretendard',
  				'system-ui',
  				'sans-serif'
  			]
  		},
  		colors: {
  			// brand 스케일 — 35개 파일이 brand-* 로 참조 중. 항목을 지우지 말 것.
  			// 값은 constants/theme.js가 단일 출처다(2026-08-30 통일 — 그 전엔 500/700이 손복사로 어긋나 있었다).
  			brand: {
  				'50': '#fff0f1',  // = PRIMARY_BG
  				'100': '#ffd6d8', // theme.js에 대응 토큰 없음 (연한 면 확장)
  				'400': '#b8000a', // theme.js에 대응 토큰 없음 (밝은 강조 확장)
  				'500': '#9a0007', // = PRIMARY_LIGHT
  				'600': '#7f0005', // = PRIMARY
  				'700': '#6b0004'  // = PRIMARY_DARK
  			},
  			border: 'hsl(var(--border) / <alpha-value>)',
  			input: 'hsl(var(--input) / <alpha-value>)',
  			ring: 'hsl(var(--ring) / <alpha-value>)',
  			background: 'hsl(var(--background) / <alpha-value>)',
  			foreground: 'hsl(var(--foreground) / <alpha-value>)',
  			primary: {
  				DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
  				foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
  				dark: 'hsl(var(--primary-dark) / <alpha-value>)'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
  				foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
  				foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
  				bg: 'hsl(var(--destructive-bg) / <alpha-value>)',
  				border: 'hsl(var(--destructive-border) / <alpha-value>)'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning-fg) / <alpha-value>)',
  				bg: 'hsl(var(--warning-bg) / <alpha-value>)',
  				border: 'hsl(var(--warning-border) / <alpha-value>)'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success-fg) / <alpha-value>)',
  				bg: 'hsl(var(--success-bg) / <alpha-value>)',
  				border: 'hsl(var(--success-border) / <alpha-value>)'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
  				foreground: 'hsl(var(--muted-foreground) / <alpha-value>)'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
  				foreground: 'hsl(var(--accent-foreground) / <alpha-value>)'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
  				foreground: 'hsl(var(--popover-foreground) / <alpha-value>)'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card) / <alpha-value>)',
  				foreground: 'hsl(var(--card-foreground) / <alpha-value>)'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'collapsible-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-collapsible-content-height)'
  				}
  			},
  			'collapsible-up': {
  				from: {
  					height: 'var(--radix-collapsible-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'collapsible-down': 'collapsible-down 0.2s cubic-bezier(0.2, 0, 0, 1)',
  			'collapsible-up': 'collapsible-up 0.2s cubic-bezier(0.2, 0, 0, 1)',
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [animate],
};
