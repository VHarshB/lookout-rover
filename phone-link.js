/* Transport for the Lookout Rover phone camera and opt-in intercom. */
(() => {
  "use strict";

  const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());

  class RoverPhoneLink {
    constructor({role, video, audio, onChange, beforeIntercom, afterIntercom}) {
      Object.assign(this, {role, video, audio, onChange, beforeIntercom, afterIntercom});
      this.status = role === "operator" ? "Pair a phone to see the rover’s view." : "Ready to start the rear camera.";
      this.intercom = "off";
      this.open = false;
      this.hasVideo = false;
      this.audioBlocked = false;
      this.epoch = 0;
      this.intercomEpoch = 0;
    }

    change(status) {
      if (status) this.status = status;
      this.onChange?.(this);
    }

    async start(pairing) {
      if (this.peer || this.starting) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        this.change("Open this page over HTTPS to use the camera and mic.");
        return;
      }
      if (typeof window.Peer !== "function") {
        this.change("Could not load the connection service. Refresh on a working network.");
        return;
      }
      if (this.role === "phone" && !pairing) {
        this.change("Scan the pairing QR code from the Lookout Rover console.");
        return;
      }
      const epoch = ++this.epoch;
      this.starting = true;
      this.change(this.role === "phone" ? "Opening the rear camera…" : "Creating a private pairing link…");
      let phase = "pair";
      try {
        if (this.role === "phone") {
          this.token = pairing.token;
          this.hostId = pairing.id;
          phase = "camera";
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {facingMode: {ideal: "environment"}, width: {ideal: 640}, height: {ideal: 360}, frameRate: {ideal: 24, max: 30}},
            audio: false,
          });
          if (epoch !== this.epoch) { stopTracks(stream); return; }
          this.camera = stream;
          this.video.srcObject = stream;
          void this.video.play().catch(() => {});
          for (const track of stream.getVideoTracks()) {
            track.addEventListener("ended", () => {
              if (this.camera === stream) this.close("The phone camera closed. Start it again.");
            });
          }
          phase = "pair";
        } else {
          this.token = crypto.randomUUID();
        }
        const peer = new window.Peer({secure: true});
        this.peer = peer;
        peer.on("error", error => {
          if (this.peer !== peer) return;
          this.close(error.type === "peer-unavailable"
            ? "The pairing link expired. Make a new one on the laptop."
            : "Could not connect to the phone. Check the network and pair again.");
        });
        peer.on("disconnected", () => {
          if (this.peer === peer && !this.open) {
            this.close("Connection service disconnected. Make a new pairing link.");
          }
        });
        peer.on("open", id => {
          if (this.peer !== peer) return;
          if (this.role === "operator") {
            const url = new URL("rover-phone.html", window.location.href);
            url.hash = new URLSearchParams({id, key: this.token}).toString();
            this.link = url.href;
            clearTimeout(this.pairTimer);
            this.pairTimer = setTimeout(() => this.close("Pairing link expired. Make a new one."), 300000);
            this.change("Scan the QR code with your iPhone.");
          } else {
            this.change("Connecting to the operator…");
            this.bindData(peer.connect(this.hostId, {reliable: true, metadata: {token: this.token}}));
          }
        });
        peer.on("connection", data => {
          if (this.peer !== peer || this.role !== "operator" || this.data
              || data.metadata?.token !== this.token) {
            data.close();
            return;
          }
          clearTimeout(this.pairTimer);
          this.pairTimer = setTimeout(() => this.close("Pairing timed out. Make a new pairing link."), 20000);
          this.bindData(data);
        });
        peer.on("call", call => this.answer(call));
        this.pairTimer = setTimeout(() => this.close("Pairing timed out. Check the network and try again."), 20000);
        this.starting = false;
        this.change();
      } catch (_) {
        if (epoch === this.epoch) {
          this.close(phase === "camera" ? "Camera unavailable. Allow Safari to use the camera and try again."
            : "Could not create the pairing session. Check the network and try again.");
        }
      }
    }

    bindData(data) {
      this.data = data;
      data.on("open", () => {
        if (this.data !== data) return;
        clearTimeout(this.pairTimer);
        this.open = true;
        this.setCameraTimer();
        this.change("Paired · connecting video…");
        if (this.role === "operator") this.send("paired");
      });
      data.on("data", message => {
        if (this.data === data) this.handle(message);
      });
      const lost = () => {
        if (this.data === data) this.close("Phone disconnected. Pair again to reconnect.");
      };
      data.on("error", lost);
      data.on("close", lost);
    }

    send(type) {
      if (!this.data?.open) return false;
      try {
        this.data.send({type});
        return true;
      } catch (_) {
        this.close("Phone disconnected. Pair again to reconnect.");
        return false;
      }
    }

    setCameraTimer() {
      clearTimeout(this.cameraTimer);
      this.cameraTimer = setTimeout(() => {
        if (this.open && !this.hasVideo) {
          this.change("Paired, but video could not connect. Try both devices on one hotspot.");
        }
      }, 18000);
    }

    makeCall(purpose, stream) {
      return this.peer.call(this.data.peer, stream, {metadata: {purpose, token: this.token}});
    }

    answer(call) {
      if (!this.data?.open || this.data.peer !== call.peer || call.metadata?.token !== this.token) {
        call.close();
        return;
      }
      try {
        if (this.role === "operator" && call.metadata.purpose === "camera" && !this.cameraCall) {
          this.bindCamera(call);
          call.answer();
        } else if (this.role === "phone" && call.metadata.purpose === "intercom"
                   && this.intercom === "connecting" && this.mic && !this.audioCall) {
          this.bindIntercom(call);
          call.answer(this.mic);
        } else {
          call.close();
        }
      } catch (_) {
        if (call === this.cameraCall) this.close("Could not open the rover video. Pair again.");
        else if (call === this.audioCall) this.endIntercom(true, "Could not open intercom audio. Try again.");
      }
    }

    bindCamera(call) {
      this.cameraCall = call;
      if (this.role === "operator") {
        call.on("stream", stream => {
          if (this.cameraCall !== call || !stream.getVideoTracks().length) return;
          this.video.srcObject = stream;
          void this.video.play().catch(() => {});
          this.markVideoLive();
        });
      }
      const ended = () => {
        if (this.cameraCall === call) this.close("Rover video disconnected. Pair again to reconnect.");
      };
      call.on("error", ended);
      call.on("close", ended);
      call.on("iceStateChanged", state => {
        if (this.cameraCall !== call) return;
        if (state === "failed" || state === "closed") ended();
        if (this.role === "phone" && (state === "connected" || state === "completed")) this.markVideoLive();
      });
    }

    markVideoLive() {
      this.hasVideo = true;
      clearTimeout(this.cameraTimer);
      this.change(this.role === "phone" ? "Rear camera live" : "Rover camera live");
    }

    handle(message) {
      if (!this.open || typeof message?.type !== "string") return;
      switch (message.type) {
        case "paired":
          if (this.role === "phone" && this.camera && !this.cameraCall) {
            try { this.bindCamera(this.makeCall("camera", this.camera)); }
            catch (_) { this.close("Could not start video. Pair the phone again."); }
          }
          break;
        case "intercom-request":
          if (this.role === "phone" && this.intercom === "off") {
            this.intercom = "incoming";
            this.change();
          }
          break;
        case "intercom-ready":
          if (this.role === "operator" && this.intercom === "requesting" && this.mic) {
            this.intercom = "connecting";
            this.change();
            try { this.bindIntercom(this.makeCall("intercom", this.mic)); }
            catch (_) { this.endIntercom(); }
          }
          break;
        case "intercom-end":
          this.endIntercom(false);
          break;
      }
    }

    async startIntercom() {
      const phone = this.role === "phone";
      if (!this.open || this.intercom !== (phone ? "incoming" : "off")) return;
      const serial = ++this.intercomEpoch;
      this.intercom = "authorizing";
      this.intercomNote = "";
      this.beforeIntercom?.();
      this.change();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: false, audio: {echoCancellation: true, noiseSuppression: true},
        });
        if (!this.open || serial !== this.intercomEpoch) { stopTracks(stream); return; }
        this.mic = stream;
        this.intercom = phone ? "connecting" : "requesting";
        if (!this.send(phone ? "intercom-ready" : "intercom-request")) {
          this.endIntercom(false);
          return;
        }
        this.intercomTimer = setTimeout(() => {
          this.endIntercom(true, "Intercom timed out. Try again.");
        }, 25000);
        this.change();
      } catch (_) {
        if (serial === this.intercomEpoch) this.endIntercom(true, "Microphone permission is needed for intercom.");
      }
    }

    bindIntercom(call) {
      this.audioCall = call;
      call.on("stream", stream => {
        if (this.audioCall !== call || !stream.getAudioTracks().length) return;
        clearTimeout(this.intercomTimer);
        this.audio.srcObject = stream;
        this.intercom = "live";
        void this.playAudio();
        this.change();
      });
      const ended = () => {
        if (this.audioCall === call) this.endIntercom();
      };
      call.on("error", ended);
      call.on("close", ended);
      call.on("iceStateChanged", state => {
        if (state === "failed" || state === "closed") ended();
      });
    }

    async playAudio() {
      const stream = this.audio.srcObject;
      if (!stream) return;
      let blocked = false;
      try { await this.audio.play(); } catch (_) { blocked = true; }
      if (this.audio.srcObject !== stream) return;
      this.audioBlocked = blocked;
      this.change();
    }

    endIntercom(notify = true, note = "") {
      const wasActive = this.intercom !== "off";
      this.intercomEpoch++;
      clearTimeout(this.intercomTimer);
      const call = this.audioCall;
      this.audioCall = null;
      this.intercom = "off";
      this.intercomNote = note;
      this.audioBlocked = false;
      this.audio.srcObject = null;
      stopTracks(this.mic);
      this.mic = null;
      call?.close();
      if (wasActive && notify) this.send("intercom-end");
      if (wasActive) this.afterIntercom?.();
      this.change();
    }

    close(status) {
      this.epoch++;
      clearTimeout(this.pairTimer);
      clearTimeout(this.cameraTimer);
      this.starting = false;
      this.open = false;
      this.hasVideo = false;
      this.link = "";
      const {peer, data, cameraCall, camera} = this;
      this.peer = this.data = this.cameraCall = this.camera = null;
      this.endIntercom(false);
      cameraCall?.close();
      data?.close();
      peer?.destroy();
      stopTracks(camera);
      this.video.srcObject = null;
      this.change(status || (this.role === "operator" ? "Phone disconnected." : "Camera off."));
    }
  }

  window.RoverPhoneLink = RoverPhoneLink;
})();
