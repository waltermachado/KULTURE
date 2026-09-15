import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { pageSeo } from '@kulture/shared/seo';
import { api } from '../lib/api.js';

function apply(seo) {
  document.title = seo.title;
  document.head.querySelectorAll('[data-seo], meta[name="description"], link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"]').forEach(el => {
    if (el.getAttribute('name') !== 'google-site-verification') el.remove();
  });
  for (const [name, content] of Object.entries({ description: seo.description, 'og:type': seo.type, 'og:site_name': 'Kulture BR', 'og:locale': 'pt_BR', 'og:title': seo.title, 'og:description': seo.description, 'og:url': seo.canonical, 'og:image': seo.image, 'og:image:alt': seo.title, 'twitter:card': 'summary_large_image', 'twitter:title': seo.title, 'twitter:description': seo.description, 'twitter:image': seo.image })) {
    const tag = document.createElement('meta');
    tag.setAttribute(name.startsWith('og:') ? 'property' : 'name', name);
    tag.content = content; tag.dataset.seo = ''; document.head.append(tag);
  }
  const link = document.createElement('link'); link.rel = 'canonical'; link.href = seo.canonical; link.dataset.seo = ''; document.head.append(link);
  const script = document.createElement('script'); script.type = 'application/ld+json'; script.textContent = JSON.stringify(seo.schema); script.dataset.seo = ''; document.head.append(script);
}
export default function Seo() {
  const { pathname } = useLocation();
  useEffect(() => {
    let active = true;
    const base = document.querySelector('meta[name="site-origin"]')?.content || window.location.origin;
    apply(pageSeo(pathname, base));
    const match = /^\/(pronta-entrega|hypados)\/([^/]+)\/?$/.exec(pathname);
    if (match) api.stockProduct(decodeURIComponent(match[2])).then(({ product }) => { if (active) apply(pageSeo(pathname, base, product)); }).catch(() => {});
    return () => { active = false; };
  }, [pathname]);
  return null;
}
