/**
 * Whether the interface may animate: not when the user asks the system to
 * reduce motion, and not in an automated browser (tests read the final
 * state at once)
 */
export const motionAllowed = () =>
  typeof window !== "undefined" &&
  !window.navigator.webdriver &&
  !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Turns every CSS animation off where motion is not allowed */
export const markMotion = () => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("no-motion", !motionAllowed());
};
