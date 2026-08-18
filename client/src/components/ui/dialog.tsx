"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[10000] bg-black/80 pointer-events-none data-[state=open]:pointer-events-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideClose?: boolean;
  overlayClassName?: string;
  /**
   * Radix Overlay is omitted when Dialog `modal={false}`. Set this to keep the
   * dimmer without the modal focus/pointer trap (needed for nested popovers).
   */
  forceOverlay?: boolean;
}

function restorePointerEvents() {
  document.body.style.removeProperty("pointer-events");
  // react-remove-scroll also stamps pointer-events:none on siblings of the
  // portal root. Clean those up too so nothing in the page stays blocked.
  document.querySelectorAll<HTMLElement>("[data-radix-scroll-lock-wrapper], [data-remove-scroll-bar]").forEach((el) => {
    el.style.removeProperty("pointer-events");
  });
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideClose, onCloseAutoFocus, overlayClassName, forceOverlay, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    {forceOverlay ? (
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 z-[10000] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200",
          overlayClassName
        )}
      />
    ) : null}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // left-4/right-4 + mx-auto: center without left:50% + translateX(-50%).
        // That pattern paints the box from 50vw to 50vw+width *before* transform,
        // so overflow on body (Radix scroll-lock) clips the right edge.
        // min-w-0 + [&>*]:min-w-0: grid items default to min-width:auto, so long
        // URLs expand past max-width. Shrink/wrap them instead of overflow-x-hidden,
        // which clips close, switches, and footer buttons.
        // max-h + overflow-y-auto: grow with content until the viewport, then scroll.
        "fixed left-4 right-4 top-[50%] z-[10000] mx-auto grid max-w-lg min-w-0 max-h-[90vh] translate-y-[-50%] gap-4 overflow-y-auto break-words [&>*]:min-w-0 border bg-background p-6 shadow-lg duration-200 pointer-events-none data-[state=open]:pointer-events-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      onCloseAutoFocus={(e) => {
        restorePointerEvents();
        onCloseAutoFocus?.(e);
      }}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex min-w-0 flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex min-w-0 flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
