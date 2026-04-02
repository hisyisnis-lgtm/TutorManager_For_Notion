import { Tag } from 'antd';
import { PRIMARY } from '../../constants/theme';

export default function SectionLabel({ children }) {
  return (
    <Tag style={{
      backgroundColor: 'rgba(127,0,5,0.08)', color: PRIMARY,
      border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700,
      marginBottom: 10, letterSpacing: '0.05em', padding: '2px 10px',
    }}>
      {children}
    </Tag>
  );
}
