export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="splat" style={{ width: 180, height: 180, background: "rgba(246,178,52,.16)", top: "8%", left: "4%" }} />
      <div className="splat" style={{ width: 90, height: 90, background: "rgba(246,178,52,.22)", bottom: "12%", right: "38%" }} />
      <div className="hero-inner">
        <div>
          <span className="hero-tag">// direto das quadras dos EUA</span>
          <h1>
            Sneakers com
            <br />
            <span>atitude</span> de rua
          </h1>
          <p>
            Os drops mais quentes de basquete, importados dos EUA e entregues na sua porta. Cadastre-se, monte seu
            carrinho e acompanhe o rastreio em tempo real.
          </p>
          <a className="btn-cta" href="#drops">
            Ver os drops &#8595;
          </a>
        </div>
        <div className="hero-art">
          {/* PLACEHOLDER: arte de grafite (muro + cesta + tênis) — será substituída pela arte final */}
          <svg viewBox="0 0 400 340" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="10" y="10" width="380" height="320" rx="6" fill="#232323" stroke="#000" strokeWidth="4" />
            <g opacity=".25" stroke="#000" strokeWidth="2">
              <line x1="10" y1="70" x2="390" y2="70" />
              <line x1="10" y1="130" x2="390" y2="130" />
              <line x1="10" y1="190" x2="390" y2="190" />
              <line x1="10" y1="250" x2="390" y2="250" />
              <line x1="110" y1="10" x2="110" y2="70" />
              <line x1="230" y1="10" x2="230" y2="70" />
              <line x1="60" y1="70" x2="60" y2="130" />
              <line x1="180" y1="70" x2="180" y2="130" />
              <line x1="300" y1="70" x2="300" y2="130" />
              <line x1="110" y1="130" x2="110" y2="190" />
              <line x1="230" y1="130" x2="230" y2="190" />
              <line x1="340" y1="130" x2="340" y2="190" />
              <line x1="60" y1="190" x2="60" y2="250" />
              <line x1="180" y1="190" x2="180" y2="250" />
              <line x1="300" y1="190" x2="300" y2="250" />
              <line x1="110" y1="250" x2="110" y2="330" />
              <line x1="230" y1="250" x2="230" y2="330" />
            </g>
            <ellipse cx="205" cy="165" rx="150" ry="115" fill="#F6B234" opacity=".18" />
            <ellipse cx="205" cy="165" rx="105" ry="82" fill="#F6B234" opacity=".25" />
            <rect x="255" y="48" width="90" height="64" rx="4" fill="none" stroke="#F6B234" strokeWidth="6" />
            <rect x="278" y="66" width="44" height="32" fill="none" stroke="#F6B234" strokeWidth="4" />
            <line x1="262" y1="112" x2="338" y2="112" stroke="#FFD167" strokeWidth="7" strokeLinecap="round" />
            <path
              d="M268 116 L275 152 M283 116 L288 152 M300 116 L300 152 M317 116 L312 152 M332 116 L325 152 M270 130 H330 M272 142 H328"
              stroke="#FFD167"
              strokeWidth="3"
              opacity=".8"
            />
            <circle cx="120" cy="105" r="34" fill="#F6B234" stroke="#000" strokeWidth="5" />
            <path
              d="M86 105 H154 M120 71 V139 M96 81c14 12 34 12 48 0 M96 129c14-12 34-12 48 0"
              stroke="#000"
              strokeWidth="4"
              fill="none"
            />
            <g transform="translate(70,190) rotate(-8)">
              <path
                d="M8 62 C4 40 14 28 34 24 C58 20 70 6 86 6 C96 6 100 16 112 22 C150 40 218 46 244 52 C258 56 260 74 246 78 L20 78 C10 78 10 72 8 62 Z"
                fill="#111"
                stroke="#F6B234"
                strokeWidth="5"
              />
              <path d="M8 66 L248 66" stroke="#F6B234" strokeWidth="5" />
              <path d="M96 26 C120 44 160 50 200 54" stroke="#F6B234" strokeWidth="4" fill="none" />
              <path d="M44 28 L60 46 M64 22 L80 42 M84 18 L98 38" stroke="#F6B234" strokeWidth="3" />
            </g>
            <text x="38" y="300" fontFamily="'Permanent Marker',cursive" fontSize="26" fill="#FFD167" transform="rotate(-4 38 300)">
              STREET BALL
            </text>
            <text x="250" y="308" fontFamily="'Permanent Marker',cursive" fontSize="16" fill="#888" transform="rotate(3 250 308)">
              KLTR &#39;26
            </text>
          </svg>
          <span className="placeholder-note">* placeholder — arte de grafite final entra aqui</span>
        </div>
      </div>
    </section>
  );
}
