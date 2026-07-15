"use client";

/**
 * Local carousel compound — replaces the paid HeroUI Pro Carousel.
 *
 * Base: shadcn/ui "Carousel" (21st.dev component 813, MIT) built on
 * `embla-carousel-react` (already a dependency). Adapted for Norish:
 *  1. compound aliases (`Carousel.Content`/`.Item`/`.Previous`/`.Next`/`.Dots`/
 *     `.Thumbnails`/`.Thumbnail`) so call sites keep the pro API;
 *  2. `selectedIndex` exposed from `useCarousel()`;
 *  3. `Carousel.Dots` (scrollSnapList → scrollTo buttons);
 *  4. `Carousel.Thumbnails`/`.Thumbnail` (scrollTo strip with `data-selected`);
 *  5. spacing via `var(--carousel-gap, 1rem)` (matches the pro `--carousel-gap`);
 *  6. free `@heroui/react` Button for Previous/Next;
 *  7. no shadcn Button/Card/cn deps — local class-merge idiom.
 * Emits `data-slot="carousel-viewport-wrapper"` / `"carousel-viewport"` so existing
 * consumer CSS (media-carousel) keeps working.
 */

import type { EmblaCarouselType, EmblaOptionsType, EmblaPluginType } from "embla-carousel";
import type { ComponentPropsWithoutRef, KeyboardEvent, ReactNode } from "react";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import NextImage from "next/image";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Button } from "@heroui/react";
import useEmblaCarousel from "embla-carousel-react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type CarouselOrientation = "horizontal" | "vertical";
type EmblaViewportRef = ReturnType<typeof useEmblaCarousel>[0];

interface CarouselContextValue {
  carouselRef: EmblaViewportRef;
  api: EmblaCarouselType | undefined;
  orientation: CarouselOrientation;
  scrollPrev: () => void;
  scrollNext: () => void;
  scrollTo: (index: number) => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
  selectedIndex: number;
  scrollSnaps: number[];
}

const CarouselContext = createContext<CarouselContextValue | null>(null);

export function useCarousel(): CarouselContextValue {
  const context = useContext(CarouselContext);

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />");
  }

  return context;
}

export interface CarouselProps {
  children: ReactNode;
  className?: string;
  opts?: EmblaOptionsType;
  plugins?: EmblaPluginType[];
  orientation?: CarouselOrientation;
  setApi?: (api: EmblaCarouselType | undefined) => void;
}

function CarouselRoot({
  children,
  className,
  opts,
  plugins,
  orientation = "horizontal",
  setApi,
}: CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    { ...opts, axis: orientation === "vertical" ? "y" : "x" },
    plugins
  );
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([]);

  const onSelect = useCallback((embla: EmblaCarouselType) => {
    setSelectedIndex(embla.selectedScrollSnap());
    setCanScrollPrev(embla.canScrollPrev());
    setCanScrollNext(embla.canScrollNext());
  }, []);

  const scrollPrev = useCallback(() => api?.scrollPrev(), [api]);
  const scrollNext = useCallback(() => api?.scrollNext(), [api]);
  const scrollTo = useCallback((index: number) => api?.scrollTo(index), [api]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext]
  );

  useEffect(() => {
    if (api && setApi) setApi(api);
  }, [api, setApi]);

  useEffect(() => {
    if (!api) return;

    const onReInit = (embla: EmblaCarouselType) => {
      setScrollSnaps(embla.scrollSnapList());
      onSelect(embla);
    };

    onReInit(api);
    api.on("select", onSelect);
    api.on("reInit", onReInit);

    return () => {
      api.off("select", onSelect);
      api.off("reInit", onReInit);
    };
  }, [api, onSelect]);

  const value = useMemo<CarouselContextValue>(
    () => ({
      carouselRef,
      api,
      orientation,
      scrollPrev,
      scrollNext,
      scrollTo,
      canScrollPrev,
      canScrollNext,
      selectedIndex,
      scrollSnaps,
    }),
    [
      carouselRef,
      api,
      orientation,
      scrollPrev,
      scrollNext,
      scrollTo,
      canScrollPrev,
      canScrollNext,
      selectedIndex,
      scrollSnaps,
    ]
  );

  return (
    <CarouselContext.Provider value={value}>
      <div
        aria-roledescription="carousel"
        className={cx("relative", className)}
        data-slot="carousel-root"
        role="region"
        onKeyDownCapture={handleKeyDown}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

interface CarouselContentProps {
  children: ReactNode;
  className?: string;
}

function CarouselContent({ children, className }: CarouselContentProps) {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div className="relative h-full" data-slot="carousel-viewport-wrapper">
      <div
        ref={carouselRef}
        className="h-full overflow-hidden"
        data-slot="carousel-viewport"
      >
        <div
          className={cx("flex", orientation === "vertical" && "flex-col", className)}
          data-slot="carousel-track"
          style={{ gap: "var(--carousel-gap, 1rem)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

interface CarouselItemProps {
  children: ReactNode;
  className?: string;
}

function CarouselItem({ children, className }: CarouselItemProps) {
  return (
    <div
      aria-roledescription="slide"
      className={cx("min-w-0 shrink-0 grow-0 basis-full", className)}
      data-slot="carousel-item"
      role="group"
    >
      {children}
    </div>
  );
}

type CarouselButtonProps = Omit<ComponentPropsWithoutRef<typeof Button>, "children">;

function CarouselPrevious({ className, ...props }: CarouselButtonProps) {
  const { scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      isIconOnly
      aria-label="Previous slide"
      className={cx(
        "absolute top-1/2 left-2 z-10 size-9 min-w-9 -translate-y-1/2 rounded-full",
        className
      )}
      isDisabled={!canScrollPrev}
      variant="ghost"
      onPress={scrollPrev}
      {...props}
    >
      <ChevronLeftIcon className="size-5" />
    </Button>
  );
}

function CarouselNext({ className, ...props }: CarouselButtonProps) {
  const { scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      isIconOnly
      aria-label="Next slide"
      className={cx(
        "absolute top-1/2 right-2 z-10 size-9 min-w-9 -translate-y-1/2 rounded-full",
        className
      )}
      isDisabled={!canScrollNext}
      variant="ghost"
      onPress={scrollNext}
      {...props}
    >
      <ChevronRightIcon className="size-5" />
    </Button>
  );
}

type CarouselDotsProps = Omit<ComponentPropsWithoutRef<"div">, "children">;

function CarouselDots({ className, ...props }: CarouselDotsProps) {
  const { scrollSnaps, selectedIndex, scrollTo } = useCarousel();

  if (scrollSnaps.length <= 1) return null;

  return (
    <div className={cx("flex items-center justify-center gap-1.5", className)} {...props}>
      {scrollSnaps.map((_, index) => (
        <button
          key={index}
          aria-label={`Go to slide ${index + 1}`}
          className={cx(
            "size-2 rounded-full bg-white/50 transition-colors",
            "data-[selected=true]:bg-white"
          )}
          data-selected={index === selectedIndex}
          type="button"
          onClick={() => scrollTo(index)}
        />
      ))}
    </div>
  );
}

interface CarouselThumbnailsProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  children: ReactNode;
  /** Accepted for pro-API parity; visual-only, no-op here. */
  scrollShadowSize?: number;
}

function CarouselThumbnails({
  children,
  className,
  scrollShadowSize: _scrollShadowSize,
  ...props
}: CarouselThumbnailsProps) {
  return (
    <div className={cx("flex gap-2", className)} {...props}>
      {children}
    </div>
  );
}

interface CarouselThumbnailProps {
  src: string;
  alt?: string;
  index: number;
  className?: string;
}

function CarouselThumbnail({ src, alt, index, className }: CarouselThumbnailProps) {
  const { selectedIndex, scrollTo } = useCarousel();

  return (
    <button
      aria-label={alt || `Go to image ${index + 1}`}
      className={cx(
        "relative size-16 shrink-0 overflow-hidden rounded-lg opacity-60 transition-opacity",
        "data-[selected=true]:opacity-100 data-[selected=true]:ring-2 data-[selected=true]:ring-white",
        className
      )}
      data-selected={index === selectedIndex}
      type="button"
      onClick={() => scrollTo(index)}
    >
      <NextImage
        fill
        unoptimized
        alt={alt || `Image ${index + 1}`}
        className="object-cover"
        sizes="64px"
        src={src}
      />
    </button>
  );
}

export const Carousel = Object.assign(CarouselRoot, {
  Content: CarouselContent,
  Item: CarouselItem,
  Previous: CarouselPrevious,
  Next: CarouselNext,
  Dots: CarouselDots,
  Thumbnails: CarouselThumbnails,
  Thumbnail: CarouselThumbnail,
});

export default Carousel;
