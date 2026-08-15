import { useEffect } from 'react';
import { LevaWrapper, useDeviceDetection } from '@core';
import { ExperienceCanvas } from './ExperienceCanvas';
import { isDebugRoute } from '../core/debugRoute';
import { useExperienceStore } from '../core/experienceStore';
import { useExperienceReady } from '../core/useExperienceReady';
import { ChapterIntro } from '../ui/chapterIntro/ChapterIntro';
import { CHAPTER_CONTENT } from '../ui/chapterIntro/chapterContent';

export default function App() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const setStarted = useExperienceStore((state) => state.setStarted);
  const gpuError = useExperienceStore((state) => state.gpuError);
  const setGpuError = useExperienceStore((state) => state.setGpuError);
  const setIsMobile = useExperienceStore((state) => state.setIsMobile);
  const isMobile = useDeviceDetection();
  const { status } = useExperienceReady();

  useEffect(() => {
    setIsMobile(isMobile);
  }, [isMobile, setIsMobile]);

  useEffect(() => {
    const checkWebGPU = async () => {
      if (!navigator.gpu) {
        setGpuError('WEBGPU NOT SUPPORTED');
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          setGpuError('NO GPU ADAPTER FOUND');
        }
      } catch {
        setGpuError('GPU INIT FAILED');
      }
    };
    checkWebGPU();
  }, [setGpuError]);

  return (
    <>
      <LevaWrapper />

      {!isStarted && !isDebugRoute() && (
        <ChapterIntro
          chapter={CHAPTER_CONTENT.chapter}
          title={CHAPTER_CONTENT.title}
          paragraphs={CHAPTER_CONTENT.paragraphs}
          interactionHint={CHAPTER_CONTENT.interactionHint}
          ctaLabel={CHAPTER_CONTENT.ctaLabel}
          loadingLabel={CHAPTER_CONTENT.loadingLabel}
          isMobile={isMobile}
          status={status}
          onExited={() => setStarted(true)}
        />
      )}

      {!gpuError && <ExperienceCanvas />}
    </>
  );
}
