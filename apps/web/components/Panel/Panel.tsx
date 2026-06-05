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

export interface PanelProps {
  className?: string;
  panelClassName?: string;
  title?: string;
  children: ReactNode;
  trigger?: ReactElement;
  open?: boolean;
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

function getClassName(element: ReactElement<PanelSectionProps>) {
  return element.props.className ?? "";
}

export function PanelBody({ children }: PanelSectionProps) {
  return <>{children}</>;
}

export function PanelFooter({ children }: PanelSectionProps) {
  return <>{children}</>;
}

type PanelComponent = React.FC<PanelProps> & {
  Body: typeof PanelBody;
  Footer: typeof PanelFooter;
};

const PanelRoot: React.FC<PanelProps> = ({
  className = "",
  panelClassName = "",
  title = "",
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
  const { bodyChildren, bodyClassName, footerChildren, footerClassName } = useMemo(() => {
    const body: ReactNode[] = [];
    const bodyClasses: string[] = [];
    const footer: ReactNode[] = [];
    const footerClasses: string[] = [];

    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.type === PanelFooter) {
        const element = child as ReactElement<PanelSectionProps>;

        footer.push(element.props.children);
        footerClasses.push(getClassName(element));
      } else if (React.isValidElement(child) && child.type === PanelBody) {
        const element = child as ReactElement<PanelSectionProps>;

        body.push(element.props.children);
        bodyClasses.push(getClassName(element));
      } else {
        body.push(child);
      }
    });

    return {
      bodyChildren: body,
      bodyClassName: bodyClasses.filter(Boolean).join(" "),
      footerChildren: footer,
      footerClassName: footerClasses.filter(Boolean).join(" "),
    };
  }, [children]);
  const hasFooter = footerChildren.length > 0;

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
        <Root  isOpen={open} placement="bottom" onOpenChange={setOpen}>
          <Sheet.Backdrop className="z-[1000]" variant="opaque">
            <Sheet.Content className="mx-auto max-w-md">
              <Sheet.Dialog aria-label={title || "Panel"} className={panelClassName}>
                <Sheet.Handle className="relative z-10" />
                <Sheet.CloseTrigger aria-label="Close panel" className="z-30" />

                <Sheet.Header>
                  <Sheet.Heading>{title}</Sheet.Heading>
                </Sheet.Header>

                <Sheet.Body className={bodyClassName}>{bodyChildren}</Sheet.Body>
                {hasFooter && (
                  <Sheet.Footer className={footerClassName}>{footerChildren}</Sheet.Footer>
                )}
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
