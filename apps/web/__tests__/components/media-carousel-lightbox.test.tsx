import { describe, expect, it } from "vitest";

import { buildLightboxMedia, type MediaItem } from "@/components/shared/media-carousel";

// MEDIA-UX-01: opening a photo must keep the FULL media set in the lightbox.
// The old code did `items.filter((i) => i.type === "image")`, silently dropping
// every video. buildLightboxMedia must keep videos and preserve order.
describe("buildLightboxMedia (MEDIA-UX-01)", () => {
  const items: MediaItem[] = [
    { type: "video", src: "/v1.mp4", thumbnail: "/v1.jpg", duration: 12, order: 0, id: "v1" },
    { type: "image", src: "/i1.jpg", order: 1, id: "i1" },
    { type: "video", src: "/v2.mp4", thumbnail: null, order: 2, id: "v2" },
  ];

  it("keeps videos (does not drop non-image media)", () => {
    const media = buildLightboxMedia(items);

    expect(media).toHaveLength(3);
    expect(media.map((m) => m.type)).toEqual(["video", "image", "video"]);
  });

  it("preserves order 1:1 so the slide index maps straight to the lightbox index", () => {
    const media = buildLightboxMedia(items);

    expect(media.map((m) => m.src)).toEqual(["/v1.mp4", "/i1.jpg", "/v2.mp4"]);
  });

  it("carries poster + duration onto video entries", () => {
    const [first] = buildLightboxMedia(items);

    expect(first).toMatchObject({
      type: "video",
      src: "/v1.mp4",
      poster: "/v1.jpg",
      duration: 12,
    });
  });

  it("normalises a missing video thumbnail to a null poster", () => {
    const media = buildLightboxMedia(items);
    const secondVideo = media[2];

    expect(secondVideo).toMatchObject({ type: "video", src: "/v2.mp4", poster: null });
  });

  it("emits plain image entries for images", () => {
    const media = buildLightboxMedia(items);

    expect(media[1]).toEqual({ type: "image", src: "/i1.jpg", alt: "Recipe media i1" });
  });
});
