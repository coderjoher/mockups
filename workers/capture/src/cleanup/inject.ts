// Page-side helpers injected into every capture. Kept as strings so they run inside the page unchanged
// (bundlers/tsx would otherwise add helpers such as __name that do not exist in the page).

/** CE-5: runs before any page script. setInterval-driven carousels never advance; everything else freezes on demand. */
export const FREEZE_INIT = `(() => {
  let frozen = false;
  const nativeSetInterval = window.setInterval;
  window.setInterval = function (fn, ms, ...args) {
    return nativeSetInterval.call(window, function () {}, ms);
  };
  const nativeSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    if (typeof fn !== 'function') return nativeSetTimeout.call(window, fn, ms, ...args);
    return nativeSetTimeout.call(window, function (...a) { if (!frozen) return fn.apply(this, a); }, ms, ...args);
  };
  const nativeRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    return nativeRaf.call(window, function (t) { if (!frozen) cb(t); });
  };
  Object.defineProperty(window, '__mockupFreeze', {
    value: () => {
      frozen = true;
      document.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); m.currentTime = 0; } catch (e) {} });
      (document.getAnimations ? document.getAnimations() : []).forEach((a) => { try { a.finish(); } catch (e) { try { a.pause(); } catch (e2) {} } });
    },
  });
})();`;

/** CE-5: the PRD's "animation and transition durations to zero". */
export const FREEZE_CSS = `*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
  transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}
html, body { scroll-behavior: auto !important; }`;

export function hideCss(selectors: string[]): string {
  if (!selectors.length) return '';
  return `${selectors.join(',\n')} { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }
html, body { overflow: visible !important; }
html.no-scroll, body.no-scroll, body.modal-open, body.overflow-hidden { overflow: visible !important; }`;
}

/** CE-4: hides modal overlays the blocklist does not know (large fixed layers, open modal dialogs). */
export const HIDE_GENERIC_OVERLAYS = `(() => {
  const vw = innerWidth, vh = innerHeight;
  let hidden = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const modal = el.matches('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]');
    const isHeader = r.top <= 1 && r.height < vh * 0.3 && r.width >= vw * 0.9;
    if (!isHeader && (modal || area >= vw * vh * 0.4)) {
      el.style.setProperty('display', 'none', 'important');
      hidden++;
    }
  }
  return hidden;
})()`;

/** CE-2: fonts and images loaded (each wait bounded). */
export const settleScript = (ms: number) => `(async () => {
  const wait = (p) => Promise.race([p, new Promise((r) => setTimeout(r, ${ms}))]);
  await wait(document.fonts.ready);
  await wait(Promise.all(Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); }))));
})()`;

/** CE-3: one pass top to bottom (bounded), then back to the top. */
export const scrollScript = (max: number) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(200, Math.floor(innerHeight * 0.8));
  const end = Math.min(document.documentElement.scrollHeight, ${max});
  for (let y = 0; y < end; y += step) { scrollTo(0, y); await sleep(120); }
  scrollTo(0, end);
  await sleep(250);
  scrollTo(0, 0);
  await sleep(150);
})()`;

/** CE-6 (full-page mode): pin fixed/sticky headers once at the top; drop floating bottom bars. */
export const FIX_STICKY = `(() => {
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.height < innerHeight * 0.3) {
      el.style.setProperty('position', cs.position === 'fixed' ? 'absolute' : 'relative', 'important');
      if (cs.position === 'fixed') el.style.setProperty('top', (window.scrollY + r.top) + 'px', 'important');
    } else if (cs.position === 'fixed' && r.top >= innerHeight * 0.6) {
      el.style.setProperty('display', 'none', 'important');
    }
  }
})()`;
