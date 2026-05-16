"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRecipeAutocomplete } from "@/hooks/recipes";
import { Avatar, ListBox, Spinner, TextArea } from "@heroui/react";
import { useTranslations } from "next-intl";

interface SmartTextInputProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export default function SmartTextInput({
  value,
  onValueChange,
  placeholder,
  minRows = 1,
  onBlur,
  onKeyDown,
}: SmartTextInputProps) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [slashPosition, setSlashPosition] = useState(-1);
  const [openAbove, setOpenAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = useTranslations("recipes.empty");

  const { suggestions, isLoading } = useRecipeAutocomplete(autocompleteQuery, showAutocomplete);

  useEffect(() => {
    if (showAutocomplete && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropdownHeight = 256;

      setOpenAbove(spaceBelow < dropdownHeight && rect.top > dropdownHeight);
    }
  }, [showAutocomplete]);

  const handleChange = useCallback(
    (newValue: string) => {
      onValueChange(newValue);

      const cursorPos = textareaRef.current?.selectionStart ?? newValue.length;

      setCursorPosition(cursorPos);

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const lastSlashIndex = textBeforeCursor.lastIndexOf("/");

      if (lastSlashIndex !== -1) {
        const charBeforeSlash = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : " ";
        const isValidSlash =
          charBeforeSlash === " " || charBeforeSlash === "\n" || lastSlashIndex === 0;

        if (isValidSlash) {
          const query = textBeforeCursor.slice(lastSlashIndex + 1);

          if (query.length >= 1 && !query.includes("\n")) {
            setSlashPosition(lastSlashIndex);
            setAutocompleteQuery(query);
            setShowAutocomplete(true);

            return;
          }
        }
      }

      setShowAutocomplete(false);
      setAutocompleteQuery("");
    },
    [onValueChange]
  );

  const handleSelect = useCallback(
    (recipeId: string, recipeName: string) => {
      if (slashPosition === -1) return;

      const before = value.slice(0, slashPosition);
      const after = value.slice(cursorPosition);
      const newValue = `${before}[${recipeName}](id:${recipeId})${after}`;

      onValueChange(newValue);
      setShowAutocomplete(false);
      setAutocompleteQuery("");

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const newCursorPos = slashPosition + recipeName.length + recipeId.length + 7;

          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    },
    [value, slashPosition, cursorPosition, onValueChange]
  );

  const handleBlur = useCallback(() => {
    setTimeout(() => setShowAutocomplete(false), 200);
    onBlur?.();
  }, [onBlur]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowAutocomplete(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <TextArea
        ref={textareaRef}
        className="border-border dark:border-border-tertiary w-full text-base"
        placeholder={placeholder}
        rows={minRows}
        value={value}
        onBlur={handleBlur}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={onKeyDown}
      />

      {showAutocomplete && (
        <div
          className={`bg-surface absolute right-0 left-0 z-50 max-h-64 overflow-auto rounded-xl shadow-lg ${
            openAbove ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : suggestions.length > 0 ? (
            <ListBox
              aria-label="Recipe suggestions"
              items={suggestions}
              onAction={(key) => {
                const recipe = suggestions.find((r) => r.id === key);

                if (recipe) handleSelect(recipe.id, recipe.name);
              }}
            >
              {(recipe) => (
                <ListBox.Item key={recipe.id} id={recipe.id} textValue={recipe.name}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8 rounded-md">
                      {recipe.image ? (
                        <Avatar.Image alt="" className="object-cover" src={recipe.image} />
                      ) : null}
                      <Avatar.Fallback className="text-muted text-xs">R</Avatar.Fallback>
                    </Avatar>
                    <span className="truncate text-sm font-medium">{recipe.name}</span>
                  </div>
                </ListBox.Item>
              )}
            </ListBox>
          ) : autocompleteQuery.length >= 1 ? (
            <div className="text-muted px-4 py-3 text-sm">{t("noResults")}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
