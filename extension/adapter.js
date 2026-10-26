(function (root) {
  "use strict";
  const Core = typeof module === "object" && module.exports ? require("./core.js") : root.TemuImageSyncCore;

  function createAdapter(doc) {
    const text = el => (el?.textContent || "").replace(/\s+/g, "").trim();
    const visible = el => Boolean(el?.isConnected && el.getClientRects().length);
    const all = (selector, parent = doc) => Array.from(parent?.querySelectorAll(selector) || []);
    const button = (parent, label) => all("button", parent).find(el => text(el) === label && visible(el) && !el.disabled);
    const footer = editor => editor.closest('[data-testid="beast-core-modal"]').querySelector('[class*="footer_footer"]');
    const editor = () => all('[class*="editor_editor"]').find(visible) || null;
    const material = () => all('[data-testid="beast-core-modal"]').filter(visible).findLast(el =>
      text(el.querySelector('[class*="MDL_header"]')).startsWith("素材中心") && el.querySelector("footer")) || null;

    function sources() {
      const fields = all('[id^="productSkcList["]').filter(el => /\.carouselImgsI18n\.common$/.test(el.id));
      const languages = doc.getElementById("materialMultiLanguages");
      const field = fields[0];
      const images = Core.uniqueImages(fields.flatMap(item => all('img[class*="preview-image_img"]', item)).map(img => ({
        url: img.src.split("?")[0]
      })));
      const sorting = fields.some(item => all('.beast-sortable-item', item).some(el => el.style.opacity === "0"));
      const languageCount = Math.max(1, languages?.querySelectorAll('input[type="checkbox"]:checked').length || 0);
      return { field, fields, images, unsupported: null, sorting, variantCount: fields.length, languageCount };
    }

    const languageLabel = el => /^(英语|西班牙语|法语|阿拉伯语|韩语)/.exec(text(el))?.[0] || null;
    function detailTabs() {
      return all('[data-testid="beast-core-tab"]').find(tab =>
        all('[data-testid="beast-core-tab-itemLabel-wrapper"]', tab).some(el => languageLabel(el) === "英语"));
    }

    function detailLanguage() {
      const tab = detailTabs();
      const active = tab && all('[data-testid="beast-core-tab-itemLabel-wrapper"]', tab).find(el => /\bTAB_active_/.test(el.className));
      const label = tab ? languageLabel(active) : "英语";
      const preview = all('[class*="decoration_preview"]').find(visible);
      if (label === "英语") return { label, mode: preview ? "editor" : "loading" };
      const config = all('[class*="decoration-i18n-config_container"]').find(visible);
      const choice = all('[data-testid="beast-core-radio"]', config).find(el =>
        el.getAttribute("data-checked") === "true" || el.querySelector('input[type="radio"]')?.checked);
      const value = text(choice);
      const mode = value === "使用英语图片素材" ? "inherit" : value === "不使用任何详情图文素材" ? "none" : "unknown";
      return { label, mode };
    }

    async function selectDetailLanguage(label, guard = () => {}) {
      guard();
      if (isBusy()) throw new Error("请先关闭素材中心或装修窗口，再切换详情语言。");
      const initial = detailLanguage();
      const changed = initial.label !== label || initial.mode === "loading";
      if (!changed && ["editor", "inherit", "none"].includes(initial.mode)) return initial;
      if (changed) {
        const tab = detailTabs();
        const target = all('[data-testid="beast-core-tab-itemLabel-wrapper"]', tab).find(el => languageLabel(el) === label && visible(el));
        if (!target) throw new Error(`未找到${label}详情标签，已停止同步。`);
        target.click();
      }
      const start = Date.now();
      let stableSince = start;
      let previousRoot = null;
      let previousFingerprint = null;
      for (;;) {
        guard();
        const current = detailLanguage();
        if (current.label === label && ["editor", "inherit", "none"].includes(current.mode)) {
          const detail = label === "英语" ? details() : null;
          const currentRoot = detail?.root || all('[class*="decoration-i18n-config_container"]').find(visible);
          const fingerprint = detail?.fingerprint || current.mode;
          if (currentRoot !== previousRoot || fingerprint !== previousFingerprint) {
            previousRoot = currentRoot;
            previousFingerprint = fingerprint;
            stableSince = Date.now();
          }
          // The tab highlight can change before its detail form has finished remounting.
          if (currentRoot && Date.now() - stableSince >= 650) return current;
        } else {
          previousRoot = null;
          previousFingerprint = null;
          stableSince = Date.now();
        }
        if (Date.now() - start > 5000) throw new Error("详情语言页未能加载，已停止同步。");
        await new Promise(resolve => setTimeout(resolve, 80));
      }
    }

    function entries(container, selector) {
      return all(selector, container).map(el => ({
        images: Core.uniqueImages(all("img", el).map(img => ({ url: img.src.split("?")[0] }))),
        text: text(el)
      }));
    }

    function details() {
      const preview = all('[class*="decoration_preview"]').find(visible) || null;
      const rows = preview ? entries(preview, '[class*="preview_item"]') : [];
      return {
        root: preview,
        images: rows.flatMap(row => row.images),
        foreign: rows.some(row => row.text || row.images.length !== 1),
        fingerprint: JSON.stringify(rows.map(row => [Core.assetSignature(row.images), row.text]))
      };
    }

    function editorEntries(el) {
      return all('[id^="dnd-template-"]', el).map(component => {
        const preview = component.querySelector('[class*="preview_preview"]') || component;
        return { images: Core.uniqueImages(all("img", preview).map(img => ({ url: img.src.split("?")[0] }))), text: text(preview) };
      });
    }

    function isBusy() {
      return all('[data-testid="beast-core-modal"]').some(visible);
    }

    function rememberMaterials(names) {
      const panel = material();
      if (!panel) return;
      for (const card of all('[class*="index-module_cardContainer"]', panel)) {
        const image = Core.normalizeImage(card.querySelector("img")?.src || "");
        const name = card.querySelector('[class*="index-module_materialName"]');
        if (image && name) {
          const label = name.cloneNode(true);
          all("style,script", label).forEach(el => el.remove());
          if (label.textContent.trim()) names.set(image.assetKey, label.textContent.trim());
        }
      }
    }

    const same = (a, b) => Core.assetSignature(a) === Core.assetSignature(b);

    async function sync({ source, expectedDetail, names, guard, progress, replace = false, interrupted = () => false }) {
      let ownedEditor = null;
      let ownedMaterial = null;
      let ownedClear = null;
      const check = () => {
        guard();
        if (interrupted()) throw new Error("操作已暂停，请继续手动编辑，或关闭编辑器后重试同步。");
        if (detailLanguage().label !== "英语") throw new Error("详情语言已切换，已停止同步，避免写入其他语言。");
      };
      async function waitFor(read, message, timeout = 12000) {
        const start = Date.now();
        for (;;) {
          check();
          const result = read();
          if (result) return result;
          if (Date.now() - start > timeout) throw new Error(message);
          await new Promise(resolve => setTimeout(resolve, 120));
        }
      }
      function click(el, missing) {
        check();
        if (!visible(el) || el.disabled) throw new Error(missing);
        el.click();
      }
      function cancel(el) {
        if (el?.isConnected) button(el, "取消")?.click();
      }
      async function discardEditor() {
        if (!ownedEditor?.isConnected || interrupted()) return;
        const panel = ownedEditor.closest('[data-testid="beast-core-modal"]');
        const previous = new Set(all('[data-testid="beast-core-modal"]'));
        cancel(panel);
        const start = Date.now();
        while (panel.isConnected && visible(panel) && !interrupted() && Date.now() - start < 1800) {
          const prompt = all('[data-testid="beast-core-modal"]').find(el => !previous.has(el) && visible(el) &&
            /^确认直接退出吗[？?]当前已填写内容将不会被保存/.test(text(el)));
          if (prompt) {
            const confirm = button(prompt, "确认");
            if (confirm) confirm.click();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 80));
        }
      }
      try {
        check();
        if (isBusy()) throw new Error("请先关闭正在使用的素材中心或编辑窗口。");
        const before = details();
        if (!before.root) throw new Error("未找到英语详情装修入口，已停止同步。");
        if (before.foreign || before.fingerprint !== expectedDetail) throw new Error("详情内容已发生变化，已保留现有内容，请检查后重试。");
        if (before.images.length && !replace) throw new Error("详情已存在图片，已暂停自动覆盖。");
        progress("正在打开详情装修…");
        click(button(before.root, "开始装修"), "未找到详情装修入口，页面结构可能已更新。");
        ownedEditor = await waitFor(editor, "详情编辑器未能加载，请检查 TEMU 网络后重试。");
        const rows = editorEntries(ownedEditor);
        if (rows.some(row => row.text || row.images.length !== 1) || !same(rows.flatMap(row => row.images), before.images)) {
          throw new Error("详情编辑器的内容与预览不一致，已停止同步。");
        }
        if (rows.length) {
          // Only previously owned, unmodified image-only content reaches here.
          const clear = all("a", footer(ownedEditor)).find(el => text(el) === "清空");
          const previous = new Set(all('[data-testid="beast-core-portal-main"]'));
          click(clear, "未找到详情清空入口，已保留原内容。");
          const cleared = await waitFor(() => {
            if (editorEntries(ownedEditor).length === 0) return true;
            return all('[data-testid="beast-core-portal-main"]').find(el => !previous.has(el) && visible(el) &&
              /^确认要清空吗[?？]$/.test(text(el.querySelector('[class*="PP_popoverContent"]'))));
          }, "未识别到详情清空确认，已停止更新并保留原详情。", 3000);
          if (cleared !== true) {
            ownedClear = cleared;
            click(button(ownedClear, "确认"), "未找到详情清空确认按钮，已停止更新。");
            await waitFor(() => editorEntries(ownedEditor).length === 0, "详情内容未能清空，已停止更新并保留原详情。");
            ownedClear = null;
          }
        }
        for (let i = 0; i < source.length; i++) {
          check();
          progress(`正在同步第 ${i + 1} / ${source.length} 张…`);
          const picture = all('[class*="side-left_sectionItem"]', ownedEditor).find(el => text(el) === "图片");
          click(picture, "未找到详情图片组件，页面结构可能已更新。");
          const add = await waitFor(() => button(ownedEditor, "从素材中心添加"), "图片组件未能加载。");
          click(add, "未找到素材选择入口。");
          ownedMaterial = await waitFor(material, "素材中心未能加载，请检查 TEMU 网络后重试。");
          rememberMaterials(names);
          const findCard = () => all('[class*="index-module_cardContainer"]', ownedMaterial).find(card => {
            const image = Core.normalizeImage(card.querySelector("img")?.src || "");
            return image?.assetKey === source[i].assetKey;
          });
          let card = findCard();
          if (!card) {
            const name = names.get(source[i].assetKey);
            if (!name) throw new Error("素材不在当前页。请重新从商品图素材中心确认图片后重试，插件会记录素材名称。");
            const search = ownedMaterial.querySelector('input[placeholder="请输入素材名称"]');
            if (!search) throw new Error("未找到素材搜索框。");
            check();
            const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, "value").set;
            setter.call(search, name);
            search.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
            search.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
            search.dispatchEvent(new doc.defaultView.KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
            card = await waitFor(findCard, "未找到对应商品素材，请手动确认素材仍然可用。");
          }
          if (/index-module_disabled/.test(card.className)) throw new Error("该商品图在详情素材中心不可用，请在 TEMU 中检查该图片。");
          click(card, "未能选择对应商品素材。");
          const confirm = await waitFor(() => button(ownedMaterial.querySelector("footer"), "确认"), "素材未能选中。");
          click(confirm, "未找到素材确认按钮。");
          await waitFor(() => !ownedMaterial.isConnected || !visible(ownedMaterial), "素材选择窗口未能关闭。");
          ownedMaterial = null;
          await waitFor(() => {
            const inserted = editorEntries(ownedEditor);
            return inserted.length === i + 1 && same(inserted.flatMap(row => row.images), source.slice(0, i + 1));
          }, "详情图片与商品图不一致，已停止同步。");
        }
        check();
        progress("正在保存详情装修…");
        click(button(footer(ownedEditor), "保存"), "未找到详情装修保存按钮。");
        await waitFor(() => !ownedEditor.isConnected || !visible(ownedEditor), "详情装修未能保存，请检查页面提示。");
        ownedEditor = null;
        const result = await waitFor(() => {
          const current = details();
          return !current.foreign && same(current.images, source) ? current : null;
        }, "保存后预览与商品图不一致，请手动检查详情。");
        return result;
      } catch (error) {
        if (!interrupted()) {
          cancel(ownedClear);
          cancel(ownedMaterial);
          await discardEditor();
        }
        throw error;
      }
    }

    return { sources, details, detailLanguage, selectDetailLanguage, isBusy, rememberMaterials, sync };
  }

  const api = Object.freeze({ createAdapter });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TemuImageSyncAdapter = api;
})(globalThis);
