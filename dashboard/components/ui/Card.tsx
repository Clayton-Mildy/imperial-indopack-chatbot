import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
  title?: string;
}

export function Card({ children, className = "", compact = false, title }: CardProps) {
  return (
    <div
      className={[
        "bg-white border border-slate-200 rounded-md shadow-sm",
        compact ? "p-4" : "p-6",
        className,
      ].join(" ")}
    >
      {title && (
        <div className="mb-4 pb-4 border-b border-slate-100">
          <h3 className="text-lg font-medium text-slate-900">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}
