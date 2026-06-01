"use client";

import React, {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Sheet } from "@heroui-pro/react";

export const PANEL_HEIGHT_COMPACT = 48;
export const PANEL_HEIGHT_MEDIUM = 68;
export const PANEL_HEIGHT_LARGE = 88; // Default height when none is specified

export interface PanelProps {
  className?: string;
  panelClassName?: string;
  title?: string;
  children: ReactNode;
  trigger?: ReactElement;
  open?: boolean;
  height?: number;
  nested?: boolean;
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

type PanelSectionProps = {
  children: ReactNode;
  className?: string;
};

type PanelTriggerProps = {
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog";
  onClick?: (event: unknown) => void;
};

export function PanelBody({ children, className = "" }: PanelSectionProps) {
  return <div className={`flex min-h-0 flex-1 flex-col gap-4 ${className}`}>{children}</div>;
}

export function PanelFooter({ children, className = "" }: PanelSectionProps) {
  return (
    <div
      className={`border-border bg-background sticky bottom-0 z-10 shrink-0 border-t px-4 py-3 ${className}`}
    >
      {children}
    </div>
  );
}

type PanelComponent = React.FC<PanelProps> & {
  Body: typeof PanelBody;
  Footer: typeof PanelFooter;
};

const PanelRoot: React.FC<PanelProps> = ({
  className = "",
  panelClassName = "",
  title = "",
  height = PANEL_HEIGHT_LARGE,
  nested = false,
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
  const { bodyChildren, footerChildren } = useMemo(() => {
    const body: ReactNode[] = [];
    const footer: ReactNode[] = [];

    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.type === PanelFooter) {
        footer.push(child);
      } else if (React.isValidElement(child) && child.type === PanelBody) {
        body.push(child);
      } else {
        body.push(child);
      }
    });

    return { bodyChildren: body, footerChildren: footer };
  }, [children]);

  const panelTrigger = trigger as ReactElement<PanelTriggerProps> | undefined;
  const triggerElement =
    panelTrigger &&
    React.cloneElement(panelTrigger, {
      "aria-haspopup": "dialog",
      "aria-expanded": open,
      onClick: (event: unknown) => {
        const original = panelTrigger.props.onClick;

        if (typeof original === "function") original(event);
        toggle();
      },
    });
  const Root = nested ? Sheet.NestedRoot : Sheet.Root;

  return (
    <div data-panel className={className}>
      {trigger && <span className="inline-flex">{triggerElement}</span>}

      <PanelContext.Provider value={{ open, close, toggle }}>
        <Root isHandleOnly isOpen={open} placement="bottom" onOpenChange={setOpen}>
          <Sheet.Backdrop className="z-[1000]" variant="opaque">
            <Sheet.Content
              className="mx-auto h-[var(--panel-height)] max-h-dvh w-full md:max-w-md"
              style={{ "--panel-height": `${height}dvh` } as React.CSSProperties}
            >
              <Sheet.Dialog
                aria-label={title || "Panel"}
                className={`bg-background h-full overflow-hidden rounded-t-2xl ${panelClassName}`}
              >
                <Sheet.Handle />
                <Sheet.CloseTrigger aria-label="Close panel" />

                <Sheet.Header className="border-border relative flex shrink-0 items-center justify-center border-b px-12 py-4 select-none">
                  <Sheet.Heading className="text-center text-lg font-semibold">
                    {title}
                  </Sheet.Heading>
                </Sheet.Header>

                <Sheet.Body className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                  {bodyChildren}
                </Sheet.Body>
                {footerChildren}
              </Sheet.Dialog>
            </Sheet.Content>
          </Sheet.Backdrop>
        </Root>
      </PanelContext.Provider>
    </div>
  );
};

export const Panel = Object.assign(PanelRoot, {
  Body: PanelBody,
  Footer: PanelFooter,
}) satisfies PanelComponent;

export default Panel;
