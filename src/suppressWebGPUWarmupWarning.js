// three.js's WebGPU backend logs a "THREE.No pipeline set." console.error while it
// lazily compiles a render/shadow pipeline on first use. Shadow-map pipelines in
// particular can't be precompiled (renderer.compileAsync only covers the color
// passes), so a shadow caster logs this once on its first shadow render — the
// pipeline then finishes compiling and every subsequent frame draws correctly.
//
// It's a harmless one-time warmup message, so drop ONLY that exact string. Every
// other console.error (real bugs, crashes) passes straight through.
const originalError = console.error;
console.error = function (...args) {
  if (typeof args[0] === 'string' && args[0].includes('No pipeline set')) return;
  return originalError.apply(this, args);
};
