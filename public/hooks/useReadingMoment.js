import {
  boostMomentKeyword,
  deleteVisualFromIdb,
  enhanceMomentWithVisual,
  generateMomentForLink,
  getVisualPreview,
  hydrateMomentVisual
} from "../services/momentService.js";
import { renderReadingMomentCard } from "../components/ReadingMomentCard.js";

export function createReadingMomentHook({ relativeTimeFn, onPersist, onRender }) {
  const onUpdate = () => {
    onPersist?.();
    onRender?.();
  };

  async function ensureVisual(link) {
    return hydrateMomentVisual(link);
  }

  async function generateMoment(link) {
    if (!link) return null;
    if (link.readingMoment?.status === "ready" && link.readingMoment?.recall?.primary?.value) {
      return link.readingMoment;
    }
    return generateMomentForLink(link, { onUpdate });
  }

  async function enhanceVisual(link, dataUrl) {
    await enhanceMomentWithVisual(link, dataUrl, { onUpdate });
  }

  function boostKeyword(link, keyword) {
    const ok = boostMomentKeyword(link, keyword);
    if (ok) onUpdate();
    return ok;
  }

  async function removeVisual(link) {
    if (!link) return;
    await deleteVisualFromIdb(link.id);
    if (link.readingMoment?.recall?.secondary) {
      link.readingMoment.recall.secondary = link.readingMoment.recall.secondary.filter((c) => c.type !== "visual");
    }
    onUpdate();
  }

  function renderMomentSection(link) {
    const visualPreview = getVisualPreview(link?.id);
    return renderReadingMomentCard(link?.readingMoment, { relativeTimeFn, visualPreview });
  }

  function bindMomentEvents(root, link, handlers) {
    if (!root || !link) return () => {};

    const pasteZone = root.querySelector("#momentPasteZone");
    const fileInput = root.querySelector("#momentFileInput");
    const keywordInput = root.querySelector("#momentKeywordInput");
    const keywordSaveBtn = root.querySelector("#momentKeywordSaveBtn");
    const continueBtn = root.querySelector("#continueOriginalBtn");
    const boostPanel = root.querySelector("#momentBoostPanel");

    const onPaste = (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => handlers.onVisualPaste?.(String(reader.result || ""));
        reader.readAsDataURL(file);
        return;
      }
    };

    const onPasteZoneClick = () => fileInput?.click();
    const onFileChange = () => {
      const file = fileInput?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => handlers.onVisualPaste?.(String(reader.result || ""));
      reader.readAsDataURL(file);
      fileInput.value = "";
    };

    const onKeywordSave = () => handlers.onKeywordBoost?.(keywordInput?.value);
    const onKeywordKeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      handlers.onKeywordBoost?.(keywordInput?.value);
    };
    const onContinue = () => handlers.onContinue?.();

    pasteZone?.addEventListener("click", onPasteZoneClick);
    pasteZone?.addEventListener("paste", onPaste);
    root.addEventListener("paste", onPaste);
    fileInput?.addEventListener("change", onFileChange);
    keywordSaveBtn?.addEventListener("click", onKeywordSave);
    keywordInput?.addEventListener("keydown", onKeywordKeydown);
    continueBtn?.addEventListener("click", onContinue);

    return () => {
      pasteZone?.removeEventListener("click", onPasteZoneClick);
      pasteZone?.removeEventListener("paste", onPaste);
      root.removeEventListener("paste", onPaste);
      fileInput?.removeEventListener("change", onFileChange);
      keywordSaveBtn?.removeEventListener("click", onKeywordSave);
      keywordInput?.removeEventListener("keydown", onKeywordKeydown);
      continueBtn?.removeEventListener("click", onContinue);
      if (boostPanel?.open) boostPanel.open = false;
    };
  }

  return {
    ensureVisual,
    generateMoment,
    enhanceVisual,
    boostKeyword,
    removeVisual,
    renderMomentSection,
    bindMomentEvents
  };
}

window.KeepPointMoment = {
  createReadingMomentHook,
  generateMomentForLink,
  hydrateMomentVisual,
  renderReadingMomentCard
};
