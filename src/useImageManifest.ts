import { useEffect, useState } from "react";

/**
 * Loads the list of images from public/images/images.json, which the
 * image-manifest Vite plugin regenerates whenever files are added to or
 * removed from that folder — so dropping in any number of PNGs "just works"
 * without ever touching this list by hand.
 */
export function useImageManifest(dir = "/images"): string[] {
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${dir}/images.json`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((files: string[]) => {
        if (!cancelled) setImages(files.map((f) => `${dir}/${f}`));
      })
      .catch(() => {
        if (!cancelled) setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dir]);

  return images;
}
