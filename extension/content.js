(function () {
  "use strict";
  if (document.getElementById("temu-image-sync-panel")) return;
  const Core = globalThis.TemuImageSyncCore;
  const adapter = globalThis.TemuImageSyncAdapter.createAdapter(document);
  const scope = new Core.SyncScope();
  const storage = chrome.storage.local;
  const host = document.createElement("div");
  host.id = "temu-image-sync-panel";
  host.style.cssText = "position:fixed;right:24px;top:88px;z-index:9999;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}*{box-sizing:border-box}.panel{width:286px;padding:17px;background:#fff;border:1px solid #dce3ed;border-radius:13px;box-shadow:0 8px 30px #172e4c20;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#243348}
      .heading{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:650}.badge{font-size:11px;color:#6b7789;font-weight:400}.toggle{display:flex;align-items:center;gap:7px;margin-top:12px;cursor:pointer}input{accent-color:#216ce7;width:16px;height:16px}.status{margin:12px 0 8px;min-height:40px;white-space:pre-wrap;overflow-wrap:anywhere}.hint{color:#7a8798;font-size:11px}.actions{display:flex;gap:7px;margin-top:12px}button{font:inherit;cursor:pointer;border:1px solid #cdd6e3;border-radius:7px;padding:5px 10px;background:#fff;color:#314359}button.primary{background:#216ce7;border-color:#216ce7;color:white}button:disabled{opacity:.5;cursor:default}.min{border:0;padding:0 4px;background:transparent;color:#64748b}.collapsed .body{display:none}.collapsed{width:180px}.error{color:#b04120}
    </style>
    <section class="panel" aria-label="TEMU 商品图同步助手">
      <div class="heading"><span>商品图同步助手</span><button class="min" aria-label="收起面板">－</button></div>
      <div class="body">
        <label class="toggle"><input type="checkbox" checked>商品图确认后自动同步详情</label>
        <div class="status" role="status" aria-live="polite">正在识别商品图片…</div>
        <div class="hint">当前版本：单颜色规格 · 英语详情<br>只保存详情装修，商品草稿和发布由你控制。</div>
        <div class="actions"><button class="primary" data-action="sync">立即同步</button><button data-action="retry">重新检查</button></div>
      </div>
    </section>`;
  document.documentElement.appendChild(host);
  const status = shadow.querySelector(".status");
  const toggle = shadow.querySelector('input[type="checkbox"]');
  const syncButton = shadow.querySelector('[data-action="sync"]');
  let draft = null;
  let ready = false;
  let running = false;
  let userIntervened = false;
  let names = new Map();
  let lastWrite = null;
  let failedSignature = null;
  let scheduled = null;
  let loadSerial = 0;
  let currentSignature = "";
  let lastTyping = 0;

  function show(message, error = false) {
    if (status.textContent !== message) status.textContent = message;
    status.classList.toggle("error", error);
  }
  function recordKey() { return `draft:${draft}`; }
  async function saveRecord() {
    if (!draft) return;
    await storage.set({ [recordKey()]: { names: Array.from(names), lastWrite, updatedAt: Date.now() } });
  }
  async function loadDraft(next) {
    const serial = ++loadSerial;
    ready = false;
    draft = next;
    names = new Map();
    lastWrite = null;
    failedSignature = null;
    currentSignature = "";
    if (!draft) return;
    try {
      const data = await storage.get(recordKey());
      if (serial !== loadSerial) return;
      const record = data[recordKey()];
      if (record && Date.now() - record.updatedAt < 7 * 24 * 3600000) {
        names = new Map(record.names || []);
        lastWrite = record.lastWrite || null;
      }
    } catch { /* A storage error must not authorize overwriting a detail. */ }
    if (serial === loadSerial) { ready = true; scan(); }
  }
  function scan() {
    const next = Core.getDraftKey(location.href);
    host.hidden = !next;
    if (next !== draft) { scope.update(next, []); void loadDraft(next); return; }
    if (!ready || !draft || running) return;
    const source = adapter.sources();
    const sig = Core.signature(source.images);
    scope.update(draft, source.images);
    if (source.unsupported) { show(source.unsupported, true); syncButton.disabled = true; return; }
    syncButton.disabled = !source.images.length;
    if (sig !== currentSignature) {
      currentSignature = sig;
      failedSignature = null;
      clearTimeout(scheduled);
      scheduled = null;
    }
    if (!source.images.length) { show("等待你在商品规格中选择轮播图。"); return; }
    const detail = adapter.details();
    if (!detail.foreign && Core.assetSignature(detail.images) === Core.assetSignature(source.images)) {
      show(`已同步 ${source.images.length} 张 · 图片与顺序一致`);
      return;
    }
    if (detail.foreign || (detail.images.length && detail.fingerprint !== lastWrite)) {
      show("详情已有手动内容，已保留。请先检查详情，清空后可重新同步。", true);
      return;
    }
    if (failedSignature === sig) return;
    show(`已识别 ${source.images.length} 张商品图${toggle.checked ? "，等待同步…" : "，自动同步已关闭。"}`);
    if (!toggle.checked || adapter.isBusy() || scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      if (Date.now() - lastTyping < 1500) { scan(); return; }
      void run();
    }, 1600);
  }

  async function run() {
    if (running || !ready || !draft) return;
    const source = adapter.sources();
    if (source.unsupported) { show(source.unsupported, true); return; }
    if (!source.images.length) { show("请先添加商品轮播图。"); return; }
    if (adapter.isBusy()) { show("请先完成或关闭当前窗口，随后重新同步。"); return; }
    const detail = adapter.details();
    if (!detail.foreign && Core.assetSignature(detail.images) === Core.assetSignature(source.images)) {
      show(`已同步 ${source.images.length} 张 · 无需重复添加`); return;
    }
    if (detail.foreign || (detail.images.length && detail.fingerprint !== lastWrite)) {
      show("详情已有手动内容，已保留。请先检查详情，清空后可重新同步。", true); return;
    }
    const ticket = scope.update(draft, source.images);
    const runDraft = draft;
    const runNames = names;
    running = true;
    userIntervened = false;
    syncButton.disabled = true;
    function guard() {
      scope.update(Core.getDraftKey(location.href), adapter.sources().images);
      if (!scope.isCurrent(ticket)) throw new Error("商品或图片已变化，已暂停本次同步。请重新检查。");
    }
    try {
      const result = await adapter.sync({ source: source.images, expectedDetail: detail.fingerprint,
        names: runNames, guard, progress: show, replace: Boolean(detail.images.length), interrupted: () => userIntervened });
      guard();
      if (draft !== runDraft) return;
      lastWrite = result.fingerprint;
      await saveRecord();
      show(`已同步 ${source.images.length} 张 · 图片与顺序一致`);
    } catch (error) {
      failedSignature = Core.signature(source.images);
      show(error.message || "同步未完成，请检查 TEMU 页面。", true);
    } finally {
      running = false;
      syncButton.disabled = false;
    }
  }

  shadow.querySelector(".min").addEventListener("click", () => shadow.querySelector(".panel").classList.toggle("collapsed"));
  toggle.addEventListener("change", () => {
    if (!toggle.checked) {
      scope.cancel();
      clearTimeout(scheduled);
      scheduled = null;
    }
    failedSignature = null;
    void storage.set({ autoSync: toggle.checked });
    scan();
  });
  syncButton.addEventListener("click", () => { failedSignature = null; void run(); });
  shadow.querySelector('[data-action="retry"]').addEventListener("click", () => { failedSignature = null; scan(); });
  document.addEventListener("click", () => {
    if (ready) { adapter.rememberMaterials(names); void saveRecord().catch(() => {}); }
  }, true);
  for (const name of ["pointerdown", "keydown"]) document.addEventListener(name, event => {
    if (!event.isTrusted || event.composedPath().includes(host)) return;
    if (name === "keydown") lastTyping = Date.now();
    if (running) { userIntervened = true; scope.cancel(); }
  }, true);
  let scanTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  // SPA navigation or a closed modal may not change an image attribute.
  setInterval(scan, 2000);
  void storage.get("autoSync").then(result => {
    toggle.checked = result.autoSync !== false;
    return loadDraft(Core.getDraftKey(location.href));
  }).catch(() => { ready = true; show("扩展存储不可用，请重新加载插件。", true); });
})();
