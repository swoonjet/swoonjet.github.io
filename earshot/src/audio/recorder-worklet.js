// The recording tap.
//
// Copies whatever passes through, in stereo, and posts it to the main thread. It
// also forwards its input to its output unchanged so that engines which only pull a
// node when something downstream wants it keep pulling this one — the output goes to
// a silent gain, so the recorder can never colour what is heard.
//
// Copies rather than references: a process block's Float32Arrays are reused by the
// engine on the very next call, so posting them without copying would hand the main
// thread buffers that rewrite themselves under it.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => { this.recording = Boolean(e.data?.recording); };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const left = input[0];
    // A mono source is recorded as stereo rather than as half a file.
    const right = input.length > 1 ? input[1] : left;

    for (let c = 0; c < output.length; c++) {
      output[c].set(input[Math.min(c, input.length - 1)]);
    }
    if (this.recording && left?.length) {
      this.port.postMessage([new Float32Array(left), new Float32Array(right)]);
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
