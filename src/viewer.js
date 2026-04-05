/**
 * Unified viewer — loads MCAP, detects device type, delegates to mobile or desktop mode.
 */
import { loadMcap, loadMcapFromUrl, TimeSync } from "./mcap.js";
import { detectDeviceType } from "./detect.js";
import { LoadingIndicator, updateStatus, displayMcapInfo, updateDeviceInfo, updateWindowInfo } from "./ui.js";

// DOM elements (shared)
const video = document.getElementById("video");
const loading = new LoadingIndicator();
const timeSync = new TimeSync();

let mcapReader = null;
let stateManager = null;
let deviceType = null; // "mobile" | "desktop"
let userWantsToPlay = false;
let isUpdating = false;

// Annotations (chat panel)
let _annotations = [];
let _lastRenderedIndex = -1;

// -----------------------------------------------------------------------
// Mode-specific modules (loaded dynamically)
// -----------------------------------------------------------------------

let mobileModules = null;
let desktopModules = null;

async function loadMobileModules() {
  if (!mobileModules) {
    const [state, overlay, constants] = await Promise.all([
      import("./mobile/state.js"),
      import("./mobile/overlay.js"),
      import("./mobile/constants.js"),
    ]);
    mobileModules = { StateManager: state.StateManager, overlay, constants };
  }
  return mobileModules;
}

async function loadDesktopModules() {
  if (!desktopModules) {
    const [state, overlay, constants] = await Promise.all([
      import("./desktop/state.js"),
      import("./desktop/overlay.js"),
      import("./desktop/constants.js"),
    ]);
    desktopModules = { StateManager: state.StateManager, overlay, constants };
  }
  return desktopModules;
}

// -----------------------------------------------------------------------
// State loading for seek
// -----------------------------------------------------------------------

async function loadStateAt(targetTime) {
  if (!mcapReader) return;
  stateManager.isLoading = true;
  video.pause();
  loading.show();

  try {
    if (deviceType === "mobile") {
      await _loadMobileStateAt(targetTime);
    } else {
      await _loadDesktopStateAt(targetTime);
    }
    stateManager.lastProcessedTime = targetTime;
  } finally {
    stateManager.isLoading = false;
    loading.hide();
  }
  if (userWantsToPlay) video.play();
}

async function _loadMobileStateAt(targetTime) {
  stateManager.reset(targetTime);
  for await (const msg of mcapReader.readMessages({
    endTime: targetTime,
    topics: stateManager.getUpdateTopics(),
  })) {
    const channel = mcapReader.channelsById.get(msg.channelId);
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    stateManager.processMessage(channel.topic, data, msg.logTime);
  }
}

async function _loadDesktopStateAt(targetTime) {
  const { TOPICS } = desktopModules.constants;
  stateManager.reset(targetTime);

  // Keyboard: find nearest state snapshot, then replay events
  let keyboardStateTime = 0n;
  for await (const msg of mcapReader.readMessages({
    endTime: targetTime,
    topics: [TOPICS.KEYBOARD_STATE],
    reverse: true,
  })) {
    stateManager.applyKeyboardState(JSON.parse(new TextDecoder().decode(msg.data)));
    keyboardStateTime = msg.logTime;
    break;
  }
  if (keyboardStateTime > 0n) {
    for await (const msg of mcapReader.readMessages({
      startTime: keyboardStateTime + 1n,
      endTime: targetTime,
      topics: [TOPICS.KEYBOARD],
    })) {
      stateManager.processMessage(TOPICS.KEYBOARD, JSON.parse(new TextDecoder().decode(msg.data)), msg.logTime);
    }
  }

  // Mouse: find nearest state snapshot, then replay events
  let mouseStateTime = 0n;
  for await (const msg of mcapReader.readMessages({
    endTime: targetTime,
    topics: [TOPICS.MOUSE_STATE],
    reverse: true,
  })) {
    stateManager.applyMouseState(JSON.parse(new TextDecoder().decode(msg.data)));
    mouseStateTime = msg.logTime;
    break;
  }
  const mouseTopic = stateManager.getMouseTopic();
  if (mouseStateTime > 0n) {
    for await (const msg of mcapReader.readMessages({
      startTime: mouseStateTime + 1n,
      endTime: targetTime,
      topics: [mouseTopic],
    })) {
      stateManager.processMessage(mouseTopic, JSON.parse(new TextDecoder().decode(msg.data)), msg.logTime);
    }
  }

  // Window: latest before target
  for await (const msg of mcapReader.readMessages({
    endTime: targetTime,
    topics: [TOPICS.WINDOW],
    reverse: true,
  })) {
    stateManager.applyWindowState(JSON.parse(new TextDecoder().decode(msg.data)));
    break;
  }
}

// -----------------------------------------------------------------------
// Incremental update
// -----------------------------------------------------------------------

async function updateStateUpTo(targetTime) {
  if (!mcapReader || stateManager.isLoading || targetTime <= stateManager.lastProcessedTime) return;
  if (isUpdating) return;

  isUpdating = true;
  try {
    for await (const msg of mcapReader.readMessages({
      startTime: stateManager.lastProcessedTime,
      endTime: targetTime,
      topics: stateManager.getUpdateTopics(),
    })) {
      if (stateManager.isLoading) return;
      const channel = mcapReader.channelsById.get(msg.channelId);
      const data = JSON.parse(new TextDecoder().decode(msg.data));
      stateManager.processMessage(channel.topic, data, msg.logTime);
    }
    if (!stateManager.isLoading) stateManager.lastProcessedTime = targetTime;
  } finally {
    isUpdating = false;
  }
}

// -----------------------------------------------------------------------
// Render loops
// -----------------------------------------------------------------------

function startMobileRenderLoop() {
  const touchCanvas = document.getElementById("touch-canvas");
  const phoneFrame = document.getElementById("phone-frame");
  const timeInfo = document.querySelector("#mobile-time-info span");
  const touchInfo = document.querySelector("#touch-info span");
  const rotationInfoSpan = document.querySelector("#rotation-info span");
  const btnVolumeUp = document.getElementById("btn-volume-up");
  const btnVolumeDown = document.getElementById("btn-volume-down");
  const btnPower = document.getElementById("btn-power");
  const HW_KEY_BUTTONS = [
    { key: "KEY_VOLUMEUP", el: btnVolumeUp },
    { key: "KEY_VOLUMEDOWN", el: btnVolumeDown },
    { key: "KEY_POWER", el: btnPower },
  ];
  const HW_KEY_SET = new Set(HW_KEY_BUTTONS.map((b) => b.key));
  const ROTATION_LABELS = ["Portrait", "Landscape", "Portrait (180)", "Landscape (270)"];

  const { overlay, constants } = mobileModules;
  const ctx = touchCanvas.getContext("2d");
  let _lastAppliedRotation = -1;

  (function render() {
    const mcapTime = timeSync.videoTimeToMcap(video.currentTime);
    updateStateUpTo(mcapTime).catch(console.error);
    stateManager.cleanupFading();

    ctx.clearRect(0, 0, touchCanvas.width, touchCanvas.height);
    ctx.fillStyle = constants.COLORS.canvasBg;
    ctx.fillRect(0, 0, touchCanvas.width, touchCanvas.height);

    const { touches, fadingTouches, activeKeys } = stateManager.state;
    overlay.drawTouches(ctx, touches, fadingTouches);

    // Hardware button visuals
    for (const { key, el } of HW_KEY_BUTTONS) {
      el.classList.toggle("active", activeKeys.has(key));
    }

    // Other keys at bottom
    const otherKeys = new Set([...activeKeys].filter((k) => !HW_KEY_SET.has(k)));
    overlay.drawKeys(ctx, otherKeys, 8, touchCanvas.height - 32, touchCanvas.width);

    // Info bar
    if (timeInfo) timeInfo.textContent = `${video.currentTime.toFixed(2)}s`;
    if (touchInfo) touchInfo.textContent = `${touches.size}`;

    // Rotation
    let rot = stateManager.state.rotation;
    if (rot === 0 && video.videoWidth > 0 && video.videoHeight > 0) {
      if (video.videoWidth > video.videoHeight) rot = 1;
    }
    if (rotationInfoSpan) rotationInfoSpan.textContent = ROTATION_LABELS[rot] || "?";

    if (rot !== _lastAppliedRotation && phoneFrame) {
      phoneFrame.classList.remove("rotation-1", "rotation-2", "rotation-3");
      if (rot > 0) phoneFrame.classList.add(`rotation-${rot}`);
      _lastAppliedRotation = rot;
      syncMobileCanvasToVideo();
    }

    if (_annotations.length > 0) updateChatPanel(video.currentTime);
    requestAnimationFrame(render);
  })();
}

function startDesktopRenderLoop() {
  const overlayCanvas = document.getElementById("desktop-overlay");
  const timeInfo = document.querySelector("#desktop-time-info span");
  const windowInfoEl = document.getElementById("window-info");
  const { overlay, constants } = desktopModules;
  const ctx = overlayCanvas.getContext("2d");
  const keyboardWidth = constants.KEYBOARD_COLUMNS * (constants.KEY_SIZE + constants.KEY_MARGIN);
  const mouseX = 10 + keyboardWidth + 20;

  (function render() {
    const mcapTime = timeSync.videoTimeToMcap(video.currentTime);
    updateStateUpTo(mcapTime).catch(console.error);
    stateManager.decayWheel();

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const { keyboard, mouse, window: win } = stateManager.state;
    overlay.drawKeyboard(ctx, 10, 10, keyboard);
    overlay.drawMouse(ctx, mouseX, 10, mouse.buttons, mouse.wheel);
    overlay.drawMinimap(
      ctx,
      mouseX + 70,
      10,
      160,
      100,
      mouse.x,
      mouse.y,
      constants.SCREEN_WIDTH,
      constants.SCREEN_HEIGHT,
      mouse.buttons,
    );
    updateWindowInfo(windowInfoEl, win);
    if (timeInfo) timeInfo.textContent = `${video.currentTime.toFixed(2)}s`;

    if (_annotations.length > 0) updateChatPanel(video.currentTime);
    requestAnimationFrame(render);
  })();
}

// -----------------------------------------------------------------------
// Canvas sync (mobile)
// -----------------------------------------------------------------------

function syncMobileCanvasToVideo() {
  const touchCanvas = document.getElementById("touch-canvas");
  if (!touchCanvas) return;
  touchCanvas.width = video.videoWidth;
  touchCanvas.height = video.videoHeight;
  const rect = video.getBoundingClientRect();
  touchCanvas.style.width = rect.width + "px";
  touchCanvas.style.height = rect.height + "px";
}

// -----------------------------------------------------------------------
// Chat panel (annotations) — shared
// -----------------------------------------------------------------------

function _formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

function updateChatPanel(currentTimeSec) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  let targetIdx = -1;
  for (let i = 0; i < _annotations.length; i++) {
    if (_annotations[i].timestamp_sec <= currentTimeSec) targetIdx = i;
    else break;
  }

  if (targetIdx === _lastRenderedIndex) return;

  const bubbles = container.children;
  for (let i = 0; i < bubbles.length; i++) {
    const isActive = i <= targetIdx;
    const isCurrent = i === targetIdx;
    bubbles[i].classList.toggle("active", isActive);
    bubbles[i].classList.toggle("current", isCurrent);
  }

  _lastRenderedIndex = targetIdx;
  if (targetIdx >= 0 && bubbles[targetIdx]) {
    bubbles[targetIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function _createChatBubble(annotation) {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = `
    <div class="chat-bubble-time">${_formatTime(annotation.timestamp_sec)}</div>
    <div class="chat-bubble-text">${_escapeHtml(annotation.text)}</div>
  `;
  return bubble;
}

function _escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// -----------------------------------------------------------------------
// JSON loading — shared
// -----------------------------------------------------------------------

async function loadJsonData(jsonFile) {
  if (!jsonFile) return;
  try {
    const text = await jsonFile.text();
    const data = JSON.parse(text);

    // Desktop: adjust keyboard labels based on OS
    if (deviceType === "desktop" && desktopModules) {
      desktopModules.overlay.setKeyboardOS(data.os || null);
    }

    // Display OS and Recorder in device-info
    const deviceEl = document.getElementById("device-info");
    if (deviceEl) {
      if (data.os) {
        const existing = deviceEl.querySelector(".os-line");
        if (existing) existing.remove();
        const p = document.createElement("p");
        p.className = "os-line";
        p.innerHTML = `<strong>OS:</strong> ${data.os}`;
        const title = deviceEl.querySelector(".section-title");
        if (title) title.after(p);
        else deviceEl.prepend(p);
      }
      if (data.recorder) {
        const existing = deviceEl.querySelector(".recorder-line");
        if (existing) existing.remove();
        const p = document.createElement("p");
        p.className = "recorder-line";
        p.innerHTML = `<strong>Recorder:</strong> ${data.recorder}`;
        const osLine = deviceEl.querySelector(".os-line");
        if (osLine) osLine.after(p);
        else {
          const title = deviceEl.querySelector(".section-title");
          if (title) title.after(p);
          else deviceEl.prepend(p);
        }
      }
    }

    // Display instruction
    const instrEl = document.getElementById("instruction-text");
    if (instrEl) {
      if (data.instructions) {
        instrEl.textContent = data.instructions;
        instrEl.classList.remove("placeholder");
      } else {
        instrEl.textContent = "No instruction";
        instrEl.classList.add("placeholder");
      }
    }

    // Load annotations
    if (data.annotations && Array.isArray(data.annotations)) {
      _annotations = data.annotations
        .map((a) => ({ timestamp_sec: a.timestamp_sec, text: a.text }))
        .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
    } else {
      _annotations = [];
    }
    _lastRenderedIndex = -1;
    const container = document.getElementById("chat-messages");
    if (container) {
      container.innerHTML = "";
      for (const annotation of _annotations) {
        container.appendChild(_createChatBubble(annotation));
      }
    }
  } catch (e) {
    console.error("Failed to load JSON:", e);
  }
}

// -----------------------------------------------------------------------
// Setup & init
// -----------------------------------------------------------------------

async function setup(reader) {
  mcapReader = reader;

  // Detect device type
  deviceType = await detectDeviceType(reader);

  // Load mode-specific modules
  if (deviceType === "mobile") {
    const mods = await loadMobileModules();
    stateManager = new mods.StateManager();
  } else {
    const mods = await loadDesktopModules();
    stateManager = new mods.StateManager();
  }

  // Time sync: try screen message first, fallback for legacy
  let synced = false;
  for await (const msg of reader.readMessages({ topics: ["screen"] })) {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    timeSync.initFromScreenMessage(msg.logTime, data);
    synced = true;
    break;
  }
  if (!synced) {
    await timeSync.initFromReader(reader);
  }

  await displayMcapInfo(document.getElementById("mcap-info"), reader);

  // Mode-specific info
  if (deviceType === "mobile") {
    await updateDeviceInfo(document.getElementById("device-info"), reader);
  }

  stateManager.lastProcessedTime = timeSync.getBasePtsTime();
  if (deviceType === "desktop") {
    stateManager.lastRecenterTime = stateManager.lastProcessedTime;
  }

  // Seek handler
  let pendingSeek = null;
  video.addEventListener("seeked", async () => {
    const targetTime = timeSync.videoTimeToMcap(video.currentTime);
    pendingSeek = targetTime;
    if (stateManager.isLoading) return;
    await loadStateAt(targetTime);
    while (pendingSeek !== null && pendingSeek !== stateManager.lastProcessedTime) {
      const nextTarget = pendingSeek;
      pendingSeek = null;
      await loadStateAt(nextTarget);
    }
    pendingSeek = null;
  });

  video.addEventListener("play", () => {
    userWantsToPlay = true;
    if (stateManager.isLoading) video.pause();
  });
  video.addEventListener("pause", () => {
    if (!stateManager.isLoading) userWantsToPlay = false;
  });
}

function initViewer(channelCount) {
  document.getElementById("landing")?.classList.add("hidden");
  document.getElementById("file-select")?.classList.add("hidden");

  const viewer = document.getElementById("viewer");
  viewer?.classList.remove("hidden");

  // Toggle mode class and show/hide mode-specific elements
  const isMobile = deviceType === "mobile";
  viewer?.classList.toggle("mode-mobile", isMobile);
  viewer?.classList.toggle("mode-desktop", !isMobile);

  for (const el of document.querySelectorAll(".mobile-only")) {
    el.classList.toggle("hidden", !isMobile);
  }
  for (const el of document.querySelectorAll(".desktop-only")) {
    el.classList.toggle("hidden", isMobile);
  }

  if (isMobile) {
    video.onloadedmetadata = () => {
      syncMobileCanvasToVideo();
      startMobileRenderLoop();

      const ro = new ResizeObserver(() => syncMobileCanvasToVideo());
      ro.observe(video);
      video.addEventListener("resize", () => syncMobileCanvasToVideo());
    };
  } else {
    // Desktop mouse mode controls
    const recenterInput = document.getElementById("recenter-interval");
    recenterInput?.addEventListener("change", (e) => {
      stateManager.recenterIntervalMs = Math.max(0, parseInt(e.target.value, 10) || 0);
    });
    document.querySelectorAll('input[name="mouse-mode"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        stateManager.mouseMode = e.target.value;
        if (recenterInput) recenterInput.disabled = stateManager.mouseMode !== "raw";
        loadStateAt(timeSync.videoTimeToMcap(video.currentTime));
      });
    });

    video.onloadedmetadata = () => {
      const overlayCanvas = document.getElementById("desktop-overlay");
      const w = video.offsetWidth || 800;
      overlayCanvas.width = w;
      overlayCanvas.height = desktopModules.constants.OVERLAY_HEIGHT;
      overlayCanvas.style.width = w + "px";

      const resizeOverlay = () => {
        const newW = video.offsetWidth || 800;
        overlayCanvas.width = newW;
        overlayCanvas.height = desktopModules.constants.OVERLAY_HEIGHT;
        overlayCanvas.style.width = newW + "px";
      };
      window.addEventListener("resize", resizeOverlay);

      startDesktopRenderLoop();
    };
  }

  updateStatus(`Ready: ${channelCount} channels`);
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

export async function loadFromFiles(mcapFile, mkvFile, statusEl, jsonFile) {
  updateStatus("Loading...");
  try {
    const { reader, channels } = await loadMcap(mcapFile);
    await setup(reader);
    video.src = URL.createObjectURL(mkvFile);
    initViewer(channels.length);
    if (jsonFile) await loadJsonData(jsonFile);
  } catch (e) {
    console.error("loadFromFiles error:", e);
    const msg = `Error: ${e.message}`;
    updateStatus(msg);
    if (statusEl) statusEl.textContent = msg;
  }
}

export async function loadFromUrls(mcapUrl, mkvUrl) {
  updateStatus("Loading...");
  try {
    const { reader, channels } = await loadMcapFromUrl(mcapUrl);
    await setup(reader);
    video.src = mkvUrl;
    initViewer(channels.length);
  } catch (e) {
    updateStatus(`Error: ${e.message}`);
    console.error(e);
  }
}
