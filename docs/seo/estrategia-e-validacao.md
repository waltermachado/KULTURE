# SEO da Kulture BR

## Implementação

- Títulos e descrições em português por página, no HTML inicial e na navegação React.
- Canonical com domínio público configurado e sem filtros/UTMs. Produtos usam o slug já existente; aliases por código/seção redirecionam com 301 sem quebrar links publicados.
- Open Graph/Twitter em todas as páginas, foto própria no produto e `/og-image.png` como padrão.
- JSON-LD: Organization, WebSite, CollectionPage, Product/Offer e BreadcrumbList, usando preço e disponibilidade reais. Sem avaliações inventadas.
- `/sitemap.xml` gerado pelo servidor com home, vitrines e produtos ativos das duas seções. Falha do banco retorna 503 em vez de sitemap incompleto. `/robots.txt` anuncia o sitemap. Nenhuma política de noindex adicionada ou alterada.
- HTTP → HTTPS com 308 em produção; HSTS em respostas HTTPS. O Docker existente configura TRUST_PROXY=true. Manter essa opção somente atrás do proxy confiável do provedor para evitar loops.
- H1 nas páginas da loja/conta/checkout; títulos de produto H3 abaixo da seção H2; rodapé H2. Imagens decorativas mantêm alt vazio; fotos de produto usam nome e posição na galeria.
- Imagem principal com prioridade alta e dimensões; miniaturas com lazy loading; painel e CSS administrativo separados; ajustes para telas estreitas e movimento reduzido.
- PNGs locais comprimidos. Sharp converte novos uploads e catálogo para WebP, limita resolução e mantém o original se o resultado for maior. Uploads antigos são otimizados na leitura, com cache de memória limitado a 24 MiB por processo. Originais no banco não são sobrescritos. URLs externas usadas diretamente continuam sob controle do fornecedor; não é possível garantir compressão de todos esses recursos.

## Search Console — etapa externa pendente

Para propriedade de prefixo `https://lojakulture.com.br/`, configurar `GOOGLE_SITE_VERIFICATION` no serviço da API com apenas o valor de `content` fornecido pelo Google. O servidor incluirá a meta tag no HTML inicial. Após publicar, clicar em Verificar na conta proprietária e enviar `https://lojakulture.com.br/sitemap.xml`. Para propriedade de domínio, usar o TXT de DNS fornecido pelo Google. Não inventar token nem substituir verificações existentes.

Inspecionar home, ambas as vitrines e um produto disponível; verificar canonical escolhido e renderização. A implementação não confirma propriedade, indexação nem posicionamento. [Instruções oficiais de verificação](https://support.google.com/webmasters/answer/9008080?hl=pt-BR).

## Estratégia de backlinks — 90 dias

Objetivo: conquistar referências editoriais relevantes para consumidores brasileiros de sneakers, basquete e streetwear. Contatos e publicações dependem de execução comercial; nenhuma mensagem foi enviada.

| Prazo | Ação | Entrega e medida |
|---|---|---|
| Semanas 1–2 | Mapear 25 veículos/criadores/comunidades de sneakers, ligas amadoras e eventos de streetwear no Brasil; priorizar Fortaleza e parceiros com relacionamento existente | Planilha com URL, público, pauta recente, relevância, contato público e oportunidade editorial; selecionar 10 com afinidade comprovada |
| Semanas 2–4 | Produzir guia de numeração BR/US por modelo com medições próprias e guia fotográfico de compra de tênis originais | Dois recursos úteis, com autoria, fotos próprias e URLs permanentes; revisão de informações antes de publicar |
| Semanas 4–8 | Propor aos 10 selecionados pautas específicas: disponibilidade no Brasil, comparação de ajuste e cuidados com importação | Até cinco abordagens personalizadas por semana após autorização; registrar respostas e referências conquistadas, sem prometer links |
| Semanas 6–10 | Documentar ações reais com ligas locais e eventos; oferecer fotos e dados originais aos organizadores | Página de evento ou reportagem com referência contextual à Kulture quando editorialmente pertinente |
| Semanas 10–12 | Revisar menções sem link, atualizar recursos e medir resultados | Comparar domínios relevantes que referenciam o site, visitas de referência, buscas pela marca e compras atribuídas |

Usar âncoras naturais como “Kulture BR”, o nome do produto ou o título do recurso. Direcionar cada referência à página que ajuda o leitor; preferir vitrines permanentes quando um par tiver estoque muito curto. Não comprar pacotes de links ou trocar links em massa. Parcerias remuneradas devem usar `rel="sponsored"` no site publicador. [Política do Google sobre links comerciais](https://developers.google.com/search/blog/2021/07/link-tagging-and-link-spam-update).

Modelo de abordagem (rascunho, não enviado): “Olá, [nome]. Vi sua publicação sobre [pauta real]. Estamos preparando [recurso] com [evidência própria]. Podemos compartilhar as fotos e os dados para uma possível matéria sobre [ângulo útil ao público]? Se utilizar, a fonte completa ficará em [URL publicada].”

## Validação e limites

Testar metadados/JSON-LD, sitemap, redirects, 404 de produto inexistente, proteção contra Host arbitrário e imagens. Conferir o build e testar mobile após publicação. URLs de produto e conteúdo comercial continuam sendo renderizados pela SPA; metadados e schema já chegam no HTML inicial. Pré-renderização completa seria uma evolução separada.

Não atribuir nota Lighthouse ou melhoria medida de LCP/INP/CLS sem teste real. Comparar laboratório antes/depois com os mesmos parâmetros e acompanhar dados de campo após publicação. [Guia oficial de LCP](https://web.dev/articles/optimize-lcp) e [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

### Resultado local (14/09/2026)

Build Vite aprovado. Prévia do build conferida em 375 e 320 px: H1 único, imagens com alt e metadados atualizados ao navegar de home para Hypados; CTA do WhatsApp corrigido para não transbordar em 320 px. API indisponível na prévia estática, portanto catálogo real/checkout completo não foram exercitados.

Sete testes novos de SEO/HTTPS/sitemap/JSON-LD/compressão passaram com cópias exatas dos módulos em `/tmp`, usando Fastify 5.12.0, @fastify/static 10.1.3, Sharp 0.35.4 e Vitest 3.2.7, para contornar o carregamento bloqueado de dependências locais. Os quatro testes existentes de URL pública passaram no projeto. Não foi rodada a suíte que altera banco de pedidos/estoque.

PNGs existentes: 431.770 → 103.733 bytes (76% a menos). O cartão OG novo não entra nessa comparação. Nada foi publicado; Search Console e medição de Core Web Vitals em produção continuam pendentes.
