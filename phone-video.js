// The private bookmark stays the same. It identifies a video-only VDO.Ninja feed.
(() => {
  "use strict";
  const storageKey = "lookout-rover.phone-pairing.v1";
  const valid = value => /^[a-z0-9-]{8,100}$/i.test(value?.id ?? "")
    && /^[a-f0-9-]{36}$/i.test(value?.token ?? "");

  function fromBookmark(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const value = {id: params.get("id"), token: params.get("key")};
    return valid(value) ? value : null;
  }

  function savedPairing() {
    try {
      const value = JSON.parse(window.localStorage.getItem(storageKey));
      return valid(value) ? value : null;
    } catch (_) { return null; }
  }

  function createPairing() {
    const existing = savedPairing();
    if (existing) return existing;
    const value = {id: "lookout-" + crypto.randomUUID(), token: crypto.randomUUID()};
    window.localStorage.setItem(storageKey, JSON.stringify(value));
    return value;
  }

  function bookmark(value, base) {
    const url = new URL("rover-phone.html", base);
    url.hash = new URLSearchParams({id: value.id, key: value.token}).toString();
    return url.href;
  }

  function relayUrl(value, sender) {
    if (!valid(value)) throw new Error("Invalid phone link");
    const url = new URL("https://vdo.ninja/");
    const streamID = value.id.replace(/-/g, "").slice(0, 40);
    const password = value.token.replace(/-/g, "");
    url.searchParams.set(sender ? "push" : "view", streamID);
    url.searchParams.set("password", password);
    url.searchParams.set("relay", "1");
    if (sender) {
      url.searchParams.set("webcam", "1");
      url.searchParams.set("autostart", "1");
      url.searchParams.set("facing", "rear");
      url.searchParams.set("audiodevice", "0");
    } else {
      url.searchParams.set("clean", "1");
      url.searchParams.set("noaudio", "1");
    }
    return url.href;
  }

  window.LookoutPhoneVideo = {fromBookmark, savedPairing, createPairing, bookmark, relayUrl};
})();
