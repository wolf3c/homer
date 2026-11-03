"use client";
import {useState,useEffect,useCallback,useRef,type PropsWithChildren} from "react";
import {createPortal} from "react-dom";
import {ImageIcon,ImageOffIcon,XIcon} from "lucide-react";
import {cn} from "../task-status/utils";
import "./image-file.css";

export type ImageRootProps = React.ComponentProps<"div">;
function ImageRoot({className,children,...props}:ImageRootProps) {
 return <div data-slot="image-root" className={cn("aui-image-root relative overflow-hidden rounded-lg border-border border max-w-96",className)} {...props}>{children}</div>;
}
type ImagePreviewProps = Omit<React.ComponentProps<"img">, "children"> & {
  containerClassName?: string | undefined;
  ratio?: "auto" | "1:1" | "4:3" | "16:9" | "9:16" | undefined;
  fit?: "cover" | "contain" | undefined;
};

function ImagePreview({
  className,
  containerClassName,
  ratio = "auto",
  fit = "contain",
  onLoad,
  onError,
  alt = "图片内容",
  src,
  ...props
}: ImagePreviewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [errorSrc, setErrorSrc] = useState<string | undefined>(undefined);

  const loaded = loadedSrc === src;
  const error = errorSrc === src;
  const fixedRatio = ratio !== "auto";
  const ratioClassName =
    ratio === "1:1"
      ? "aspect-square"
      : ratio === "4:3"
        ? "aspect-[4/3]"
        : ratio === "16:9"
          ? "aspect-video"
          : ratio === "9:16"
            ? "aspect-[9/16]"
            : undefined;

  useEffect(() => {
    const image = imgRef.current;
    if (typeof src !== "string" || !image?.complete) return;
    if (image.naturalWidth > 0) setLoadedSrc(src);
    else setErrorSrc(src);
  }, [src]);

  return (
    <div
      data-slot="image-preview"
      className={cn(
        "relative",
        fixedRatio ? ratioClassName : "min-h-32",
        containerClassName,
      )}
    >
      {!loaded && !error && (
        <div
          data-slot="image-preview-loading"
          className="bg-muted/50 absolute inset-0 flex items-center justify-center"
        >
          <ImageIcon className="text-muted-foreground size-8 animate-pulse" />
        </div>
      )}
      {error ? (
        <div
          data-slot="image-preview-error"
          className={cn(
            "bg-muted/50 flex min-h-32 items-center justify-center p-4",
            fixedRatio && "absolute inset-0",
          )}
        >
          <ImageOffIcon className="text-muted-foreground size-8" />
        </div>
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className={cn(
            fixedRatio
              ? cn("block h-full w-full", {
                  "object-cover": fit === "cover",
                  "object-contain": fit === "contain",
                })
              : "block h-auto w-full object-contain",
            !loaded && "invisible",
            className,
          )}
          onLoad={(e) => {
            if (typeof src === "string") setLoadedSrc(src);
            onLoad?.(e);
          }}
          onError={(e) => {
            if (typeof src === "string") setErrorSrc(src);
            onError?.(e);
          }}
          {...props}
        />
      )}
    </div>
  );
}

type ImageZoomProps = PropsWithChildren<{
  src: string;
  alt?: string;
}>;

function ImageZoom({ src, alt = "图片预览", children }: ImageZoomProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = overlayRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables?.[0];
      const last = focusables?.[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.click();
          } else if (e.key === " ") {
            e.preventDefault();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " ") e.currentTarget.click();
        }}
        role="button"
        tabIndex={0}
        className="aui-image-zoom-trigger cursor-zoom-in"
        aria-label="放大图片"
      >
        {children}
      </div>
      {isOpen &&
        createPortal(
          <div
            ref={overlayRef}
            data-slot="image-zoom-overlay"
            role="dialog"
            aria-modal="true"
            className="aui-image-zoom-overlay fade-in animate-in fixed inset-0 z-50 flex items-center justify-center bg-black/80 duration-200"
            onClick={handleClose}
            aria-label="放大的图片"
          >
            <img
              data-slot="image-zoom-content"
              src={src}
              alt={alt}
              className="aui-image-zoom-content fade-in zoom-in-95 animate-in max-h-[90%] max-w-[90%] cursor-zoom-out object-contain duration-200"
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
            />
            <button
              data-slot="image-zoom-close"
              ref={closeRef}
              type="button"
              aria-label="关闭图片预览"
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="text-muted-foreground hover:text-foreground bg-background/80 absolute end-4 top-4 cursor-pointer rounded-md p-2"
            >
              <XIcon className="size-5" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}


export {ImageRoot,ImagePreview,ImageZoom};
