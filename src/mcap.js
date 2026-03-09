/**
 * MCAP loading and time synchronization.
 *
 * Uses ScreenCaptured messages (media_ref.pts_ns) for precise video-event
 * alignment. Falls back to recording_timing metadata or statistics for legacy recordings.
 */
import { McapIndexedReader } from "@mcap/core";
import { decompress } from "fzstd";

// Blob-based readable for McapIndexedReader
class BlobReadable {
  constructor(blob) {
    this.blob = blob;
  }
  async size() {
    return BigInt(this.blob.size);
  }
  async read(offset, length) {
    const slice = this.blob.slice(Number(offset), Number(offset) + Number(length));
    return new Uint8Array(await slice.arrayBuffer());
  }
}

const decompressHandlers = {
  zstd: (data, size) => decompress(data, new Uint8Array(Number(size))),
};

export async function loadMcap(file) {
  const reader = await McapIndexedReader.Initialize({
    readable: new BlobReadable(file),
    decompressHandlers,
  });
  return { reader, channels: Array.from(reader.channelsById.values()) };
}

export async function loadMcapFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch MCAP: ${response.status}`);
  return loadMcap(await response.blob());
}

/**
 * Time synchronization between video playback and MCAP log times.
 *
 * basePtsTime = the MCAP wall-clock timestamp corresponding to video PTS 0.
 *
 * Preferred: compute from the first ScreenCaptured message:
 *   basePtsTime = logTime - media_ref.pts_ns
 *
 * Fallback 1: recording_timing metadata with start_time_ns (legacy).
 * Fallback 2: statistics.messageStartTime (coarsest).
 */
export class TimeSync {
  constructor() {
    this.basePtsTime = null;
  }

  /** Initialize from the first screen message. */
  initFromScreenMessage(logTime, data) {
    this.basePtsTime = logTime - BigInt(data?.media_ref?.pts_ns || 0);
  }

  /** Fallback initialization from reader metadata/statistics. */
  async initFromReader(reader) {
    // Try to read recording_timing metadata
    for await (const m of reader.readMetadata({ name: "recording_timing" })) {
      const startNs = m.metadata.get("start_time_ns");
      if (startNs) {
        this.basePtsTime = BigInt(startNs);
        return;
      }
      break;
    }

    // Fallback: use first message time from statistics
    const stats = reader.statistics;
    if (stats) {
      this.basePtsTime = stats.messageStartTime;
    }
  }

  /** @param {number} videoTimeSec @returns {bigint} */
  videoTimeToMcap(videoTimeSec) {
    if (this.basePtsTime === null) return 0n;
    return this.basePtsTime + BigInt(Math.floor(videoTimeSec * 1e9));
  }

  /** @returns {bigint} */
  getBasePtsTime() {
    return this.basePtsTime ?? 0n;
  }
}
