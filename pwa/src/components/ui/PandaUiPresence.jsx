import { cloneElement, useLayoutEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';

// Only transient Panda notices need a retained DOM node. Dialogs use Radix Presence.
export default function PandaUiPresence({ children }) {
  const reducedMotion = usePrefersReducedMotion();
  const [retained, setRetained] = useState(children);
  const nodeRef = useRef(null);
  const present = Boolean(children);
  const presentRef = useRef(present);

  useLayoutEffect(() => {
    presentRef.current = present;
    if (children) { setRetained(children); return undefined; }
    if (!retained) return undefined;
    const style = nodeRef.current && window.getComputedStyle(nodeRef.current);
    const milliseconds = value => value.trim().endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
    const durations = (style?.transitionDuration || '0s').split(',').map(milliseconds);
    const delays = (style?.transitionDelay || '0s').split(',').map(milliseconds);
    // Read the actual CSS duration, so reduced motion and token changes cannot leave a stale timer.
    const duration = style?.transitionProperty && style.transitionProperty !== 'none'
      ? Math.max(0, ...durations.map((time, index) => time + (delays[index % delays.length] || 0))) : 0;
    if (reducedMotion || !duration) { setRetained(null); return undefined; }
    const timer = setTimeout(() => setRetained(null), duration);
    return () => clearTimeout(timer);
  }, [children, present, retained, reducedMotion]);

  const child = children || retained;
  if (!child || (!present && reducedMotion)) return null;
  return cloneElement(child, {
    ref: nodeRef,
    'data-state': present ? 'open' : 'closed',
    'aria-hidden': present ? undefined : true,
    inert: present ? undefined : '',
    role: present ? child.props.role : undefined,
    onTransitionEnd: event => {
      if (event.target === event.currentTarget && event.propertyName === 'opacity' && !presentRef.current) setRetained(null);
    },
  });
}
