// Keep the direct Web Audio route until an alternate output is ready to play.
export class CallAudioOutput {
  constructor(context, gain) {
    this.context = context;
    this.gain = gain;
    this.disposed = false;
    this.current = null;
    this.pending = null;
  }

  get supported() {
    return (
      typeof this.context.setSinkId === "function" ||
      (typeof HTMLMediaElement !== "undefined" &&
        typeof HTMLMediaElement.prototype.setSinkId === "function" &&
        typeof this.context.createMediaStreamDestination === "function")
    );
  }

  get id() {
    return (
      this.current?.element.sinkId ||
      (typeof this.context.sinkId === "string" ? this.context.sinkId : "")
    );
  }

  release(route) {
    if (!route || route.released) return;
    route.released = true;
    try {
      this.gain.disconnect(route.destination);
    } catch {}
    route.element.pause();
    route.element.srcObject = null;
    route.destination.stream.getTracks().forEach((track) => track.stop());
  }

  async select(id) {
    if (this.disposed) return false;
    if (typeof this.context.setSinkId === "function") {
      await this.context.setSinkId(id);
      return !this.disposed;
    }
    if (!this.supported) throw new Error("Output selection is unavailable.");
    if (!id) {
      if (this.current) {
        this.gain.connect(this.context.destination);
        this.release(this.current);
        this.current = null;
      }
      return true;
    }

    const route = {
      destination: this.context.createMediaStreamDestination(),
      element: document.createElement("audio"),
    };
    this.pending = route;
    route.element.setAttribute("playsinline", "");
    route.element.muted = true;
    route.element.srcObject = route.destination.stream;
    this.gain.connect(route.destination);
    try {
      await route.element.setSinkId(id);
      if (this.disposed) return false;
      await route.element.play();
      if (this.disposed) return false;
      if (this.current) this.release(this.current);
      else this.gain.disconnect(this.context.destination);
      this.current = route;
      route.element.muted = false;
      return true;
    } finally {
      if (this.current !== route) this.release(route);
      if (this.pending === route) this.pending = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.release(this.pending);
    this.release(this.current);
    this.pending = this.current = null;
  }
}
