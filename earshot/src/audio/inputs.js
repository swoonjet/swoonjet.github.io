// Microphone acquisition. Auto-advancing: ask once, then open every input device
// the browser will give us and split each device into its physical channels.
// A "channel" in this piece is one physical input, not one device.

const AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
};

export async function permissionState() {
  if (!navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state; // granted | denied | prompt
  } catch {
    return 'unknown';
  }
}

/** One getUserMedia call to unlock labels, then enumerate. */
export async function requestAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser has no microphone access (getUserMedia missing).');
  }
  const probe = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  probe.getTracks().forEach((t) => t.stop());
}

export async function listInputDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
}

/**
 * Open every listed device. Returns { stream, device, channelCount } records.
 * A device that refuses to open is skipped rather than aborting the run — a
 * dead virtual input should never stop the piece from listening.
 */
export async function openDevices(devices, onNote = () => {}) {
  const opened = [];
  for (const device of devices) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...AUDIO_CONSTRAINTS, deviceId: { exact: device.deviceId } },
      });
      const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
      opened.push({
        stream,
        device,
        channelCount: Math.max(1, Math.min(settings.channelCount || 1, 4)),
        sampleRate: settings.sampleRate,
      });
      onNote(`opened ${label(device)}`);
    } catch (err) {
      onNote(`skipped ${label(device)} — ${err.name}`);
    }
  }
  return opened;
}

export function label(device, index = 0) {
  const raw = (device?.label || '').trim();
  if (raw) return raw.replace(/\s*\([0-9a-f:]{4,}\)\s*$/i, '');
  return `input ${String(index + 1).padStart(2, '0')}`;
}

/** Short, uppercase, grid-friendly source name. */
export function shortLabel(name) {
  return name
    .replace(/microphone|micro|built-?in|default|device/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22)
    .toUpperCase() || 'INPUT';
}
