import { cn } from "cn"

type Tone = "success" | "danger" | "warning" | "neutral" | "brand"

const toneStyles: Record<Tone, { dot: string; pill: string }> = {
  success: {
    dot: "bg-success",
    pill: "border-success/20 bg-success/10 text-success",
  },
  danger: {
    dot: "bg-danger",
    pill: "border-danger/20 bg-danger/10 text-danger",
  },
  warning: {
    dot: "bg-warning",
    pill: "border-warning/25 bg-warning/10 text-warning-foreground",
  },
  neutral: {
    dot: "bg-muted-foreground/60",
    pill: "border-border bg-muted text-muted-foreground",
  },
  brand: {
    dot: "bg-brand",
    pill: "border-brand/20 bg-brand/10 text-brand",
  },
}

function StatusPill({
  tone = "neutral",
  children,
  pulse = false,
  className,
}: {
  tone?: Tone
  children: React.ReactNode
  pulse?: boolean
  className?: string
}) {
  const styles = toneStyles[tone]

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles.pill,
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          styles.dot,
          pulse && "animate-pulse"
        )}
      />
      {children}
    </span>
  )
}

export { StatusPill, type Tone }
