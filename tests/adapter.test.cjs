"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const Core = require("../extension/core.js");
const { createAdapter } = require("../extension/adapter.js");
const A = "https://img.kwcdn.com/product/fancy/a.jpg";
const B = "https://img.kwcdn.com/product/fancy/b.jpg";
const C = "https://img.kwcdn.com/product/fancy/c.jpg";
const image = url => ({ url });

function fixture({ source = [A, B], detail = [], manualText = "", materials = [A, B, C], onMaterialOpen,
  clearConfirmation = false, discardConfirmation = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="materialMultiLanguages"><input type="checkbox" checked></div>
    <div id="productSkcList[0].carouselImgsI18n.common"></div>
    <div class="decoration_preview__test"><div class="preview_view__test"></div><button>开始装修</button></div>
    <button id="publish">创建</button><button id="draft">保存草稿</button><button>确认</button>
  </body>`, { url: "https://agentseller.temu.com/goods/edit?productDraftId=123", pretendToBeVisual: true, runScripts: "outside-only" });
  const { document: doc } = dom.window;
  dom.window.Element.prototype.getClientRects = function () {
    return this.isConnected && !this.closest('[hidden], [style="display: none;"]') ? [{ width: 100, height: 100 }] : [];
  };
  const calls = { publish: 0, draft: 0, saves: 0, cancels: 0, clearConfirms: 0, discardConfirms: 0, picks: [], searches: [] };
  doc.getElementById("publish").onclick = () => calls.publish++;
  doc.getElementById("draft").onclick = () => calls.draft++;
  const sourceField = doc.getElementById("productSkcList[0].carouselImgsI18n.common");
  function setSources(urls) {
    sourceField.innerHTML = urls.map(url => `<img class="preview-image_img__test" src="${url}?imageMogr2/thumbnail/300x">`).join("");
  }
  setSources(source);
  function renderDetail(urls) {
    doc.querySelector(".preview_view__test").innerHTML = urls.map(url => `<div class="preview_item__test"><img src="${url}"></div>`).join("") +
      (manualText ? `<div class="preview_item__test"><p>${manualText}</p></div>` : "");
  }
  renderDetail(detail);
  function modal(title, html) {
    const el = doc.createElement("div");
    el.setAttribute("data-testid", "beast-core-modal");
    el.innerHTML = `<div class="MDL_header_test">${title}</div>${html}`;
    doc.body.append(el);
    return el;
  }
  function openEditor() {
    const components = [...detail];
    const panel = modal("详情页装修", `<div class="editor_editor__test"><div class="side-left_sectionItem__test">图片</div><div class="components"></div><div class="side-right"></div></div><div class="footer_footer__test"><button>保存</button><button>取消</button><a>清空</a></div>`);
    const editor = panel.querySelector(".editor_editor__test");
    function renderComponents() {
      panel.querySelector(".components").innerHTML = components.map((url, i) => `<div class="content_template__test" id="dnd-template-${i}"><div class="toolbar">图片 ${i + 1}</div><div class="preview_preview__test">${url ? `<img src="${url}?imageMogr2/thumbnail/375x">` : "请在右侧面板添加图片"}</div></div>`).join("");
    }
    renderComponents();
    const [save, cancel] = panel.querySelectorAll(".footer_footer__test button");
    save.onclick = () => { detail = [...components]; renderDetail(detail); calls.saves++; panel.remove(); };
    cancel.onclick = () => {
      calls.cancels++;
      if (!discardConfirmation) { panel.remove(); return; }
      const prompt = modal("", '确认直接退出吗？当前已填写内容将不会被保存<button>确认</button><button>取消</button>');
      prompt.querySelector("button").onclick = () => { calls.discardConfirms++; prompt.remove(); panel.remove(); };
      prompt.querySelectorAll("button")[1].onclick = () => prompt.remove();
    };
    panel.querySelector(".footer_footer__test a").onclick = () => {
      if (!clearConfirmation) { components.length = 0; renderComponents(); return; }
      const popover = doc.createElement("div");
      popover.setAttribute("data-testid", "beast-core-portal-main");
      popover.innerHTML = `<div class="PP_popoverContent_test">${typeof clearConfirmation === "string" ? clearConfirmation : "确认要清空吗?"}</div><button>确认</button><button>取消</button>`;
      doc.body.append(popover);
      popover.querySelector("button").onclick = () => {
        calls.clearConfirms++; components.length = 0; renderComponents(); popover.remove();
      };
      popover.querySelectorAll("button")[1].onclick = () => popover.remove();
    };
    panel.querySelector(".side-left_sectionItem__test").onclick = () => {
      components.push(null);
      renderComponents();
      const right = panel.querySelector(".side-right");
      right.innerHTML = "<button>从素材中心添加</button>";
      right.querySelector("button").onclick = () => {
        const lib = modal("素材中心进入素材中心", '<input placeholder="请输入素材名称"><div class="gallery"></div><footer><button disabled>确认</button><button>取消</button></footer>');
        let selected;
        function renderCards(urls) {
          const gallery = lib.querySelector(".gallery");
          gallery.innerHTML = "";
          for (const url of urls) {
            const card = doc.createElement("div");
            card.className = "index-module_cardContainer__test";
            card.innerHTML = `<img src="${url}?imageMogr2/thumbnail/144x"><div class="index-module_materialName__test"><style>.hidden{display:none}</style>${url.split("/").pop()}</div>`;
            card.onclick = () => { selected = url; lib.querySelector("footer button").disabled = false; };
            gallery.append(card);
          }
        }
        renderCards(materials);
        lib.querySelector("input").onkeydown = event => {
          if (event.key === "Enter") {
            calls.searches.push(event.target.value);
            renderCards([A, B, C].filter(url => url.endsWith(event.target.value)));
          }
        };
        const [confirm, dismiss] = lib.querySelectorAll("footer button");
        confirm.onclick = () => {
          components[components.length - 1] = selected;
          calls.picks.push(selected);
          renderComponents();
          right.innerHTML = "";
          lib.remove();
        };
        dismiss.onclick = () => lib.remove();
        onMaterialOpen?.({ lib, panel, editor });
      };
    };
  }
  doc.querySelector(".decoration_preview__test button").onclick = openEditor;
  return { dom, doc, calls, setSources, adapter: createAdapter(doc) };
}

async function run(f, extra = {}) {
  const before = f.adapter.details();
  return f.adapter.sync({ source: f.adapter.sources().images, expectedDetail: before.fingerprint,
    names: new Map(), guard() {}, progress() {}, ...extra });
}

function extraSource(f, index, language, urls) {
  const field = f.doc.createElement("div");
  field.id = `productSkcList[${index}].carouselImgsI18n.${language}`;
  field.innerHTML = urls.map(url => `<img class="preview-image_img__test" src="${url}">`).join("");
  f.doc.body.append(field);
  return field;
}

function languageFixture(f, { active = "西班牙语", mode = "inherit" } = {}) {
  const { doc } = f;
  const tabs = doc.createElement("div");
  tabs.setAttribute("data-testid", "beast-core-tab");
  tabs.innerHTML = '<div data-testid="beast-core-tab-itemLabel-wrapper">英语</div><div data-testid="beast-core-tab-itemLabel-wrapper">西班牙语<span>自定义</span></div>';
  doc.body.append(tabs);
  const config = doc.createElement("div");
  config.className = "decoration-i18n-config_container__test";
  config.innerHTML = `<label data-testid="beast-core-radio" data-checked="${mode === "inherit"}"><input type="radio" ${mode === "inherit" ? "checked" : ""}>使用英语图片素材</label><label data-testid="beast-core-radio" data-checked="${mode === "none"}"><input type="radio" ${mode === "none" ? "checked" : ""}>不使用任何详情图文素材</label>`;
  doc.body.append(config);
  let radioChanges = 0;
  config.addEventListener("click", () => radioChanges++);
  const preview = doc.querySelector(".decoration_preview__test");
  function select(label) {
    tabs.querySelectorAll('[data-testid="beast-core-tab-itemLabel-wrapper"]').forEach((item, index) => {
      item.className = (index === 0 ? "英语" : "西班牙语") === label ? "TAB_active_test" : "";
    });
    preview.hidden = label !== "英语";
    config.hidden = label === "英语";
  }
  tabs.querySelectorAll('[data-testid="beast-core-tab-itemLabel-wrapper"]').forEach((item, index) => {
    item.onclick = () => select(index === 0 ? "英语" : "西班牙语");
  });
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  doc.getElementById("materialMultiLanguages").append(checkbox);
  select(active);
  return { select, config, tabs, get radioChanges() { return radioChanges; } };
}

test("inserts the exact assets in source order, saves only decoration, never publishes", async t => {
  const f = fixture({ source: [B, A] });
  t.after(() => f.dom.window.close());
  const result = await run(f);
  assert.deepEqual(f.calls.picks, [B, A]);
  assert.deepEqual(result.images.map(x => x.url), [B, A]);
  assert.equal(f.calls.saves, 1);
  assert.equal(f.calls.publish, 0);
  assert.equal(f.calls.draft, 0);
  assert.equal(f.adapter.isBusy(), false);
});

test("missing material cancels scratch editing and preserves the original preview", async t => {
  const f = fixture({ materials: [C] });
  t.after(() => f.dom.window.close());
  await assert.rejects(run(f), /素材不在当前页/);
  assert.equal(f.adapter.details().images.length, 0);
  assert.equal(f.calls.saves, 0);
  assert.equal(f.calls.cancels, 1);
  assert.equal(f.adapter.isBusy(), false);
  assert.equal(f.calls.publish, 0);
});

test("preserves manual text and images even when source images look similar", async t => {
  const f = fixture({ detail: [A], manualText: "Hand-written description" });
  t.after(() => f.dom.window.close());
  const before = f.adapter.details().fingerprint;
  await assert.rejects(run(f, { replace: true }), /详情内容已发生变化/);
  assert.equal(f.adapter.details().fingerprint, before);
  assert.equal(f.calls.saves, 0);
});

test("unowned existing images cannot be replaced", async t => {
  const f = fixture({ detail: [C] });
  t.after(() => f.dom.window.close());
  await assert.rejects(run(f), /详情已存在图片/);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [C]);
  assert.equal(f.calls.saves, 0);
});

test("verified owned image-only detail can be replaced, ignoring editor toolbar labels", async t => {
  const f = fixture({ source: [B, A], detail: [A, B] });
  t.after(() => f.dom.window.close());
  await run(f, { replace: true });
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [B, A]);
  assert.equal(f.calls.publish, 0);
});

test("owned details handle TEMU's clear popover before replacing images", async t => {
  const f = fixture({ source: [B, A], detail: [A, B], clearConfirmation: true });
  t.after(() => f.dom.window.close());
  await run(f, { replace: true });
  assert.equal(f.calls.clearConfirms, 1);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [B, A]);
  assert.equal(f.calls.saves, 1);
  assert.equal(f.calls.publish, 0);
  assert.equal(f.calls.draft, 0);
});

test("an unrelated confirmation is never accepted as permission to clear", async t => {
  const f = fixture({ detail: [C], clearConfirmation: "确认提交吗?" });
  t.after(() => f.dom.window.close());
  await assert.rejects(run(f, { replace: true }), /未识别到详情清空确认/);
  assert.equal(f.calls.clearConfirms, 0);
  assert.equal(f.calls.saves, 0);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [C]);
});

test("a failed replacement discards only its own scratch editor and preserves saved details", async t => {
  const f = fixture({ detail: [C], materials: [C], clearConfirmation: true, discardConfirmation: true });
  t.after(() => f.dom.window.close());
  await assert.rejects(run(f, { replace: true }), /素材不在当前页/);
  assert.equal(f.calls.discardConfirms, 1);
  assert.equal(f.adapter.isBusy(), false);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [C]);
  assert.equal(f.calls.saves, 0);
  assert.equal(f.calls.publish, 0);
});

test("cached material name searches older assets, excluding generated style text", async t => {
  const f = fixture({ source: [A], materials: [B] });
  t.after(() => f.dom.window.close());
  const names = new Map([[Core.normalizeImage(A).assetKey, "a.jpg"]]);
  await run(f, { names });
  assert.deepEqual(f.calls.searches, ["a.jpg"]);
  assert.equal(names.get(Core.normalizeImage(B).assetKey), "b.jpg");
  assert.deepEqual(f.calls.picks, [A]);
});

test("a source/draft change during selection aborts before any save or publish", async t => {
  let cancelled = false;
  const f = fixture({ onMaterialOpen() { cancelled = true; } });
  t.after(() => f.dom.window.close());
  await assert.rejects(run(f, { guard() { if (cancelled) throw new Error("draft changed"); } }), /draft changed/);
  assert.equal(f.calls.saves, 0);
  assert.equal(f.calls.publish, 0);
  assert.equal(f.adapter.details().images.length, 0);
});

test("user intervention stops automation and leaves their open editor intact", async t => {
  let interrupted = false;
  const f = fixture({ onMaterialOpen() { interrupted = true; } });
  t.after(() => f.dom.window.close());
  await assert.rejects(run(f, { interrupted: () => interrupted }), /操作已暂停/);
  assert.equal(f.calls.saves, 0);
  assert.equal(f.calls.cancels, 0);
  assert.equal(f.adapter.isBusy(), true);
});

test("all English color rows merge in page order while other language images remain separate", t => {
  const f = fixture({ source: [B, A] });
  t.after(() => f.dom.window.close());
  extraSource(f, 1, "common", [A, C]);
  extraSource(f, 0, "es", [C]);
  assert.equal(f.adapter.sources().unsupported, null);
  assert.equal(f.adapter.sources().variantCount, 2);
  assert.deepEqual(f.adapter.sources().images.map(x => x.url), [B, A, C]);
  const language = f.doc.createElement("input");
  language.type = "checkbox";
  language.checked = true;
  f.doc.getElementById("materialMultiLanguages").append(language);
  assert.equal(f.adapter.sources().languageCount, 2);
  assert.deepEqual(f.adapter.sources().images.map(x => x.url), [B, A, C]);
});

test("extension privileges cover only seller editing pages and local settings", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../extension/manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://agentseller.temu.com/goods/*"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background, undefined);
});

async function loadContent(f, settings = {}) {
  const values = { ...settings };
  f.dom.window.chrome = { storage: { local: {
    async get(key) { return { [key]: values[key] }; },
    async set(record) { Object.assign(values, record); }
  } } };
  for (const file of ["core.js", "adapter.js", "content.js"]) {
    f.dom.window.eval(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"));
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  return { values, shadow: f.doc.getElementById("temu-image-sync-panel").shadowRoot };
}

async function until(read, timeout = 5000) {
  const start = Date.now();
  while (!read()) {
    if (Date.now() - start > timeout) throw new Error("controller did not reach expected result");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test("controller automatically synchronizes a confirmed image list and does not run twice", async t => {
  const f = fixture();
  t.after(() => f.dom.window.close());
  const { shadow, values } = await loadContent(f);
  await until(() => /已同步 2 张/.test(shadow.querySelector(".status").textContent));
  assert.deepEqual(f.calls.picks, [A, B]);
  assert.equal(f.calls.saves, 1);
  assert.equal(f.calls.publish, 0);
  assert.equal(f.calls.draft, 0);
  assert.ok(values["draft:https://agentseller.temu.com/goods/edit?productDraftId=123"].lastWrite);
  shadow.querySelector('[data-action="sync"]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.calls.saves, 1);
});

test("controller automatically follows image additions, deletions, and reorderings with clear confirmation", async t => {
  const f = fixture({ clearConfirmation: true });
  t.after(() => f.dom.window.close());
  await loadContent(f);
  await until(() => f.calls.saves === 1);
  for (const [index, urls] of [[A, B, C], [A, C], [C, A]].entries()) {
    f.setSources(urls);
    await until(() => f.calls.saves === index + 2);
    assert.deepEqual(f.adapter.details().images.map(x => x.url), urls);
  }
  assert.equal(f.calls.clearConfirms, 3);
  assert.equal(f.calls.publish, 0);
  assert.equal(f.calls.draft, 0);
});

test("controller protects existing manual content even on an explicit retry", async t => {
  const f = fixture({ source: [A], detail: [C] });
  t.after(() => f.dom.window.close());
  const { shadow } = await loadContent(f);
  assert.match(shadow.querySelector(".status").textContent, /已有手动内容/);
  shadow.querySelector('[data-action="sync"]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.calls.saves, 0);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [C]);
});

test("manual synchronization works with automatic mode disabled", async t => {
  const f = fixture({ source: [A] });
  t.after(() => f.dom.window.close());
  const { shadow } = await loadContent(f, { autoSync: false });
  shadow.querySelector('[data-action="sync"]').click();
  await until(() => f.calls.saves === 1);
  assert.deepEqual(f.calls.picks, [A]);
  assert.equal(f.calls.publish, 0);
});

test("turning automatic mode off cancels work that is only scheduled", async t => {
  const f = fixture({ source: [A] });
  t.after(() => f.dom.window.close());
  const { shadow } = await loadContent(f);
  const toggle = shadow.querySelector("input");
  toggle.checked = false;
  toggle.dispatchEvent(new f.dom.window.Event("change"));
  await new Promise(resolve => setTimeout(resolve, 1850));
  assert.equal(f.calls.saves, 0);
  assert.deepEqual(f.calls.picks, []);
});

test("multiple colors automatically merge and adding, changing or removing a second color updates owned details", async t => {
  const f = fixture({ source: [A], clearConfirmation: true });
  t.after(() => f.dom.window.close());
  const second = extraSource(f, 1, "common", [B, A]);
  await loadContent(f);
  await until(() => f.calls.saves === 1);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [A, B]);
  second.innerHTML = `<img class="preview-image_img_test" src="${C}"><img class="preview-image_img_test" src="${A}">`;
  await until(() => f.calls.saves === 2);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [A, C]);
  second.remove();
  await until(() => f.calls.saves === 3);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [A]);
  extraSource(f, 1, "common", [B]);
  await until(() => f.calls.saves === 4);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [A, B]);
  assert.equal(f.calls.publish, 0);
  assert.equal(f.calls.draft, 0);
});

for (const mode of ["inherit", "none"]) {
  test(`while viewing a non-English page, sync English and preserve its ${mode} setting and tab`, async t => {
    const f = fixture({ source: [B, A] });
    t.after(() => f.dom.window.close());
    const languages = languageFixture(f, { mode });
    extraSource(f, 0, "es", [C]);
    const { shadow } = await loadContent(f);
    await until(() => f.calls.saves === 1 && f.adapter.detailLanguage().label === "西班牙语");
    assert.equal(f.adapter.detailLanguage().mode, mode);
    assert.equal(languages.radioChanges, 0);
    assert.deepEqual(f.calls.picks, [B, A]);
    assert.equal(f.calls.publish, 0);
    assert.equal(f.calls.draft, 0);
    assert.match(shadow.querySelector(".status").textContent, /已同步 2 张/);
    shadow.querySelector('[data-action="retry"]').click();
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.equal(f.calls.saves, 1);
  });
}

test("manual English details stay protected when automatic work starts on a Spanish tab", async t => {
  const f = fixture({ source: [A], detail: [C] });
  t.after(() => f.dom.window.close());
  const languages = languageFixture(f);
  const { shadow } = await loadContent(f);
  await until(() => /已有手动内容/.test(shadow.querySelector(".status").textContent) && f.adapter.detailLanguage().label === "西班牙语");
  assert.equal(f.calls.saves, 0);
  assert.equal(languages.radioChanges, 0);
  assert.equal(f.calls.publish, 0);
  languages.select("英语");
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [C]);
});

test("changing the detail language during insertion stops before saving", async t => {
  let languages;
  const f = fixture({ source: [A], onMaterialOpen() { languages.select("西班牙语"); } });
  t.after(() => f.dom.window.close());
  languages = languageFixture(f, { active: "英语" });
  await assert.rejects(run(f), /详情语言已切换/);
  assert.equal(f.calls.saves, 0);
  assert.equal(f.calls.publish, 0);
});

test("a missing English detail tab never writes to the current non-English page", async t => {
  const f = fixture({ source: [A] });
  t.after(() => f.dom.window.close());
  const languages = languageFixture(f);
  languages.tabs.firstElementChild.remove();
  const { shadow } = await loadContent(f);
  await until(() => /未找到英语详情标签/.test(shadow.querySelector(".status").textContent));
  assert.equal(f.calls.saves, 0);
  assert.equal(languages.radioChanges, 0);
});

test("sorting placeholders defer synchronization until the drag finishes", async t => {
  const f = fixture({ source: [A] });
  t.after(() => f.dom.window.close());
  const img = f.doc.querySelector('img[class*="preview-image_img"]');
  const placeholder = f.doc.createElement("div");
  placeholder.className = "beast-sortable-item";
  placeholder.style.opacity = "0";
  img.replaceWith(placeholder);
  placeholder.append(img);
  const { shadow } = await loadContent(f);
  assert.match(shadow.querySelector(".status").textContent, /等待商品图拖动完成/);
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(f.calls.saves, 0);
  placeholder.style.opacity = "";
  await until(() => f.calls.saves === 1);
  assert.equal(f.calls.publish, 0);
});

test("only localized carousel images do not get copied into English details", async t => {
  const f = fixture({ source: [] });
  t.after(() => f.dom.window.close());
  languageFixture(f);
  extraSource(f, 0, "es", [C]);
  const { shadow } = await loadContent(f);
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.match(shadow.querySelector(".status").textContent, /选择英语轮播图/);
  assert.equal(f.calls.saves, 0);
  assert.deepEqual(f.calls.picks, []);
});

test("legacy 0.1.1 ownership records permit a multi-color update without taking over manual details", async t => {
  const f = fixture({ source: [A], detail: [A], clearConfirmation: true });
  t.after(() => f.dom.window.close());
  const lastWrite = f.adapter.details().fingerprint;
  extraSource(f, 1, "common", [B]);
  await loadContent(f, { "draft:https://agentseller.temu.com/goods/edit?productDraftId=123": {
    names: [], lastWrite, updatedAt: Date.now()
  } });
  await until(() => f.calls.saves === 1);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [A, B]);
  assert.equal(f.calls.publish, 0);
});

test("language switching waits for a remounting English detail form before opening its editor", async t => {
  const f = fixture({ source: [A, B] });
  t.after(() => f.dom.window.close());
  const languages = languageFixture(f);
  const originalPreview = f.doc.querySelector('.decoration_preview__test');
  const englishTab = languages.tabs.firstElementChild;
  const select = englishTab.onclick;
  englishTab.onclick = () => {
    select();
    f.dom.window.setTimeout(() => {
      const replacement = originalPreview.cloneNode(true);
      replacement.querySelector('button').onclick = originalPreview.querySelector('button').onclick;
      originalPreview.replaceWith(replacement);
    }, 150);
  };
  await f.adapter.selectDetailLanguage('英语');
  assert.equal(originalPreview.isConnected, false);
  await run(f);
  assert.equal(f.calls.saves, 1);
  assert.deepEqual(f.adapter.details().images.map(x => x.url), [A, B]);
  assert.equal(f.calls.publish, 0);
});
