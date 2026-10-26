(function (root) {
  "use strict";

  function getDraftKey(pageUrl) {
    try {
      const url = new URL(pageUrl);
      const id = url.searchParams.get("productDraftId");
      if (url.protocol !== "https:" || url.hostname !== "agentseller.temu.com" ||
          url.pathname !== "/goods/edit" || !/^\d+$/.test(id || "")) return null;
      return `${url.origin}${url.pathname}?productDraftId=${id}`;
    } catch {
      return null;
    }
  }

  function normalizeImage(image) {
    try {
      const url = new URL(typeof image === "string" ? image : image.url);
      if (url.protocol !== "https:" || url.username || url.password ||
          !/(^|\.)kwcdn\.com$/i.test(url.hostname)) return null;
      url.hash = "";
      return Object.freeze({
        url: url.href,
        // The asset path identifies an uploaded file across thumbnail transforms.
        assetKey: `${url.hostname}${url.pathname}`,
        width: Number(image.width) || 0,
        height: Number(image.height) || 0
      });
    } catch {
      return null;
    }
  }

  function uniqueImages(images) {
    const seen = new Set();
    return images.map(normalizeImage).filter(image => {
      if (!image || seen.has(image.assetKey)) return false;
      seen.add(image.assetKey);
      return true;
    });
  }

  function signature(images) {
    return JSON.stringify(images.map(image => [image.url, image.width || 0, image.height || 0]));
  }

  function assetSignature(images) {
    return JSON.stringify(images.map(normalizeImage).filter(Boolean).map(image => image.assetKey));
  }

  function planSync({ source, detail = [], lastWritten = null, editorBusy = false }) {
    const images = uniqueImages(source);
    if (!images.length) return { action: "wait", reason: "no-source", images };
    if (editorBusy) return { action: "wait", reason: "editor-busy", images };
    const target = assetSignature(images);
    const current = assetSignature(detail);
    if (current === target) return { action: "skip", reason: "already-synced", images };
    // Any existing content is protected unless it exactly matches our last write.
    // The caller must include text/other components in its ownership check too.
    if (detail.length && current !== lastWritten) {
      return { action: "pause", reason: "existing-detail", images };
    }
    return { action: "sync", reason: "source-changed", images };
  }

  class SyncScope {
    #revision = 0;
    #draft = null;
    #source = "";

    update(draft, source) {
      const next = signature(source);
      if (draft !== this.#draft || next !== this.#source) {
        this.#draft = draft;
        this.#source = next;
        this.#revision++;
      }
      return this.ticket();
    }

    ticket() {
      return Object.freeze({ revision: this.#revision, draft: this.#draft, source: this.#source });
    }

    isCurrent(ticket) {
      return Boolean(this.#draft && ticket && ticket.revision === this.#revision &&
        ticket.draft === this.#draft && ticket.source === this.#source);
    }

    cancel() { this.#revision++; }
  }

  const api = Object.freeze({ getDraftKey, normalizeImage, uniqueImages, signature, assetSignature, planSync, SyncScope });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TemuImageSyncCore = api;
})(globalThis);
