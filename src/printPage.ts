type PageImage = Pick<HTMLImageElement, "complete" | "naturalWidth" | "loading" | "decode" | "addEventListener" | "removeEventListener">;
type ImageRoot = { querySelectorAll: (selector: "img") => ArrayLike<PageImage> };
type ReadinessOptions = { signal?: AbortSignal; timeoutMs?: number };

export async function waitForPageImages(root: ImageRoot, { signal, timeoutMs = 15_000 }: ReadinessOptions = {}) {
  const images = Array.from(root.querySelectorAll("img"));
  const cleanups: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const aborted = () => new Error("PDF preparation was cancelled.");
  try {
    if (signal?.aborted) throw aborted();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Images are still loading. Wait a moment and try PDF again.")), timeoutMs);
      const onAbort = () => reject(aborted());
      signal?.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal?.removeEventListener("abort", onAbort));
    });
    const ready = Promise.all(images.map(async image => {
      if (!image.complete) await new Promise<void>((resolve, reject) => {
        const loaded = () => resolve();
        const failed = () => reject(new Error("A page image could not be loaded. Reload the page or check attachment access, then try PDF again."));
        image.addEventListener("load", loaded, { once: true });
        image.addEventListener("error", failed, { once: true });
        cleanups.push(() => { image.removeEventListener("load", loaded); image.removeEventListener("error", failed); });
        const previous = image.loading;
        cleanups.push(() => { image.loading = previous; });
        image.loading = "eager";
        if (image.complete) image.naturalWidth > 0 ? resolve() : failed();
      });
      if (!image.naturalWidth) throw new Error("A page image is missing. Reload the page or check attachment access, then try PDF again.");
      if (typeof image.decode === "function") {
        try { await image.decode(); }
        catch { throw new Error("A page image could not be decoded. Reload the page and try PDF again."); }
      }
    }));
    await Promise.race([ready, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    cleanups.forEach(cleanup => cleanup());
  }
}

export async function printPage(root: ImageRoot, print: () => void, options?: ReadinessOptions) {
  await waitForPageImages(root, options);
  if (options?.signal?.aborted) throw new Error("PDF preparation was cancelled.");
  print();
}
