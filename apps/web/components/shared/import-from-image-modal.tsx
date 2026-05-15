"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useUploadLimitsQuery } from "@/hooks/config";
import { useRecipesMutations } from "@/hooks/recipes";
import { useClipboardImagePaste } from "@/hooks/use-clipboard-image-paste";
import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";
import { PhotoIcon, SparklesIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button, Kbd, Modal, toast } from "@heroui/react";
import { useTranslations } from "next-intl";

import { ALLOWED_OCR_MIME_SET, MAX_OCR_FILES } from "@norish/shared/contracts";

interface ImportFromImageModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}
interface FilePreview {
  id: string;
  file: File;
  preview: string;
}
export default function ImportFromImageModal({ isOpen, onOpenChange }: ImportFromImageModalProps) {
  const t = useTranslations("common.import.image");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const { importRecipeFromImages } = useRecipesMutations();
  const { limits } = useUploadLimitsQuery();
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleAddFiles = useCallback(
    (selectedFiles: File[] | FileList | null) => {
      if (!selectedFiles) return;
      const fileArray = Array.isArray(selectedFiles)
        ? selectedFiles
        : Array.from(
            {
              length: selectedFiles.length,
            },
            (_, idx) => selectedFiles[idx]!
          );
      const newFiles: FilePreview[] = [];
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i]!;

        // Validate file type
        if (!ALLOWED_OCR_MIME_SET.has(file.type)) {
          toast(t("invalidType"), {
            description: t("notSupported", {
              name: file.name,
            }),
            variant: "danger",
          });
          continue;
        }

        // Validate file size
        if (file.size > limits.maxImageSize) {
          toast(t("tooLarge"), {
            description: t("exceeds", {
              name: file.name,
            }),
            variant: "danger",
          });
          continue;
        }

        // Create preview
        newFiles.push({
          id: `${Date.now()}-${i}-${file.name}`,
          file,
          preview: URL.createObjectURL(file),
        });
      }
      setFiles((prev) => {
        const total = prev.length + newFiles.length;
        if (total > MAX_OCR_FILES) {
          toast(t("tooMany"), {
            description: t("maxFiles", {
              max: MAX_OCR_FILES,
            }),
            variant: "warning",
          });
          return [...prev, ...newFiles.slice(0, MAX_OCR_FILES - prev.length)];
        }
        return [...prev, ...newFiles];
      });
    },
    [t, limits.maxImageSize]
  );
  useClipboardImagePaste({
    enabled: isOpen,
    onFiles: (pastedFiles) => handleAddFiles(pastedFiles),
  });
  const handleRemoveFile = useCallback((id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleAddFiles(e.dataTransfer.files);
    },
    [handleAddFiles]
  );
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);
  const handleImport = useCallback(() => {
    if (files.length === 0) return;
    setIsSubmitting(true);
    try {
      // Pass raw File objects - FormData conversion happens in mutation
      importRecipeFromImages(files.map((f) => f.file));
      toast(t("importing"), {
        description: t("analyzing"),
        variant: "default",
      });

      // Clean up and close
      files.forEach((f) => {
        URL.revokeObjectURL(f.preview);
      });
      setFiles([]);
      onOpenChange(false);
      router.push("/");
    } catch (error) {
      showSafeErrorToast({
        title: t("failed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error,
        context: "import-from-image-modal:import",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [files, importRecipeFromImages, onOpenChange, router, t, tErrors]);
  const _handleClose = useCallback(() => {
    files.forEach((f) => {
      URL.revokeObjectURL(f.preview);
    });
    setFiles([]);
    onOpenChange(false);
  }, [files, onOpenChange]);
  return (
    <Modal>
      <Modal.Backdrop className="z-[1099]" isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container className="z-[1100]" size="lg">
          <Modal.Dialog>
            {() => (
              <>
                <Modal.Header className="flex flex-col gap-1">{t("title")}</Modal.Header>
                <Modal.Body>
                  {/* Dropzone */}
                  <button
                    className="border-border-secondary hover:border-accent flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 transition-colors"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    <PhotoIcon className="text-muted h-12 w-12" />
                    <div className="text-center">
                      <p className="text-muted text-sm font-medium">{t("dropzone")}</p>
                      <p className="text-muted mt-1 flex items-center justify-center gap-1.5 text-xs">
                        <Kbd keys={["ctrl"]}>V</Kbd> {t("paste")}
                      </p>
                      <p className="text-muted mt-1 text-xs">{t("formats")}</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      type="file"
                      onChange={(e) => handleAddFiles(e.target.files)}
                    />
                  </button>

                  {/* File previews */}
                  {files.length > 0 && (
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {files.map(({ id, file, preview }) => (
                        <div key={id} className="group relative">
                          <Image
                            unoptimized
                            alt={file.name}
                            className="h-20 w-full rounded-lg object-cover"
                            height={80}
                            src={preview}
                            width={160}
                          />
                          <button
                            className="bg-danger absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white opacity-0 transition-opacity group-hover:opacity-100"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(id);
                            }}
                          >
                            <XMarkIcon className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {files.length > 1 && (
                    <p className="text-muted mt-2 text-center text-xs">
                      {t("selectedCount", {
                        count: files.length,
                      })}
                    </p>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button
                    className="bg-gradient-to-r from-rose-400 via-fuchsia-500 to-indigo-500 text-white hover:brightness-110"
                    isDisabled={files.length === 0}
                    onPress={handleImport}
                    isPending={isSubmitting}
                  >
                    {!isSubmitting && <SparklesIcon className="h-4 w-4" />}
                    {tActions("importWithAI")}
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
