import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export function Input({
  label,
  error,
  helperText,
  id,
  className = "",
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-slate-700"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[
          "h-9 w-full px-3 text-sm text-slate-900 bg-white placeholder-slate-500",
          "border rounded transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-0 focus:border-primary-500",
          "disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed",
          error
            ? "border-error-600 focus:border-error-600 focus:ring-error-400"
            : "border-slate-300 hover:border-slate-400",
          className,
        ].join(" ")}
        {...props}
      />
      {error && (
        <p className="text-xs text-error-600 mt-0.5">{error}</p>
      )}
      {helperText && !error && (
        <p className="text-xs text-slate-500 mt-0.5">{helperText}</p>
      )}
    </div>
  );
}
