import {
  deleteScreenshotFromIdb,
  getScreenshotPreview,
  hydrateSnapshotScreenshot,
  saveReadingSnapshot
} from "../services/snapshotService.js";
import { renderReadingSnapshotCard } from "../components/ReadingSnapshotCard.js";

export function createReadingSnapshotHook({ relativeTimeFn, onPersist, onRender }) {
  const onUpdate = () => {
    onPersist?.();
    onRender?.();
  };

  async function ensureScreenshot(link) {
    return hydrateSnapshotScreenshot(link);
  }

  async function saveScreenshot(link, dataUrl) {
    await saveReadingSnapshot(link, dataUrl, { onUpdate });
  }

  function renderSnapshotSection(link) {
    return renderReadingSnapshotCard(link?.readingSnapshot, {
      relativeTimeFn,
      screenshotPreview: getScreenshotPreview(link?.id)
    });
  }

  function bindSnapshotEvents(root, link, handlers) {
    if (!root || !link) return () => {};

    const pasteZone = root.querySelector("#snapshotPasteZone");
    const fileInput = root.querySelector("#snapshotFileInput");
    const continueBtn = root.querySelector("#continueOriginalBtn");

    const onPaste = (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => handlers.onScreenshot?.(String(reader.result || ""));
        reader.readAsDataURL(file);
        return;
      }
    };

    const onPasteZoneClick = () => fileInput?.click();
    const onFileChange = () => {
      const file = fileInput?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => handlers.onScreenshot?.(String(reader.result || ""));
      reader.readAsDataURL(file);
      fileInput.value = "";
    };
    const onContinue = () => handlers.onContinue?.();

    pasteZone?.addEventListener("click", onPasteZoneClick);
    pasteZone?.addEventListener("paste", onPaste);
    root.addEventListener("paste", onPaste);
    fileInput?.addEventListener("change", onFileChange);
    continueBtn?.addEventListener("click", onContinue);

    return () => {
      pasteZone?.removeEventListener("click", onPasteZoneClick);
      pasteZone?.removeEventListener("paste", onPaste);
      root.removeEventListener("paste", onPaste);
      fileInput?.removeEventListener("change", onFileChange);
      continueBtn?.removeEventListener("click", onContinue);
    };
  }

  return {
    ensureScreenshot,
    saveScreenshot,
    removeSnapshot: async (link) => {
      if (!link) return;
      await deleteScreenshotFromIdb(link.id);
      link.readingSnapshot = {
        id: `snap_${Date.now().toString(36)}`,
        linkId: link.id,
        screenshotRef: null,
        keyword: "",
        savedAt: new Date().toISOString(),
        status: "empty"
      };
      onUpdate();
    },
    renderSnapshotSection,
    bindSnapshotEvents
  };
}

window.KeepPointSnapshot = {
  createReadingSnapshotHook,
  saveReadingSnapshot,
  hydrateSnapshotScreenshot,
  renderReadingSnapshotCard
};
