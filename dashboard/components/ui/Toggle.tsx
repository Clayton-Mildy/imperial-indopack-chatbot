"use client";

import React from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          "relative inline-flex items-center rounded-full transition-colors duration-150",
          "focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "w-10 h-[22px]",
          checked ? "bg-success-600" : "bg-slate-300",
        ].join(" ")}
      >
        <span
          className={[
            "absolute inline-block w-[18px] h-[18px] bg-white rounded-full shadow transition-transform duration-150",
            checked ? "translate-x-[20px]" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
      {label && (
        <span
          className={`text-sm font-medium ${
            disabled ? "text-slate-400" : "text-slate-700"
          }`}
        >
          {label}
        </span>
      )}
    </label>
  );
}
