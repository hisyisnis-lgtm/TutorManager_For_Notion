import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { NAV, CONSULT_URL, CHANNELS } from '../config.js';

// DS2/헤더 — overlay(히어로 위 투명·흰 글자) ↔ solid(흰 배경). 스크롤 40px 넘으면 solid.
// React를 쓰는 이유: 스크롤 상태 전환 + 모바일 전체 메뉴 시트(포커스·ESC·스크롤 잠금).
export default function Header({ active = '', overlay = false, dark = false }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlay]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!open) { if (menu.open) menu.close(); return; }
    menu.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onResize = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', onResize);
    return () => { document.body.style.overflow = prev; desktop.removeEventListener('change', onResize); };
  }, [open]);

  const solid = !overlay || scrolled;
  const logo = solid && !dark ? '/logo/logo-red.png' : '/logo/logo-white.png';

  return (
    <>
      <header className={`header ${solid ? 'header--solid' : 'header--overlay'}`}>
        <div className="container header__inner">
          <a className="header__logo" href="/" aria-label="하늘하늘 중국어 홈">
            <img src={logo} alt="하늘하늘 중국어" width="177" height="26" />
          </a>
          <nav className="header__nav t-nav" aria-label="주 메뉴">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} aria-current={active === n.href ? 'page' : undefined}>{n.label}</a>
            ))}
          </nav>
          <a className={`header__util btn btn--md ${solid && !dark ? 'btn--filled-ink' : 'btn--filled-white'}`} href={CONSULT_URL} aria-current={active === CONSULT_URL ? 'page' : undefined}>
            <span>상담 신청</span>
            <Icon name="caretRight" size={16} />
          </a>
          <button className="header__menu" type="button" aria-label="메뉴 열기" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(true)}>
            <Icon name="list" size={24} />
          </button>
        </div>
      </header>
      {!overlay && <div className="header__spacer" aria-hidden="true" />}

        <dialog ref={menuRef} id="site-menu" className="sheet" aria-label="메뉴" onClose={() => setOpen(false)} onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const controls = e.currentTarget.querySelectorAll('a[href], button');
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}>
          <div className="sheet__top">
            <img src={dark ? '/logo/logo-white.png' : '/logo/logo-red.png'} alt="하늘하늘 중국어" width="150" height="22" />
            <button className="header__menu" type="button" aria-label="메뉴 닫기" onClick={() => setOpen(false)}>
              <Icon name="x" size={22} />
            </button>
          </div>
          <a className="sheet__consult btn btn--md btn--filled-ink" href={CONSULT_URL} aria-current={active === CONSULT_URL ? 'page' : undefined}>상담 신청 <Icon name="caretRight" size={16} /></a>
          <nav className="sheet__nav" aria-label="모바일 메뉴">
            <a href="/" aria-current={active === '/' ? 'page' : undefined}>홈 <Icon name="caretRight" size={16} /></a>
            {NAV.map((n) => (
              <a key={n.href} href={n.href} aria-current={active === n.href ? 'page' : undefined}>{n.label} <Icon name="caretRight" size={16} /></a>
            ))}
          </nav>
          <div className="sheet__util">
            <p className="t-label muted">하늘쌤 채널</p>
            <div className="sheet__social">
              {[['instagram', CHANNELS.instagram, '인스타그램'], ['youtube', CHANNELS.youtube, '유튜브'], ['article', CHANNELS.blog, '네이버 블로그'], ['chat', CHANNELS.kakao, '카카오 채널']].map(([icon, href, label]) => (
                <a key={icon} className="icircle icircle--36" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (새 창)`}>
                  <Icon name={icon} size={18} />
                </a>
              ))}
            </div>
          </div>
        </dialog>
    </>
  );
}
