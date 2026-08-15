import { useState } from "react";
import SneakerSvg from "./SneakerSvg.jsx";

/** Imagem do produto com fallback para o SVG se não houver/quebrar. */
export default function ProductMedia({ src, alt, color }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <SneakerSvg color={color} />;
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
