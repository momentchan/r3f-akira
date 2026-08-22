import gsap from 'gsap';
import * as THREE from 'three/webgpu';
import { SCENE_THEMES, THEME_FADE } from './sceneDefaults';

const light = SCENE_THEMES.light;

const live = {
  bg: new THREE.Color(light.bgColor),
  audio: new THREE.Color(light.audioColor),
  silkTint: new THREE.Color(light.silkTint),
  silkTintStrength: light.silkTintStrength,
};

let tween;

export function getLiveThemeColors() {
  return live;
}

export function tweenThemeTo(theme) {
  const pal = SCENE_THEMES[theme];
  const bg = new THREE.Color(pal.bgColor);
  const audio = new THREE.Color(pal.audioColor);
  const silk = new THREE.Color(pal.silkTint);
  const ease = 'power2.inOut';

  tween?.kill();
  tween = gsap.timeline({ overwrite: true });
  tween.to(live.bg, { r: bg.r, g: bg.g, b: bg.b, duration: THEME_FADE, ease }, 0);
  tween.to(live.audio, { r: audio.r, g: audio.g, b: audio.b, duration: THEME_FADE, ease }, 0);
  tween.to(live.silkTint, { r: silk.r, g: silk.g, b: silk.b, duration: THEME_FADE, ease }, 0);
  tween.to(live, { silkTintStrength: pal.silkTintStrength, duration: THEME_FADE, ease }, 0);

  return tween;
}
