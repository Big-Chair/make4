import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Upload, Check, ZoomIn, ZoomOut, Move } from "lucide-react";
import { uploadTokenImage, getTokenImageUrl } from "./api";
import {
  DEFAULT_PALETTE,
  type TokenConfig,
  DEFAULT_TOKEN_RED,
  DEFAULT_TOKEN_YELLOW,
  getTokenVisuals,
  getStoredTokenConfig,
} from "./tokens";

// Re-exported for back-compat: the token seam now lives in ./tokens.
export {
  type TokenConfig,
  DEFAULT_TOKEN_RED,
  DEFAULT_TOKEN_YELLOW,
  getTokenVisuals,
  getStoredTokenConfig,
};

// Preset gradient options
const GRADIENT_PRESETS: {
  label: string;
  gradient: string;
  highlight: string;
  border: string;
  dark: string;
  glow: string;
}[] = [
  { label: "Ocean", gradient: "radial-gradient(circle at 35% 35%, #7DD3FC, #0284C7 60%, #075985)", highlight: "#7DD3FC", border: "#075985", dark: "#0369A1", glow: "#0284C7" },
  { label: "Emerald", gradient: "radial-gradient(circle at 35% 35%, #6EE7B7, #059669 60%, #047857)", highlight: "#6EE7B7", border: "#047857", dark: "#059669", glow: "#10B981" },
  { label: "Rose", gradient: "radial-gradient(circle at 35% 35%, #FDA4AF, #E11D48 60%, #BE123C)", highlight: "#FDA4AF", border: "#BE123C", dark: "#E11D48", glow: "#F43F5E" },
  { label: "Violet", gradient: "radial-gradient(circle at 35% 35%, #C4B5FD, #7C3AED 60%, #6D28D9)", highlight: "#C4B5FD", border: "#6D28D9", dark: "#7C3AED", glow: "#8B5CF6" },
  { label: "Orange", gradient: "radial-gradient(circle at 35% 35%, #FDBA74, #EA580C 60%, #C2410C)", highlight: "#FDBA74", border: "#C2410C", dark: "#EA580C", glow: "#F97316" },
  { label: "Cyan", gradient: "radial-gradient(circle at 35% 35%, #67E8F9, #0891B2 60%, #0E7490)", highlight: "#67E8F9", border: "#0E7490", dark: "#0891B2", glow: "#06B6D4" },
  { label: "Fuchsia", gradient: "radial-gradient(circle at 35% 35%, #F0ABFC, #C026D3 60%, #A21CAF)", highlight: "#F0ABFC", border: "#A21CAF", dark: "#C026D3", glow: "#D946EF" },
  { label: "Lime", gradient: "radial-gradient(circle at 35% 35%, #BEF264, #65A30D 60%, #4D7C0F)", highlight: "#BEF264", border: "#4D7C0F", dark: "#65A30D", glow: "#84CC16" },
  { label: "Sky", gradient: "radial-gradient(circle at 35% 35%, #BAE6FD, #0EA5E9 60%, #0284C7)", highlight: "#BAE6FD", border: "#0284C7", dark: "#0EA5E9", glow: "#38BDF8" },
  { label: "Slate", gradient: "radial-gradient(circle at 35% 35%, #94A3B8, #475569 60%, #334155)", highlight: "#94A3B8", border: "#334155", dark: "#475569", glow: "#64748B" },
];

// Emoji presets
const EMOJI_PRESETS = [
  "🔥", "⭐", "💎", "🌈", "🎯", "⚡", "💜", "🌊",
  "🍀", "🎱", "🦄", "🐉", "👑", "🎪", "🌸", "💀",
  "🎃", "🍭", "🧊", "🌙", "☀️", "🍩", "🎵", "🦋",
];

const CROP_SIZE = 200; // output image size

interface TokenCustomizerProps {
  isOpen: boolean;
  onClose: () => void;
  playerColor: "red" | "yellow";
  playerName: string;
  currentConfig: TokenConfig;
  onSave: (config: TokenConfig) => void;
}

// ─── Image Crop Component ───
export interface ImageCropperHandle {
  crop: () => void;
}

const ImageCropper = forwardRef<ImageCropperHandle, {
  file: File;
  onCropped: (blob: Blob) => void;
  onCancel: () => void;
}>(function ImageCropper({ file, onCropped, onCancel }, ref) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleImageLoad = () => {
    if (imgRef.current) {
      setImgNatural({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setDragging(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    setDragging(true);
    setDragStart({ x: t.clientX - pan.x, y: t.clientY - pan.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return;
    const t = e.touches[0];
    setPan({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y });
  };

  const handleCrop = useCallback(() => {
    if (!imageUrl || !imgNatural.w) return;
    const canvas = document.createElement("canvas");
    canvas.width = CROP_SIZE;
    canvas.height = CROP_SIZE;
    const ctx = canvas.getContext("2d")!;

    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    const img = imgRef.current!;
    const viewportSize = 180;
    const scale = zoom;

    const aspect = imgNatural.w / imgNatural.h;
    let baseW: number, baseH: number;
    if (aspect >= 1) {
      baseW = viewportSize;
      baseH = viewportSize / aspect;
    } else {
      baseH = viewportSize;
      baseW = viewportSize * aspect;
    }

    const dispW = baseW * scale;
    const dispH = baseH * scale;
    const imgX = (viewportSize - dispW) / 2 + pan.x;
    const imgY = (viewportSize - dispH) / 2 + pan.y;
    const canvasScale = CROP_SIZE / viewportSize;

    ctx.drawImage(
      img,
      0, 0, imgNatural.w, imgNatural.h,
      imgX * canvasScale,
      imgY * canvasScale,
      dispW * canvasScale,
      dispH * canvasScale
    );

    canvas.toBlob((blob) => {
      if (blob) onCropped(blob);
    }, "image/png");
  }, [imageUrl, imgNatural, zoom, pan, onCropped]);

  useImperativeHandle(ref, () => ({ crop: handleCrop }), [handleCrop]);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Viewport */}
      <div className="relative" style={{ width: 180, height: 180 }}>
        {/* Circular crop area */}
        <div
          ref={containerRef}
          className="w-full h-full rounded-full overflow-hidden relative cursor-grab active:cursor-grabbing"
          style={{
            border: `3px solid rgba(255,255,255,0.35)`,
            background: "rgba(0,0,0,0.4)",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => setDragging(false)}
        >
          {imageUrl && (
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop preview"
              onLoad={handleImageLoad}
              className="absolute pointer-events-none select-none"
              style={{
                left: "50%",
                top: "50%",
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
              }}
              draggable={false}
            />
          )}
        </div>
        {/* Drag hint */}
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs"
          style={{ background: "rgba(0,0,0,0.6)", color: "rgba(255,255,255,0.5)" }}
        >
          <Move size={9} />
          Drag to pan
        </div>
      </div>

      {/* Zoom slider */}
      <div className="flex items-center gap-3 w-full max-w-[220px]">
        <ZoomOut size={14} color="rgba(255,255,255,0.4)" />
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1 accent-current"
          style={{ accentColor: "white" }}
        />
        <ZoomIn size={14} color="rgba(255,255,255,0.4)" />
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)", minWidth: 32, textAlign: "right" }}>
          {zoom.toFixed(1)}×
        </span>
      </div>

      {/* Recommended size hint */}
      <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
        Recommended: 200×200px or larger square image.
        <br />
        Output is cropped to a {CROP_SIZE}×{CROP_SIZE} circle.
      </p>

      {/* Hint + cancel link */}
      <div className="flex items-center justify-between w-full">
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          Adjust crop, then hit Save Token
        </p>
        <button
          onClick={onCancel}
          className="cursor-pointer px-2 py-1 rounded-lg text-xs"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
});
ImageCropper.displayName = "ImageCropper";

// ─── Main Component ───

export function TokenCustomizer({
  isOpen,
  onClose,
  playerColor,
  playerName,
  currentConfig,
  onSave,
}: TokenCustomizerProps) {
  const initialTab = currentConfig.type === "image" ? "image" as const : "background" as const;
  const [activeTab, setActiveTab] = useState<"background" | "emoji" | "image">(initialTab);
  const [selectedConfig, setSelectedConfig] = useState<TokenConfig>(currentConfig);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropperRef = useRef<ImageCropperHandle>(null);
  const pendingSaveRef = useRef(false);

  // Reset state when modal opens with new config
  useEffect(() => {
    if (isOpen) {
      setSelectedConfig(currentConfig);
      setActiveTab(currentConfig.type === "image" ? "image" : "background");
      setCropFile(null);
      setUploadError(null);
      pendingSaveRef.current = false;
    }
  }, [isOpen, currentConfig]);

  const defaultColors = DEFAULT_PALETTE[playerColor];

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Please select an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Image must be under 2MB");
      return;
    }
    setUploadError(null);
    setCropFile(file);
  }, []);

  const handleCroppedUpload = useCallback(async (blob: Blob) => {
    setUploading(true);
    setUploadError(null);
    setCropFile(null);

    try {
      const file = new File([blob], "token.png", { type: "image/png" });
      const res = await uploadTokenImage(playerName, file);
      if (res.ok && res.data.signedUrl) {
        const updatedConfig = { ...selectedConfig, type: "image" as const, imageUrl: res.data.signedUrl, emoji: undefined };
        setSelectedConfig(updatedConfig);
        // If save was pending (user clicked Save while cropping), auto-complete
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          onSave(updatedConfig);
          onClose();
        }
      } else {
        pendingSaveRef.current = false;
        setUploadError("Upload failed — try again");
      }
    } catch (err) {
      console.error("Token upload error:", err);
      pendingSaveRef.current = false;
      setUploadError("Upload failed — try again");
    } finally {
      setUploading(false);
    }
  }, [playerName, selectedConfig, onSave, onClose]);

  const handleSave = () => {
    // If the user is in the middle of cropping an image, trigger crop+upload first
    if (cropFile && cropperRef.current) {
      pendingSaveRef.current = true;
      cropperRef.current.crop();
      // The crop → upload flow will call onSave + onClose automatically via pendingSaveRef
      return;
    }
    onSave(selectedConfig);
    onClose();
  };

  // Set background (default or gradient) while preserving emoji overlay
  const setBackground = (bg: Partial<TokenConfig>) => {
    setSelectedConfig((prev) => ({
      ...bg,
      emoji: prev.emoji, // preserve emoji overlay
      type: bg.type || "default",
    } as TokenConfig));
  };

  // Toggle emoji overlay while preserving background
  const toggleEmoji = (emoji: string) => {
    setSelectedConfig((prev) => ({
      ...prev,
      emoji: prev.emoji === emoji ? undefined : emoji,
    }));
  };

  // Get the background style for preview
  const getPreviewBg = (config: TokenConfig) => {
    if (config.type === "gradient" && config.gradient) return config.gradient;
    if (config.type === "image" && config.imageUrl) return "rgba(30,30,30,0.8)";
    // For type "emoji" (legacy) or "default", use player default
    return defaultColors.bg;
  };

  const getPreviewHighlight = (config: TokenConfig) => config.highlightColor || defaultColors.highlight;
  const getPreviewBorder = (config: TokenConfig) => config.borderColor || defaultColors.border;

  // Preview renderer
  const renderPreview = (config: TokenConfig, size = 64) => {
    return (
      <div
        className="rounded-full relative overflow-hidden flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: getPreviewBg(config),
          border: `3px solid ${getPreviewHighlight(config)}`,
          outline: `3px solid ${getPreviewBorder(config)}`,
          outlineOffset: "-1px",
          boxShadow: `0 4px 20px ${g.shadowMd}, inset 0 2px 5px rgba(255,255,255,0.4)`,
        }}
      >
        {config.type === "image" && config.imageUrl && (
          <img
            src={config.imageUrl}
            alt="token"
            className="absolute inset-0 w-full h-full object-cover rounded-full"
          />
        )}
        {config.emoji && (
          <span
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{
              fontSize: size * 0.45,
              lineHeight: 1,
              textShadow: config.type === "image" ? "0 1px 4px rgba(0,0,0,0.7)" : "none",
            }}
          >
            {config.emoji}
          </span>
        )}
      </div>
    );
  };

  const tabs = [
    { id: "background" as const, label: "Color" },
    { id: "emoji" as const, label: "Emoji" },
    { id: "image" as const, label: "Image" },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="rounded-2xl p-5 sm:p-6 w-[90vw] max-w-md relative"
            style={{
              background: "linear-gradient(180deg, #2C2C2C 0%, #1E1E1E 100%)",
              border: `2px solid ${defaultColors.accent}30`,
              boxShadow: `0 20px 60px ${g.shadowLg}, 0 0 40px ${defaultColors.accent}15`,
            }}
          >
            {/* Close */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <X size={14} color="rgba(255,255,255,0.5)" />
            </button>

            {/* Header with live preview */}
            <div className="flex items-center gap-4 mb-5">
              <motion.div
                key={`${selectedConfig.type}-${selectedConfig.gradient}-${selectedConfig.emoji}-${selectedConfig.imageUrl}`}
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 15 }}
              >
                {renderPreview(selectedConfig, 56)}
              </motion.div>
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Customize Token
                </h3>
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {playerName} ({playerColor === "red" ? "Red" : "Yellow"})
                </p>
                {/* Show combo hint */}
                {selectedConfig.emoji && selectedConfig.type !== "default" && selectedConfig.type !== "emoji" && (
                  <p className="text-xs mt-0.5" style={{ color: defaultColors.accent }}>
                    {selectedConfig.type === "gradient" ? "Color" : "Image"} + Emoji combo
                  </p>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 rounded-xl p-1" style={{ background: "rgba(255,255,255,0.04)" }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="flex-1 py-2 px-3 rounded-lg cursor-pointer transition-all hover:bg-white/10 text-sm"
                  style={{
                    background: activeTab === tab.id ? "rgba(255,255,255,0.12)" : undefined,
                    border: activeTab === tab.id ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent",
                    color: activeTab === tab.id ? "white" : "rgba(255,255,255,0.45)",
                    fontWeight: activeTab === tab.id ? 600 : 400,
                  }}
                >
                  {tab.label}
                  {tab.id === "emoji" && selectedConfig.emoji && (
                    <span className="ml-1">{selectedConfig.emoji}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div
              className="rounded-xl p-4 mb-4"
              style={{
                background: "rgba(0,0,0,0.2)",
                border: "1px solid rgba(255,255,255,0.06)",
                minHeight: "160px",
                maxHeight: "340px",
                overflowY: "auto",
              }}
            >
              {/* ─── Background Tab ─── */}
              {activeTab === "background" && (
                <div className="flex flex-col gap-4">
                  {/* Default option */}
                  <div>
                    <p className="label-caps-sm" style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "1.5px", marginBottom: 8 }}>
                      Default
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setBackground({ type: "default" })}
                      className="cursor-pointer flex items-center gap-3 px-3 py-2 rounded-xl w-full"
                      style={{
                        background: (selectedConfig.type === "default" || selectedConfig.type === "emoji") ? `${defaultColors.accent}12` : "rgba(255,255,255,0.02)",
                        border: (selectedConfig.type === "default" || selectedConfig.type === "emoji") ? `2px solid ${defaultColors.accent}50` : "2px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex-shrink-0"
                        style={{
                          background: defaultColors.bg,
                          border: `2px solid ${defaultColors.highlight}`,
                          boxShadow: `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 3px rgba(255,255,255,0.3)`,
                        }}
                      />
                      <span className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                        Classic {playerColor === "red" ? "Red" : "Yellow"}
                      </span>
                      {(selectedConfig.type === "default" || selectedConfig.type === "emoji") && (
                        <Check size={14} color="#0ACF83" className="ml-auto" />
                      )}
                    </motion.button>
                  </div>

                  {/* Gradient presets */}
                  <div>
                    <p className="label-caps-sm" style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "1.5px", marginBottom: 8 }}>
                      Gradients
                    </p>
                    <div className="grid grid-cols-5 gap-3">
                      {GRADIENT_PRESETS.map((preset) => {
                        const isSelected = selectedConfig.type === "gradient" && selectedConfig.gradient === preset.gradient;
                        return (
                          <motion.button
                            key={preset.label}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() =>
                              setBackground({
                                type: "gradient",
                                gradient: preset.gradient,
                                highlightColor: preset.highlight,
                                borderColor: preset.border,
                                darkColor: preset.dark,
                                glowColor: preset.glow,
                              })
                            }
                            className="flex flex-col items-center gap-1.5 cursor-pointer"
                          >
                            <div
                              className="w-10 h-10 rounded-full"
                              style={{
                                background: preset.gradient,
                                border: isSelected ? `2px solid white` : `2px solid ${preset.highlight}`,
                                outline: isSelected ? `2px solid ${preset.glow}` : "none",
                                outlineOffset: "1px",
                                boxShadow: isSelected ? `0 0 16px ${preset.glow}60` : `0 2px 8px ${g.shadowMd}, inset 0 1px 3px rgba(255,255,255,0.3)`,
                              }}
                            />
                            <span className="text-2xs" style={{ color: isSelected ? "white" : "rgba(255,255,255,0.35)" }}>
                              {preset.label}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Emoji Tab (overlay — combinable) ─── */}
              {activeTab === "emoji" && (
                <div className="flex flex-col gap-4">
                  {selectedConfig.type === "image" ? (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
                        Emoji overlay is not available with image tokens.
                      </p>
                      <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.25)" }}>
                        Remove the image first to add an emoji.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="label-caps-sm" style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "1.5px" }}>
                          Emoji Overlay
                        </p>
                        {selectedConfig.emoji && (
                          <button
                            onClick={() => setSelectedConfig((prev) => ({ ...prev, emoji: undefined }))}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer text-xs"
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "rgba(255,255,255,0.45)",
                            }}
                          >
                            <X size={10} /> Remove
                          </button>
                        )}
                      </div>

                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)", marginTop: -4 }}>
                        Add an emoji on top of your {selectedConfig.type === "gradient" ? "gradient" : "default color"}
                      </p>

                      <div className="grid grid-cols-8 gap-2">
                        {EMOJI_PRESETS.map((emoji) => {
                          const isSelected = selectedConfig.emoji === emoji;
                          return (
                            <motion.button
                              key={emoji}
                              whileHover={{ scale: 1.15 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => toggleEmoji(emoji)}
                              className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer"
                              style={{
                                background: isSelected ? `${defaultColors.accent}20` : "rgba(255,255,255,0.04)",
                                border: isSelected ? `2px solid ${defaultColors.accent}` : "2px solid rgba(255,255,255,0.06)",
                                fontSize: "var(--text-lg)",
                              }}
                            >
                              {emoji}
                            </motion.button>
                          );
                        })}
                      </div>

                      {/* Combo preview hint */}
                      {selectedConfig.emoji && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-3 mt-1 p-3 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                        >
                          {renderPreview(selectedConfig, 40)}
                          <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                            {selectedConfig.emoji} on {selectedConfig.type === "gradient" ? "gradient" : `${playerColor}`}
                          </p>
                        </motion.div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ─── Image Tab ─── */}
              {activeTab === "image" && (
                <div className="flex flex-col items-center gap-4 py-2">
                  {/* Show crop UI if a file is selected */}
                  {cropFile ? (
                    <ImageCropper
                      ref={cropperRef}
                      file={cropFile}
                      onCropped={handleCroppedUpload}
                      onCancel={() => setCropFile(null)}
                    />
                  ) : uploading ? (
                    <div className="flex flex-col items-center gap-3 py-8">
                      <div
                        className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin"
                        style={{ borderColor: `${defaultColors.accent} transparent ${defaultColors.accent} ${defaultColors.accent}` }}
                      />
                      <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Uploading...</span>
                    </div>
                  ) : selectedConfig.type === "image" && selectedConfig.imageUrl ? (
                    <div className="flex flex-col items-center gap-3">
                      {renderPreview(selectedConfig, 80)}
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Image uploaded</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 rounded-lg cursor-pointer transition-colors hover:bg-white/15 hover:text-white text-sm"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "rgba(255,255,255,0.6)",
                          }}
                        >
                          Change image
                        </button>
                        <button
                          onClick={() => setSelectedConfig((prev) => {
                            // Remove image, go back to default or gradient
                            const { imageUrl, ...rest } = prev;
                            return { ...rest, type: prev.gradient ? "gradient" : "default" } as TokenConfig;
                          })}
                          className="px-4 py-2 rounded-lg cursor-pointer transition-colors hover:bg-red-500/20 hover:text-red-400 text-sm"
                          style={{
                            background: "rgba(242,78,30,0.1)",
                            border: "1px solid rgba(242,78,30,0.25)",
                            color: "rgba(242,78,30,0.7)",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-8 rounded-xl cursor-pointer flex flex-col items-center gap-3"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "2px dashed rgba(255,255,255,0.12)",
                      }}
                    >
                      <Upload size={24} color="rgba(255,255,255,0.3)" />
                      <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                        Click to upload an image
                      </span>
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
                        PNG, JPG up to 2MB · Best at 200×200px or larger
                      </span>
                    </motion.button>
                  )}
                  {uploadError && (
                    <p className="text-xs text-figma-red">{uploadError}</p>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}
            </div>

            {/* Save button */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleSave}
              className="w-full py-3 rounded-xl cursor-pointer flex items-center justify-center gap-2 text-base font-semibold text-white border-none"
              style={{
                background: "linear-gradient(135deg, #0ACF83, #07A868)",
                boxShadow: "0 4px 20px rgba(10,207,131,0.35)",
              }}
            >
              <Check size={16} />
              Save Token
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

