"use client";

import { useState } from "react";

const toggle: React.CSSProperties = {
  position: "absolute",
  right: "0.5rem",
  top: "50%",
  transform: "translateY(-50%)",
  padding: "0.25rem 0.5rem",
  fontSize: "0.85rem",
  border: "none",
  borderRadius: "0.25rem",
  background: "transparent",
  color: "#2563eb",
  cursor: "pointer",
};

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  style?: React.CSSProperties;
};

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
  minLength,
  style,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...style, paddingRight: "3.5rem" }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        style={toggle}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
