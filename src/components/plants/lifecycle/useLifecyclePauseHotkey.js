import { useEffect } from 'react';

const lifecyclePausedRef = { current: false };
let subscriberCount = 0;

function onKeyDown(event) {
  if (event.code !== 'Space' || event.repeat) return;

  const activeElement = document.activeElement;
  const tag = activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || activeElement?.isContentEditable) {
    return;
  }

  event.preventDefault();
  lifecyclePausedRef.current = !lifecyclePausedRef.current;
}

/** Shared Space-key pause state for every mounted plant lifecycle system. */
export function useLifecyclePauseHotkey() {
  useEffect(() => {
    subscriberCount += 1;
    if (subscriberCount === 1) window.addEventListener('keydown', onKeyDown);

    return () => {
      subscriberCount -= 1;
      if (subscriberCount === 0) window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return lifecyclePausedRef;
}
