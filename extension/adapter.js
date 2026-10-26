(function (root) {
  "use strict";
  const Core = typeof module === "object" && module.exports ? require("./core.js") : root.TemuImageSyncCore;

  function createAdapter(doc) {
    const text = el => (el?.textContent || "").replace(/\s+/g, "").trim();
    const visible = el => Boolean(el?.isConnected && el.getClientRects().length);
    const all = (selector, parent = doc) => Array.from(parent.querySelectorAll(selector));
    const button = (parent, label) => all("button", parent).find(el => text(el) === label && visible(el) && !el.disabled);
    const footer = editor => editor.closest('[data-testid="beast-core-modal"]').querySelector('[class*="footer_footer"]');
    const editor = () => all('[class*="editor_editor"]').find(visible) || null;
    const material = () => all('[data-testid="beast-core-modal"]').filter(visible).findLast(el =>
      text(el.querySelector('[class*="MDL_header"]')).startsWith("素材中心") && el.querySelector("footer")) || null;

    function sources() {
      const fields = all('[id^="productSkcList["]').filter(el => /\.carouselImgsI18n\.common$/.test(el.id));
      const languages = doc.getElementById("materialMultiLanguages");
      let unsupported = null;
      if (fields.length > 1) unsupported = "当前版本仅适配一个颜色规格，请先使用单规格测试商品。";
      if (languages && languages.querySelectorAll('input[type="checkbox"]:checked').length > 1) {
        unsupported = "当前版本仅适配英语素材，请先使用单语言测试商品。";
      }
      const field = fields[0];
      const images = field ? Core.uniqueImages(all('img[class*="preview-image_img"]', field).map(img => ({
        url: img.src.split("?")[0]
      }))) : [];
      return { field, images, unsupported };
    }

    function entries(container, selector) {
      return all(selector, container).map(el => ({
        images: Core.uniqueImages(all("img", el).map(img => ({ url: img.src.split("?")[0] }))),
        text: text(el)
      }));
    }

    function details() {
      const preview = doc.querySelector('[class*="decoration_preview"]');
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
      const check = () => {
        guard();
        if (interrupted()) throw new Error("操作已暂停，请继续手动编辑，或关闭编辑器后重试同步。");
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
      try {
        check();
        if (isBusy()) throw new Error("请先关闭正在使用的素材中心或编辑窗口。");
        const before = details();
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
          click(clear, "未找到详情清空入口，已保留原内容。");
          await waitFor(() => editorEntries(ownedEditor).length === 0, "TEMU 要求手动确认清空，请确认后重新同步。", 1800);
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
          cancel(ownedMaterial);
          if (ownedEditor?.isConnected) cancel(ownedEditor.closest('[data-testid="beast-core-modal"]'));
        }
        throw error;
      }
    }

    return { sources, details, isBusy, rememberMaterials, sync };
  }

  const api = Object.freeze({ createAdapter });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TemuImageSyncAdapter = api;
})(globalThis);
