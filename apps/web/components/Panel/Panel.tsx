"use client";

import React, {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Sheet } from "@heroui-pro/react";

export const PANEL_HEIGHT_COMPACT = 48;
export const PANEL_HEIGHT_FORM = 56;
export const PANEL_HEIGHT_MEDIUM = 68;
export const PANEL_HEIGHT_LARGE = 88; // Default height when none is specified

type PanelSnapPoint = number | string;
type PanelBackdropStyle = React.CSSProperties & {
  "--sheet-backdrop-opacity"?: string;
};

function getSnapPointHeight(snapPoint: PanelSnapPoint | null, fallbackHeight: number) {
  if (typeof snapPoint === "number") {
    return `${Math.min(Math.max(snapPoint, 0.25), 1) * 100}dvh`;
  }

  return snapPoint ?? `${fallbackHeight}dvh`;
}

export interface PanelProps {
  className?: string;
  panelClassName?: string;
  title?: string;
  children: ReactNode;
  trigger?: ReactElement;
  open?: boolean;
  height?: number;
  nested?: boolean;
  snapPoints?: PanelSnapPoint[];
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
  snapPoints,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const defaultSnapPoints = useMemo<PanelSnapPoint[]>(() => {
    const initialSnapPoint = Math.min(Math.max(height / 100, 0.25), 1);

    return initialSnapPoint < 1 ? [initialSnapPoint, 1] : [1];
  }, [height]);
  const effectiveSnapPoints = snapPoints ?? defaultSnapPoints;
  const hasSnapPoints = effectiveSnapPoints.length > 1;
  const initialSnapPoint = effectiveSnapPoints[0] ?? null;
  const [activeSnapPoint, setActiveSnapPoint] = useState<PanelSnapPoint | null>(initialSnapPoint);
  const activeSnapPointIndex = hasSnapPoints
    ? effectiveSnapPoints.findIndex((snapPoint) => snapPoint === activeSnapPoint)
    : -1;
  const activeSnapPointHeight = getSnapPointHeight(activeSnapPoint, height);
  const backdropStyle = hasSnapPoints
    ? ({
        "--sheet-backdrop-opacity": open ? "1" : "0",
      } satisfies PanelBackdropStyle)
    : undefined;

  useEffect(() => {
    if (!open) {
      setActiveSnapPoint(initialSnapPoint);
    }
  }, [initialSnapPoint, open]);

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
        <Root
          isHandleOnly
          activeSnapPoint={hasSnapPoints ? activeSnapPoint : undefined}
          fadeFromIndex={hasSnapPoints ? Math.max(activeSnapPointIndex, 0) : undefined}
          isOpen={open}
          placement="bottom"
          snapPoints={hasSnapPoints ? effectiveSnapPoints : undefined}
          onActiveSnapPointChange={hasSnapPoints ? setActiveSnapPoint : undefined}
          onOpenChange={setOpen}
        >
          <Sheet.Backdrop className="z-[1000]" style={backdropStyle} variant="opaque">
            <Sheet.Content
              className={`mx-auto w-full md:max-w-md ${
                hasSnapPoints ? "h-dvh max-h-dvh" : "h-[var(--panel-height)] max-h-dvh"
              }`}
              style={{ "--panel-height": `${height}dvh` } as React.CSSProperties}
            >
              <Sheet.Dialog
                aria-label={title || "Panel"}
                className={`bg-background overflow-hidden rounded-t-2xl ${
                  hasSnapPoints ? "" : "h-full"
                } ${panelClassName}`}
                style={
                  hasSnapPoints
                    ? {
                        height: activeSnapPointHeight,
                        maxHeight: "100dvh",
                      }
                    : undefined
                }
              >
                <Sheet.Handle className="relative z-10" />
                <Sheet.CloseTrigger aria-label="Close panel" className="z-30" />

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
