import { useCallback, useEffect, useState } from 'react';
import { CHAPTER_CONTENT } from './chapterContent';
import './chapterIntro.css';

export function ChapterIntro({
  chapter = CHAPTER_CONTENT.chapter,
  title = CHAPTER_CONTENT.title,
  paragraphs = CHAPTER_CONTENT.paragraphs,
  interactionHint = CHAPTER_CONTENT.interactionHint,
  ctaLabel = CHAPTER_CONTENT.ctaLabel,
  loadingLabel = CHAPTER_CONTENT.loadingLabel,
  isMobile = false,
  status,
  onEnter,
  onExited,
}) {
  const [isExiting, setIsExiting] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    return () => window.removeEventListener('resize', checkOrientation);
  }, []);

  const handleEnter = useCallback(() => {
    if (!status?.isReady || status.error || isExiting) return;
    setIsExiting(true);
    onEnter?.();
  }, [status, isExiting, onEnter]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
      if (event.repeat) return;
      handleEnter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleEnter]);

  const handleTransitionEnd = useCallback(
    (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.propertyName !== 'opacity') return;
      if (!isExiting) return;
      onExited?.();
    },
    [isExiting, onExited],
  );

  const isMobileLandscape = isMobile && isLandscape;
  const className = [
    'chapter-intro',
    isExiting ? 'chapter-intro--exiting' : '',
    isMobile ? 'chapter-intro--mobile' : '',
    isMobileLandscape ? 'chapter-intro--landscape' : '',
  ]
    .filter(Boolean)
    .join(' ');

  let ctaText = loadingLabel;
  let ctaModifier = '';
  if (status?.error) {
    ctaText = 'SYSTEM INCOMPATIBLE';
    ctaModifier = 'chapter-intro__cta--error';
  } else if (status?.isReady) {
    ctaText = ctaLabel;
    ctaModifier = 'chapter-intro__cta--ready';
  }

  return (
    <div className={className} onTransitionEnd={handleTransitionEnd}>
      <div className="chapter-intro__entry">
        <div className="chapter-intro__copy">
          {chapter ? <div className="chapter-intro__chapter">{chapter}</div> : null}
          <div className="chapter-intro__title">{title}</div>
          <div className="chapter-intro__narrative">
            {paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        </div>

        <div className="chapter-intro__actions">
          <button
            type="button"
            className={`chapter-intro__cta ${ctaModifier}`.trim()}
            onClick={handleEnter}
            disabled={!status?.isReady || Boolean(status?.error) || isExiting}
          >
            {ctaText}
          </button>
          {interactionHint ? (
            <div className="chapter-intro__hint">{interactionHint}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
