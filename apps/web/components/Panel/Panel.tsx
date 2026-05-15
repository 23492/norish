"use client";

import React, {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { Drawer } from "@heroui/react";

export const PANEL_HEIGHT_COMPACT = 40;
export const PANEL_HEIGHT_MEDIUM = 60;
export const PANEL_HEIGHT_LARGE = 85; // Default height when none is specified

export interface PanelProps {
  className?: string;
  panelClassName?: string;
  title?: string;
  children: ReactNode;
  trigger?: ReactElement;
  open?: boolean;
  height?: number;
  onOpenChange?: (open: boolean) => void;
}

const PanelContext = createContext<{
  open: boolean;
  close: () => void;
  toggle: () => void;
}>({ open: false, close: () => {}, toggle: () => {} });

export function usePanel() {
  return useContext(PanelContext);
}

export const Panel: React.FC<PanelProps> = ({
  className = "",
  panelClassName = "",
  title = "",
  height = PANEL_HEIGHT_LARGE,
  children,
  trigger,
  open: controlledOpen,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (v: boolean) => {
      if (!isControlled) setInternalOpen(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange]
  );

  const close = useCallback(() => setOpen(false), [setOpen]);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  const triggerElement =
    trigger &&
    React.cloneElement(trigger as ReactElement<any>, {
      "aria-haspopup": "dialog",
      "aria-expanded": open,
      onClick: (e: any) => {
        const original = (trigger as any).props?.onClick;

        if (typeof original === "function") original(e);
        toggle();
      },
    });

  return (
    <div data-panel className={className}>
      {trigger && <span className="inline-flex">{triggerElement}</span>}

      <PanelContext.Provider value={{ open, close, toggle }}>
        <Drawer.Backdrop className="z-[1000]" isOpen={open} variant="opaque" onOpenChange={setOpen}>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog
              aria-label={title || "Panel"}
              className={`bg-background mx-auto h-[var(--panel-height)] max-h-dvh w-full overflow-hidden rounded-t-2xl md:max-w-md ${panelClassName}`}
              style={{ "--panel-height": `${height}dvh` } as React.CSSProperties}
            >
              <Drawer.Handle />
              <Drawer.CloseTrigger aria-label="Close panel" />

              <Drawer.Header className="border-border relative flex shrink-0 items-center justify-center border-b px-12 py-4 select-none">
                <Drawer.Heading className="text-center text-lg font-semibold">
                  {title}
                </Drawer.Heading>
              </Drawer.Header>

              <Drawer.Body className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {children}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </PanelContext.Provider>
    </div>
  );
};

export default Panel;
