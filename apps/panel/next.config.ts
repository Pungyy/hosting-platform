import type { NextConfig } from "next";

/*
 * En-têtes de sécurité appliqués globalement (M7). Le Panel n'utilise
 * aucune iframe, aucun WebSocket/EventSource, aucun script/style/police
 * tiers au runtime (polices next/font/google auto-hébergées) — vérifié
 * par recherche exhaustive dans src/. Une CSP stricte (sans
 * 'unsafe-inline' sur script-src) nécessiterait un mécanisme de nonce
 * par requête propagé à travers l'App Router (RSC injecte des <script>
 * inline pour l'hydratation) : non déployée ici pour ne pas risquer de
 * casser l'application sans tests de non-régression complets sur
 * toutes les pages — voir le rapport M7. La CSP ci-dessous reste un
 * premier palier utile : elle bloque tout chargement de script/style/
 * frame/objet depuis une origine tierce et interdit l'embarquement du
 * Panel dans une frame.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
