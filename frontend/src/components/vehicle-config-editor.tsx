"use client";

import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import { cn } from "@/lib/utils";

const MonacoEditor = dynamic(async () => (await import("@monaco-editor/react")).default, {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground border-input bg-muted/20 flex h-full min-h-0 items-center justify-center rounded-md border text-sm">
      Loading editor...
    </div>
  ),
});

const editorOptions: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
  fontSize: 13,
  insertSpaces: true,
  lineNumbers: "on",
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
  wordWrap: "on",
};

function detectLanguage(path: string): string {
  const normalized = path.trim().toLowerCase();
  if (normalized.endsWith(".yaml") || normalized.endsWith(".yml")) return "yaml";
  if (normalized.endsWith(".json")) return "json";
  return "plaintext";
}

function fallbackModelPath(path: string, language: string): string {
  if (path.trim().length > 0) return path;
  if (language === "json") return "untitled.json";
  if (language === "yaml") return "untitled.yaml";
  return "untitled.txt";
}

type VehicleConfigEditorProps = {
  value: string;
  onChange: (value: string) => void;
  path: string;
  readOnly?: boolean;
  markers?: editor.IMarkerData[];
  height?: string;
  className?: string;
};

export function VehicleConfigEditor({
  value,
  onChange,
  path,
  readOnly = false,
  height = "100%",
  className,
}: VehicleConfigEditorProps) {
  const language = detectLanguage(path);

  return (
    <div className={cn("border-input h-full min-h-0 overflow-hidden rounded-md border", className)}>
      <MonacoEditor
        height={height}
        language={language}
        path={fallbackModelPath(path, language)}
        theme="vs-dark"
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        options={{ ...editorOptions, readOnly }}
      />
    </div>
  );
}
