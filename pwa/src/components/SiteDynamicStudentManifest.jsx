import { useEffect } from 'react';

// 모든 기기에서 회원 로그인으로 복귀한다. 개인 코드나 scope를 설치 주소에 넣지 않는다.
export default function SiteDynamicStudentManifest() {
  useEffect(() => {
    let link = document.querySelector('link[rel="manifest"]');
    const created = !link;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    const previous = link.getAttribute('href');
    link.setAttribute('href', '/personal/manifest.webmanifest');
    return () => {
      if (created) link.remove();
      else if (previous === null) link.removeAttribute('href');
      else link.setAttribute('href', previous);
    };
  }, []);
  return null;
}
