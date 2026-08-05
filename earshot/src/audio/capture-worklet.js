// Capture-only worklet: pulls the live signal off the graph in ~85 ms blocks and
// hands it to the main thread, where it lands in the rolling live buffer that
// the granular engine reads from. Nothing pre-recorded ever enters this path.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(4096);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const ch = input[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this.block[this.fill++] = ch[i];
      if (this.fill === this.block.length) {
        const copy = this.block.slice(0);
        this.port.postMessage(copy, [copy.buffer]);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
