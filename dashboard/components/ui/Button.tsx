import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: React.ReactNode;
  className?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-700 text-white border-transparent hover:bg-primary-600 active:bg-primary-800 disabled:opacity-40",
  secondary:
    "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40",
  ghost:
    "bg-transparent text-primary-700 border-transparent hover:bg-primary-50 active:bg-primary-100 disabled:opacity-40",
  danger:
    "bg-error-600 text-white border-transparent hover:bg-error-700 active:bg-error-700 disabled:opacity-40",
  icon: "bg-transparent text-slate-600 border-transparent hover:bg-slate-100 disabled:opacity-40",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-sm font-medium",
  md: "h-9 px-3.5 text-sm font-semibold",
  lg: "h-11 px-4.5 text-base font-semibold",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded border transition-colors cursor-pointer",
        "focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2",
        "disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(" ")}
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
}
