"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";

import { FallbackPlaceholder, useImageErrors } from "./fallback-image";

export interface ImageLightboxProps {
  images: {
    src: string;
    alt?: string;
  }[];
  initialIndex?: number;
  isOpen: boolean;
  backdropClassName?: string;
  containerClassName?: string;
  onClose: () => void;
}
export default function ImageLightbox({
  images,
  initialIndex = 0,
  isOpen,
  backdropClassName,
  containerClassName,
  onClose,
}: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [direction, setDirection] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const { handleImageError, hasError } = useImageErrors();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || images.length === 0) return;

    setCurrentIndex(Math.max(0, Math.min(initialIndex, images.length - 1)));
    setDirection(0);
  }, [images.length, initialIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const goToPrevious = useCallback(() => {
    if (images.length <= 1) return;
    setDirection(-1);
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);
  const goToNext = useCallback(() => {
    if (images.length <= 1) return;
    setDirection(1);
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          goToPrevious();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case "Escape":
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goToPrevious, goToNext, onClose]);

  if (!isOpen || !isMounted || images.length === 0) return null;

  const safeCurrentIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
  const currentImage = images[safeCurrentIndex];
  const showNavigation = images.length > 1;
  const slideVariants = {
    enter: (dir: number) => ({
      x: dir !== 0 ? (dir > 0 ? 300 : -300) : 0,
      opacity: dir !== 0 ? 0 : 1,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir !== 0 ? (dir < 0 ? 300 : -300) : 0,
      opacity: 0,
    }),
  };

  return createPortal(
    <div
      aria-label={currentImage?.alt || `Image ${safeCurrentIndex + 1}`}
      aria-modal="true"
      className={`fixed inset-0 z-[5000] bg-black/95 text-white ${backdropClassName ?? ""}`}
      role="dialog"
    >
      <div
        className={`fixed inset-0 z-[5001] flex h-[100dvh] w-[100dvw] flex-col overflow-hidden ${containerClassName ?? ""}`}
      >
        <header className="relative z-30 flex shrink-0 items-center justify-between gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2 sm:px-6 sm:pt-[calc(1rem+env(safe-area-inset-top))] sm:pb-3">
          {showNavigation ? (
            <div className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium tabular-nums backdrop-blur-md">
              {safeCurrentIndex + 1} / {images.length}
            </div>
          ) : (
            <div />
          )}

          <Button
            isIconOnly
            aria-label="Close image viewer"
            className="size-10 min-w-10 rounded-full bg-white/10 text-white backdrop-blur-md hover:bg-white/15"
            variant="tertiary"
            onPress={onClose}
          >
            <XMarkIcon className="size-5" />
          </Button>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-2 sm:px-16 sm:py-4">
          <div className="relative h-[min(62dvh,720px)] w-full max-w-5xl sm:h-[min(68dvh,760px)]">
            {showNavigation && (
              <Button
                isIconOnly
                aria-label="Previous image"
                className="absolute top-1/2 left-2 z-30 size-10 min-w-10 -translate-y-1/2 rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/20 sm:-left-14 sm:size-12 sm:min-w-12"
                variant="tertiary"
                onPress={goToPrevious}
              >
                <ChevronLeftIcon className="size-5 sm:size-6" />
              </Button>
            )}

            <AnimatePresence custom={direction} initial={false} mode="wait">
              <motion.div
                key={safeCurrentIndex}
                animate="center"
                className="absolute inset-0 flex items-center justify-center"
                custom={direction}
                exit="exit"
                initial="enter"
                transition={{
                  x: {
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                  },
                  opacity: {
                    duration: 0.2,
                  },
                }}
                variants={slideVariants}
              >
                {hasError(currentImage?.src || "") ? (
                  <FallbackPlaceholder className="max-h-full max-w-full rounded-2xl" />
                ) : (
                  <Image
                    fill
                    unoptimized
                    alt={currentImage?.alt || `Image ${safeCurrentIndex + 1}`}
                    className="object-contain"
                    sizes="(min-width: 1024px) 1024px, 92vw"
                    src={currentImage?.src || ""}
                    onError={() => handleImageError(currentImage?.src || "")}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            {showNavigation && (
              <Button
                isIconOnly
                aria-label="Next image"
                className="absolute top-1/2 right-2 z-30 size-10 min-w-10 -translate-y-1/2 rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/20 sm:-right-14 sm:size-12 sm:min-w-12"
                variant="tertiary"
                onPress={goToNext}
              >
                <ChevronRightIcon className="size-5 sm:size-6" />
              </Button>
            )}
          </div>
        </div>

        {showNavigation && (
          <footer className="relative z-30 shrink-0 px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-3 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto flex max-w-full justify-start gap-2 overflow-x-auto py-1 sm:justify-center">
              {images.map((img, idx) => (
                <button
                  key={`${img.src}-${idx}`}
                  aria-label={`Show image ${idx + 1}`}
                  aria-current={idx === safeCurrentIndex}
                  className={`relative size-12 shrink-0 overflow-hidden rounded-xl border-2 transition-opacity sm:size-14 ${
                    idx === safeCurrentIndex
                      ? "border-white opacity-100"
                      : "border-transparent opacity-55 hover:opacity-85"
                  }`}
                  type="button"
                  onClick={() => {
                    setDirection(idx > safeCurrentIndex ? 1 : -1);
                    setCurrentIndex(idx);
                  }}
                >
                  <Image
                    fill
                    unoptimized
                    alt={img.alt || `Thumbnail ${idx + 1}`}
                    className="object-cover"
                    sizes="56px"
                    src={img.src}
                  />
                </button>
              ))}
            </div>
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
