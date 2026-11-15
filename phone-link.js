/* Transport for the Lookout Rover phone camera and opt-in intercom. */
(() => {
  "use strict";

  const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());
  const PAIRING_STORAGE = "lookout-rover.phone-pairing.v1";

  async function peerOptions() {
    // Open Relay documents this public shared secret for its static-auth service.
    // These are temporary TURN credentials, independent of the bookmarked pairing link.
    const host = "staticauth.openrelay.metered.ca";
    const text = new TextEncoder();
    const username = Math.floor(Date.now() / 1000 + 4 * 60 * 60) + ":lookout-" + crypto.randomUUID();
    const key = await crypto.subtle.importKey("raw", text.encode("openrelayprojectsecret"),
      {name: "HMAC", hash: "SHA-1"}, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, text.encode(username));
    const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return {secure: true, config: {
      iceTransportPolicy: "relay",
      iceServers: [{
        urls: [
          "turn:" + host + ":443?transport=tcp",
          "turns:" + host + ":443?transport=tcp",
          "turn:" + host + ":80?transport=tcp",
        ],
        username,
        credential,
      }],
    }};
  }

  function loadPairing() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PAIRING_STORAGE));
      if (/^lookout-[a-f0-9-]{36}$/.test(saved?.id) && /^[a-f0-9-]{36}$/.test(saved?.token)) return saved;
    } catch (_) {}
    return null;
  }

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
      this.savedPairing = role === "operator" ? loadPairing() : null;
      if (this.savedPairing) this.setLink(this.savedPairing);
    }

    change(status) {
      if (status) this.status = status;
      this.onChange?.(this);
    }

    setLink({id, token}) {
      const url = new URL("rover-phone.html", window.location.href);
      url.hash = new URLSearchParams({id, key: token}).toString();
      this.link = url.href;
    }

    getOperatorPairing() {
      if (!this.savedPairing) {
        const pairing = {id: "lookout-" + crypto.randomUUID(), token: crypto.randomUUID()};
        window.localStorage.setItem(PAIRING_STORAGE, JSON.stringify(pairing));
        this.savedPairing = pairing;
      }
      this.setLink(this.savedPairing);
      return this.savedPairing;
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
      this.change(this.role === "phone" ? "Opening the rear camera…" : "Opening the phone connection…");
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
        }
        let saved;
        if (this.role === "operator") {
          phase = "storage";
          saved = this.getOperatorPairing();
          this.token = saved.token;
        }
        phase = "pair";
        const options = await peerOptions();
        if (epoch !== this.epoch) return;
        const peer = saved ? new window.Peer(saved.id, options) : new window.Peer(options);
        this.peer = peer;
        peer.on("error", error => {
          if (this.peer !== peer) return;
          const note = {
            "peer-unavailable": "Open Lookout Rover on the laptop, then start the rear camera again using this same link.",
            "unavailable-id": "This phone link is open in another Lookout Rover tab. Close that tab, then click Listen for phone.",
          }[error.type];
          this.close(note || "Could not connect. Check your network, then retry with the same link.");
        });
        peer.on("disconnected", () => {
          if (this.peer === peer && !this.open) {
            this.close(this.role === "operator"
              ? "Connection service disconnected. Click Listen for phone to retry with the same link."
              : "Connection service disconnected. Start the rear camera again.");
          }
        });
        peer.on("open", () => {
          if (this.peer !== peer) return;
          if (this.role === "operator") {
            clearTimeout(this.pairTimer);
            this.change("Listening for your phone via free relay. Open your bookmarked link.");
          } else {
            this.change("Connecting to the operator via free relay…");
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
          this.pairTimer = setTimeout(() => this.disconnectPhone("The phone reached this console, but the relay connection timed out."), 28000);
          this.bindData(data);
        });
        peer.on("call", call => this.answer(call));
        this.pairTimer = setTimeout(() => this.close("Relay connection timed out. Retry using the same link."), 30000);
        this.starting = false;
        this.change();
      } catch (_) {
        if (epoch === this.epoch) {
          const note = {
            camera: "Camera unavailable. Allow Safari to use the camera and try again.",
            storage: "Use a browser profile that allows site storage to save your phone link.",
          }[phase];
          this.close(note || "Could not start the connection. Check the network and retry.");
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
        if (this.data === data) this.disconnectPhone();
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
        this.disconnectPhone();
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
        if (call === this.cameraCall) this.disconnectPhone("Could not open the rover video. Retry the same link.");
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
        if (this.cameraCall === call) this.disconnectPhone("Rover video disconnected. Reopen the same phone link.");
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
            catch (_) { this.close("Could not start video. Retry with the same link."); }
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

    disconnectPhone(status) {
      if (this.role !== "operator" || !this.peer?.open || this.peer.disconnected) {
        this.close(status);
        return;
      }
      this.releaseStreams();
      this.change(status || "Phone disconnected. The same link is ready to reconnect.");
    }

    releaseStreams() {
      this.epoch++;
      clearTimeout(this.pairTimer);
      clearTimeout(this.cameraTimer);
      this.starting = false;
      this.open = false;
      this.hasVideo = false;
      const {data, cameraCall, camera} = this;
      this.data = this.cameraCall = this.camera = null;
      this.endIntercom(false);
      cameraCall?.close();
      data?.close();
      stopTracks(camera);
      this.video.srcObject = null;
    }

    close(status) {
      const peer = this.peer;
      this.peer = null;
      this.releaseStreams();
      peer?.destroy();
      this.change(status || (this.role === "operator" ? "Phone disconnected." : "Camera off."));
    }
  }

  window.RoverPhoneLink = RoverPhoneLink;
})();
