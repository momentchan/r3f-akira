import { useEffect } from 'react';
import { toggleSimPause } from './simSpeed';

function onKeyDown(event) {
  if (event.code !== 'Space' || event.repeat) return;

  const activeElement = document.activeElement;
  const tag = activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || activeElement?.isContentEditable) {
    return;
  }

  event.preventDefault();
  toggleSimPause();
}

/** Space zeros getSimSpeed() so field and climb stop together. */
export function useLifecyclePauseHotkey() {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
