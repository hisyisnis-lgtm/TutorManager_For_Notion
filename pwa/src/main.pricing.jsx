import React from 'react';
import ReactDOM from 'react-dom/client';
import PricingPage from './pages/PricingPage.jsx';
import './index.css';

// 공유받은 사람이 여는 독립 안내 페이지. 앱 인증·라우터·서비스워커를 로드하지 않는다.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PricingPage />
  </React.StrictMode>
);
