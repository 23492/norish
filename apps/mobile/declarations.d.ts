declare module "*.svg" {
  import type React from "react";
  import type { SvgProps } from "react-native-svg";
  const content: React.FC<SvgProps>;
  export default content;
}

// `apps/mobile/tsconfig.json` maps `@norish/trpc/*` straight to
// `packages/trpc/src/*` (source, not dist) so router types stay in sync during
// dev. That pulls `packages/shared-server/src/media/storage.ts` into this
// program's type-check, but its ambient declaration for the untyped
// `heic-convert` package (`packages/shared-server/src/global-modules.d.ts`) is
// never loaded here, since it isn't reachable via this tsconfig's `include`.
// Mirroring that same declaration keeps this program self-contained without
// touching packages/shared-server (out of scope for this pass).
declare module "heic-convert" {
  type HeicConvertInput = {
    buffer: ArrayBuffer;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  export default function convert(input: HeicConvertInput): Promise<ArrayBuffer>;
}
