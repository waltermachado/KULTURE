/** Placeholder de tênis (usado quando o produto não tem imagem ou ela falha). */
export default function SneakerSvg({ color = "#F6B234" }) {
  return (
    <svg viewBox="0 0 260 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M8 62 C4 40 14 28 34 24 C58 20 70 6 86 6 C96 6 100 16 112 22 C150 40 218 46 244 52 C258 56 260 74 246 78 L20 78 C10 78 10 72 8 62 Z"
        fill="#161616"
        stroke={color}
        strokeWidth="5"
      />
      <path d="M8 66 L248 66" stroke={color} strokeWidth="5" />
      <path d="M96 26 C120 44 160 50 200 54" stroke={color} strokeWidth="4" fill="none" />
      <path d="M44 28 L60 46 M64 22 L80 42 M84 18 L98 38" stroke={color} strokeWidth="3" />
    </svg>
  );
}
