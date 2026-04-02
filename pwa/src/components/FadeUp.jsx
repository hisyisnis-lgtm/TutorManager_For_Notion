import { useInView } from '../hooks/useInView';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

export default function FadeUp({ children, delay = 0, style = {} }) {
  const [ref, inView] = useInView();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div ref={ref} style={{
      opacity: reducedMotion || inView ? 1 : 0,
      transform: reducedMotion || inView ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.99)',
      filter: reducedMotion || inView ? 'blur(0px)' : 'blur(4px)',
      transition: reducedMotion ? 'none' : `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms, filter 0.5s ease ${delay}ms`,
      ...style,
    }}>
      {children}
    </div>
  );
}
