import { useExperienceStore } from '../../core/experienceStore';
import { useShortcut } from '@core/hooks/useShortcut';
import './themeToggle.css';

export function ThemeToggle() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const theme = useExperienceStore((state) => state.theme);
  const setTheme = useExperienceStore((state) => state.setTheme);

  useShortcut('d', () => {
    if (!useExperienceStore.getState().isStarted) return;
    setTheme(useExperienceStore.getState().theme === 'dark' ? 'light' : 'dark');
  });

  if (!isStarted) return null;

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={isDark ? 'Switch to light background' : 'Switch to dark background'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <span className={isDark ? 'theme-toggle__mode' : 'theme-toggle__mode theme-toggle__mode--on'}>
        LIGHT
      </span>
      <span className="theme-toggle__rule" />
      <span className={isDark ? 'theme-toggle__mode theme-toggle__mode--on' : 'theme-toggle__mode'}>
        DARK
      </span>
    </button>
  );
}
