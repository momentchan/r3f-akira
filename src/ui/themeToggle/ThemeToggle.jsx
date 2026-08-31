import { useExperienceStore } from '../../core/experienceStore';

export function ThemeToggle() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const flowIntroDone = useExperienceStore((state) => state.flowIntroDone);
  const theme = useExperienceStore((state) => state.theme);
  const setTheme = useExperienceStore((state) => state.setTheme);

  if (!isStarted) return null;

  const visible = flowIntroDone;
  const isDark = theme === 'dark';

  return (
    <div
      className={
        visible
          ? 'hud-control-row hud-control-row--deferred hud-control-row--deferred--visible theme-toggle'
          : 'hud-control-row hud-control-row--deferred theme-toggle'
      }
      role="group"
      aria-label="Theme"
      aria-hidden={!visible}
    >
      <span className="hud-control-row__title">THEME</span>
      <div className="hud-control-row__options">
        <button
          type="button"
          className={isDark ? 'hud-control-row__mode' : 'hud-control-row__mode hud-control-row__mode--on'}
          aria-pressed={!isDark}
          tabIndex={visible ? 0 : -1}
          onClick={() => setTheme('light')}
        >
          LIGHT
        </button>
        <span className="hud-control-row__rule" />
        <button
          type="button"
          className={isDark ? 'hud-control-row__mode hud-control-row__mode--on' : 'hud-control-row__mode'}
          aria-pressed={isDark}
          tabIndex={visible ? 0 : -1}
          onClick={() => setTheme('dark')}
        >
          DARK
        </button>
      </div>
    </div>
  );
}
