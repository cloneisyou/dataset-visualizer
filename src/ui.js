/**
 * Shared UI components: loading indicator, status, device info, MCAP info, window info.
 */

export class LoadingIndicator {
  constructor(elementId = "loading-indicator") {
    this.element = document.getElementById(elementId);
  }
  show() {
    this.element?.classList.remove("hidden");
  }
  hide() {
    this.element?.classList.add("hidden");
  }
}

export function updateStatus(message, elementId = "status") {
  const el = document.getElementById(elementId);
  if (el) el.textContent = message;
}

/** Mobile device info from MCAP metadata (android_device / ios_device) */
export async function updateDeviceInfo(container, reader) {
  if (!container) return;

  let androidMeta = null;
  for await (const m of reader.readMetadata({ name: "android_device" })) {
    androidMeta = m.metadata;
    break;
  }
  let iosMeta = null;
  for await (const m of reader.readMetadata({ name: "ios_device" })) {
    iosMeta = m.metadata;
    break;
  }
  let screenRes = null;
  for await (const m of reader.readMetadata({ name: "screen_resolution" })) {
    screenRes = m.metadata;
    break;
  }
  let rotationMeta = null;
  for await (const m of reader.readMetadata({ name: "initial_rotation" })) {
    rotationMeta = m.metadata;
    break;
  }

  const title = '<div class="section-title">Device Info</div>';
  const meta = androidMeta || iosMeta;
  if (!meta) {
    container.innerHTML = title + '<p class="placeholder">No device metadata</p>';
    return;
  }

  let html = title;
  if (androidMeta) {
    html += `
      <p><strong>Model:</strong> ${meta.get("device_manufacturer") || "?"} ${meta.get("device_model") || "?"}</p>
      <p><strong>Android:</strong> ${meta.get("android_version") || "?"} (SDK ${meta.get("sdk_version") || "?"})</p>
    `;
  } else if (iosMeta) {
    html += `
      <p><strong>Model:</strong> ${meta.get("device_model") || "?"} (${meta.get("hardware_model") || "?"})</p>
      <p><strong>iOS:</strong> ${meta.get("ios_version") || "?"} (${meta.get("build_version") || "?"})</p>
    `;
  }
  if (screenRes) {
    html += `<p><strong>Screen:</strong> ${screenRes.get("width") || "?"}x${screenRes.get("height") || "?"}</p>`;
  }
  if (rotationMeta) {
    const r = parseInt(rotationMeta.get("rotation") || "0");
    const labels = ["Portrait", "Landscape (90 CW)", "Portrait (180)", "Landscape (270 CW)"];
    html += `<p><strong>Initial Rotation:</strong> ${labels[r] || r}</p>`;
  }
  container.innerHTML = html;
}

/** Desktop window info */
export function updateWindowInfo(container, windowData) {
  if (!container) return;
  container.innerHTML = "";

  if (!windowData) {
    container.innerHTML = '<p class="placeholder">No window data</p>';
    return;
  }

  const rect = windowData.rect || [0, 0, 0, 0];
  container.innerHTML = `
    <p class="title">${windowData.title || "Unknown"}</p>
    <p class="coords">Position: ${rect[0]}, ${rect[1]}</p>
    <p class="coords">Size: ${rect[2] - rect[0]} x ${rect[3] - rect[1]}</p>
  `;
}

/** MCAP info panel (shared) */
export async function displayMcapInfo(container, reader) {
  if (!container) return;
  const topicStats = new Map();
  for (const ch of reader.channelsById.values()) {
    topicStats.set(ch.topic, { count: 0n });
  }
  const stats = reader.statistics;
  if (stats?.channelMessageCounts) {
    for (const [chId, count] of stats.channelMessageCounts) {
      const ch = reader.channelsById.get(chId);
      if (ch && topicStats.has(ch.topic)) topicStats.get(ch.topic).count = count;
    }
  }
  const durationSec = stats ? Number(stats.messageEndTime - stats.messageStartTime) / 1e9 : 0;
  let html = '<div class="section"><div class="section-title">Topics</div>';
  for (const [topic, info] of topicStats) {
    const count = info.count > 0n ? Number(info.count).toLocaleString() : "—";
    html += `<div class="topic-row"><span class="topic-name">${topic}</span><span class="topic-count">${count}</span></div>`;
  }
  html += "</div>";
  if (durationSec > 0) html += `<div class="time-range">Duration: ${durationSec.toFixed(1)}s</div>`;
  if (stats) html += `<div class="time-range">Messages: ${Number(stats.messageCount).toLocaleString()}</div>`;
  container.innerHTML = html;
}
