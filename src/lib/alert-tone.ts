"use client";

/**
 * نغمة تنبيه قصيرة بلا ملف صوتي، مشتركة بين الصيدلية والمستفيد.
 * المتصفحات (خصوصًا الآيفون) لا تسمح بالصوت قبل أول لمسة على الصفحة، لذا يُجهَّز الصوت عند أول لمسة.
 */
let context: AudioContext | null = null;

export function unlockAlertTone() {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) context = new Ctor();
  }
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
  // الآيفون يحتاج تشغيل أي صوت داخل اللمسة نفسها حتى يفتح الصوت فعليًا.
  if (context) {
    try {
      const silent = context.createBuffer(1, 1, 22050);
      const source = context.createBufferSource();
      source.buffer = silent;
      source.connect(context.destination);
      source.start(0);
    } catch {
      // تجاهل
    }
  }
  return context;
}

/** يجهّز الصوت عند أول لمسة أو ضغطة زر في الصفحة. */
export function armAlertToneOnFirstGesture() {
  const unlock = () => unlockAlertTone();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("touchend", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchend", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export function playAlertTone() {
  if (!context) return;
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  try {
    [0, 0.25, 0.5].forEach((offset, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = index === 2 ? 1175 : 880;
      const start = context!.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.22);
    });
  } catch {
    // جهاز لا يدعم الصوت البرمجي
  }
}
