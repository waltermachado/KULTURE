import { useState } from "react";
import SneakerSvg from "./SneakerSvg.jsx";

/** Imagem do produto com fallback para o SVG se não houver/quebrar. */
export default function ProductMedia({ src, alt, color, priority = false }) {
  const [failedSrc, setFailedSrc] = useState(null);
  if (!src || failedSrc === src) return <SneakerSvg color={color} />;
  return <img src={src} alt={alt || "Tênis original Kulture BR"} width="600" height="600" decoding="async" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} onLoad={(e) => { e.currentTarget.dataset.portrait = String(e.currentTarget.naturalHeight > e.currentTarget.naturalWidth * 1.15); }} onError={() => setFailedSrc(src)} />;
}
