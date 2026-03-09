/**
 * Constants for Desktop dataset visualization
 */

export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;
export const OVERLAY_HEIGHT = 220;

export const KEY_SIZE = 32;
export const KEY_MARGIN = 3;
export const KEYBOARD_COLUMNS = 14;

export const MOUSE_VK_MAP = {
  1: "left",
  2: "right",
  4: "middle",
  5: "x1",
  6: "x2",
};

export const BUTTON_PRESS_FLAGS = {
  0x0001: "left",
  0x0004: "right",
  0x0010: "middle",
};

export const BUTTON_RELEASE_FLAGS = {
  0x0002: "left",
  0x0008: "right",
  0x0020: "middle",
};

export const RI_MOUSE_WHEEL = 0x0400;
export const RI_MOUSE_HWHEEL = 0x0800;
export const WHEEL_DECAY_MS = 150;

export const COLORS = {
  keyBackground: "#333",
  keyPressed: "#50b0ab",
  keyBorder: "#555",
  keyText: "#fff",
  mouseBody: "#282828",
  mouseBorder: "#888",
  mouseInactive: "#444",
  mouseLeft: "#e74c3c",
  mouseRight: "#3498db",
  mouseMiddle: "#f1c40f",
  mouseWheel: "#2ecc71",
  minimapBorder: "#fff",
  minimapCursor: "#0f0",
};

export const TOPICS = {
  KEYBOARD: "keyboard",
  KEYBOARD_STATE: "keyboard/state",
  MOUSE: "mouse",
  MOUSE_RAW: "mouse/raw",
  MOUSE_STATE: "mouse/state",
  WINDOW: "window",
  SCREEN: "screen",
};
