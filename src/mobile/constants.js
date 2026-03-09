/**
 * Constants for Mobile dataset visualization
 */

export const TOPICS = {
  TOUCH: "touch",
  KEY: "key",
  SCREEN: "screen",
  ROTATION: "rotation",
};

/** Maximum number of trail points to keep per finger */
export const MAX_TRAIL_LENGTH = 30;

/** How long a touch effect lingers after touch_up (ms) */
export const TOUCH_FADE_MS = 400;

/** Radius of the touch indicator circle */
export const TOUCH_RADIUS = 18;

/** Radius of the ripple effect on touch_down */
export const RIPPLE_RADIUS = 36;

export const COLORS = {
  touchActive: "rgba(231, 76, 60, 0.85)",
  touchTrail: "rgba(231, 76, 60, 0.4)",
  touchRipple: "rgba(231, 76, 60, 0.3)",
  touchFade: "rgba(231, 76, 60, 0.15)",
  canvasBg: "#111111",
  keyActive: "#e74c3c",
  keyInactive: "#333",
  keyText: "#fff",
  keyBorder: "#555",
};
