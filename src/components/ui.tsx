"use client"

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, useEffect } from "react"
import { createPortal } from "react-dom"

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ")
}

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger"
type ButtonSize = "sm" | "md"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-active disabled:opacity-50",
  secondary: "bg-canvas-soft text-ink hover:bg-[#dde1d7] disabled:opacity-50",
  tertiary: "bg-canvas text-ink border border-ink hover:bg-canvas-soft disabled:opacity-50",
  ghost: "bg-transparent text-ink hover:bg-canvas-soft disabled:opacity-50",
  danger: "bg-negative text-white hover:bg-negative-deep disabled:opacity-50",
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-6 py-3 text-base",
        size === "sm" ? "text-sm leading-5" : "text-base leading-6",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
})

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-ink bg-canvas px-4 py-3 text-base text-ink placeholder:text-mute focus:outline-2 focus:outline-ink focus:outline-offset-1",
        className
      )}
      {...props}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-ink bg-canvas px-4 py-3 text-base text-ink placeholder:text-mute focus:outline-2 focus:outline-ink focus:outline-offset-1 resize-none",
        className
      )}
      {...props}
    />
  )
})

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl bg-canvas p-6 text-base text-ink", className)} {...rest}>
      {children}
    </div>
  )
}

export function Badge({
  tone = "positive",
  children,
  className,
}: {
  tone?: "positive" | "negative" | "warning" | "neutral"
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-3 py-0.5 text-sm font-semibold",
        tone === "positive" && "bg-primary-pale text-positive-deep",
        tone === "negative" && "bg-negative-bg text-white",
        tone === "warning" && "bg-warning text-warning-content",
        tone === "neutral" && "bg-canvas-soft text-body",
        className
      )}
    >
      {children}
    </span>
  )
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <div
      className={cn("flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-ink", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `hsl(${hue}, 45%, 85%)`,
      }}
    >
      {initials || "?"}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])
  if (!open || typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6" onClick={onClose}>
      <div
        className={cn(
          "max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-canvas p-6 md:rounded-2xl",
          wide ? "md:max-w-2xl" : "md:max-w-md"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            <button onClick={onClose} className="rounded-full p-2 hover:bg-canvas-soft" aria-label="Close">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  )
}

export function Toast({ message, tone = "neutral" }: { message: string; tone?: "neutral" | "negative" | "positive" }) {
  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-3 text-sm shadow-lg",
        tone === "negative" ? "bg-negative text-white" : tone === "positive" ? "bg-ink text-primary" : "bg-ink text-canvas"
      )}
    >
      {message}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink/20 border-t-ink", className)}
    />
  )
}

export function EmptyState({ icon, title, text }: { icon?: ReactNode; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-canvas-soft px-6 py-12 text-center">
      {icon}
      <h3 className="text-lg font-semibold">{title}</h3>
      {text && <p className="max-w-sm text-sm text-body">{text}</p>}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-pill transition-colors", checked ? "bg-positive" : "bg-canvas-soft border border-mute")}
      aria-label={label}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-canvas shadow transition-all",
          checked ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  )
}
