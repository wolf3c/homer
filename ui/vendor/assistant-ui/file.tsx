"use client";
import type {FC} from "react";
import {FileIcon,FileTextIcon,ImageIcon,MusicIcon,VideoIcon,BracesIcon,DownloadIcon} from "lucide-react";
import {cn} from "../task-status/utils";
import "./image-file.css";

function getMimeTypeIcon(mimeType: string): FC<{ className?: string }> {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) {
    return ImageIcon;
  }
  if (type === "application/pdf") {
    return FileTextIcon;
  }
  if (type === "application/json") {
    return BracesIcon;
  }
  if (type.startsWith("text/")) {
    return FileTextIcon;
  }
  if (type.startsWith("audio/")) {
    return MusicIcon;
  }
  if (type.startsWith("video/")) {
    return VideoIcon;
  }
  return FileIcon;
}

export type FileDataKind = "data-uri" | "url" | "base64" | "id";

function getFileDataKind(
  data: string,
  sourceType?: "url" | "id",
): FileDataKind {
  if (sourceType === "url" && /^data:/i.test(data)) return "data-uri";
  if (sourceType) return sourceType;
  if (/^data:/i.test(data)) return "data-uri";
  if (/^(https?:\/\/|blob:)/i.test(data)) return "url";
  return "base64";
}

function isUnsafeScheme(data: string): boolean {
  return (
    /^[a-z][a-z\d+.-]*:/i.test(data) &&
    !/^(data:|https?:\/\/|blob:)/i.test(data)
  );
}

function getFileHref(
  data: string,
  mimeType: string,
  sourceType?: "url" | "id",
): string | null {
  if (isUnsafeScheme(data)) return null;
  const kind = getFileDataKind(data, sourceType);
  if (kind === "id") return null;
  if (kind === "data-uri") return /^data:[^,]*,/i.test(data) ? data : null;
  if (kind === "url") return /^(https?:\/\/|blob:)/i.test(data) ? data : null;
  return `data:${mimeType};base64,${data}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileRootProps = React.ComponentProps<"div">;
function FileRoot({className,children,...props}:FileRootProps) {
 return <div data-slot="file-root" className={cn("aui-file-root inline-flex items-center gap-3 rounded-lg transition-colors border-border hover:bg-muted/50 border px-3 py-2 text-sm",className)} {...props}>{children}</div>;
}
type FileIconDisplayProps = React.ComponentProps<"span"> & {
  mimeType?: string;
};

function FileIconDisplay({
  mimeType,
  className,
  children,
  ...props
}: FileIconDisplayProps) {
  const IconComponent = mimeType ? getMimeTypeIcon(mimeType) : FileIcon;

  return (
    <span
      data-slot="file-icon"
      className={cn("text-muted-foreground shrink-0", className)}
      {...props}
    >
      {/* eslint-disable-next-line react-hooks/static-components -- The helper only selects module-level icon components. */}
      {children ?? <IconComponent className="size-5" />}
    </span>
  );
}

function FileName({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-name"
      className={cn("min-w-0 flex-1 truncate font-medium", className)}
      {...props}
    >
      {children || "未命名文件"}
    </span>
  );
}

type FileSizeProps = React.ComponentProps<"span"> & {
  bytes: number;
};

function FileSize({ bytes, className, ...props }: FileSizeProps) {
  return (
    <span
      data-slot="file-size"
      className={cn("text-muted-foreground shrink-0", className)}
      {...props}
    >
      {formatFileSize(bytes)}
    </span>
  );
}

type FileDownloadProps = Omit<React.ComponentProps<"a">, "href"> & {
  data: string;
  mimeType: string;
  filename?: string;
  sourceType?: "url" | "id";
};

function FileDownload({
  data,
  mimeType,
  filename,
  sourceType,
  className,
  children,
  ...props
}: FileDownloadProps) {
  if (typeof data !== "string") return null;
  const kind = getFileDataKind(data, sourceType);
  const href = getFileHref(data, mimeType, sourceType);
  if (!href) return null;

  return (
    <a
      data-slot="file-download"
      href={href}
      download={filename || "download"}
      {...(kind === "url" && { target: "_blank", rel: "noopener noreferrer" })}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded-md p-1 transition-colors",
        className,
      )}
      aria-label={!children ? `下载 ${filename || "文件"}` : undefined}
      {...props}
    >
      {children || <DownloadIcon className="size-4" />}
    </a>
  );
}


export {FileRoot,FileIconDisplay,FileName,FileSize,FileDownload};
