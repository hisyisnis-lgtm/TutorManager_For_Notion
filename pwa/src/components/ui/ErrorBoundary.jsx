import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // errorReporter가 자동 캡처하지만 React 에러는 ErrorEvent로 안 잡히므로 직접 dispatch
    try {
      const message = `[React] ${error?.message || 'Unknown error'}`;
      window.dispatchEvent(new ErrorEvent('error', {
        error,
        message,
        filename: info?.componentStack?.split('\n')[1]?.trim() || '',
      }));
    } catch {
      // 무시 — 보고 실패가 보고를 막으면 안 됨
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, background: '#f9fafb',
      }}>
        <div style={{
          maxWidth: 400, width: '100%', background: '#fff', borderRadius: 16, padding: 24,
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center',
        }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1d1d1f', margin: '0 0 8px' }}>
            화면 표시 중 문제가 발생했어요
          </h2>
          <p style={{ fontSize: 13, color: '#595959', margin: '0 0 16px', wordBreak: 'break-all' }}>
            {this.state.error?.message || '알 수 없는 오류'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              width: '100%', height: 44, borderRadius: 12, background: '#7f0005',
              border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }
}
