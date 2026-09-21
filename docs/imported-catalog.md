# Catálogo local de Importados

O catálogo Nike US deixa de depender das buscas feitas por visitantes. A tabela
`imported_products` guarda permanentemente os dados em USD, cores, imagens de origem
e disponibilidade por SKU. Os preços em BRL continuam sendo calculados com as regras
do backoffice e o câmbio vigente. Os arquivos de imagem continuam usando o espelho existente.

## Sincronização

- O job da API inicia na subida e verifica a agenda a cada 30 segundos.
- Uma rodada por hora, entre 06:00 inclusive e 00:00 exclusive, em `America/Sao_Paulo`.
- Entre 00:00 e 06:00 não inicia novas consultas automáticas ao catálogo. Se uma rodada
  atravessar meia-noite, para após a requisição em andamento, sem retirar itens ausentes.
- O scraper percorre todas as páginas do feed Nike US de produtos `ACTIVE`, em lotes
  de 50 threads, e separa `FOOTWEAR` localmente. O endpoint rejeita filtro por
  `productType`; uma busca por “Nike” ou “shoes” não substitui essa varredura.
- Cada cor de cada thread é armazenada. A disponibilidade vem de `availableGtins`/`availableSkus`.
- As páginas são persistidas gradualmente. Produtos ausentes só ficam inativos depois
  de uma varredura completa. Em erro, os dados já existentes continuam disponíveis,
  incluindo as páginas atualizadas antes da falha; a próxima tentativa ocorre na hora seguinte.
- Uma lease no banco impede rodadas simultâneas entre réplicas, com renovação por página
  e recuperação após cinco minutos se a instância morrer. Cliques mais recentes têm
  prioridade sobre os dados de uma varredura em andamento.
- O estado, última tentativa e último sucesso ficam em `settings/imported-catalog-sync`.
  `startJobs: false` desliga o job nos testes.

## Loja e backoffice

- Recuperação de busca: se o espelho nunca concluiu uma rodada ou está há mais de
  90 minutos sem sucesso, uma consulta por termo também consulta a primeira página
  da busca Nike (50 grupos, incluindo suas cores). Os detalhes dos SKUs ausentes são
  carregados com concorrência máxima de cinco e persistidos com seus tamanhos reais.
  Grid e dropdown compartilham a mesma consulta em cache. Falhas preservam resultados
  locais; sem resultados locais, a API retorna erro em vez de um falso “não encontrado”.
  Isso recupera buscas durante a falha conhecida do feed, que rejeita `anchor > 1000`;
  não significa que o espelho inteiro esteja completo. Consultas só por tamanho
  continuam limitadas aos produtos já importados.

- `GET /api/imported?q=&size=&offset=0&limit=48`: busca local paginada, filtro BR,
  contagens de tamanhos disponíveis para a busca e data da última rodada completa.
  O filtro é aplicado antes da paginação. Modelos restritos são excluídos também das contagens.
- O dropdown fica antes do hero de Importados. Pode ser usado sem busca e é preservado
  ao buscar um modelo ou trocar de categoria. `?tam=41` permite compartilhar o tamanho.
  As opções atualizam a cada minuto e ao retornar à janela.
- `GET /api/product/:sku` consulta a Nike na hora, mesmo de madrugada, atualiza o banco
  e aguarda a resposta. Em falha não apresenta estoque antigo como confirmado.
  Checkout também exige consulta fresca; o modal e a sacola usam o preço atualizado.
- `/admin/importados`: catálogo, data da sincronização e seleção ordenada de oito tênis.
  Busca por nome/SKU, adição, remoção e controles de ordem; salvar exige oito SKUs
  distintos e válidos. GET `/api/admin/imported` e PUT `/api/admin/imported/top8`
  exigem administrador. A seleção é persistida em `settings/imported-top8`.
- Sem seleção salva, o Top 8 usa os termos atuais de `TOP8_TERMS` e completa com
  itens do catálogo local. Um item que ficar inativo/restrito deixa de ser exibido;
  o painel identifica a referência indisponível para substituição.
- A configuração do hero em `/admin/vitrine` continua independente.

## Ativação

Publicar **scraper e API juntos**, além do frontend. Gerar o cliente Prisma com
`npm run db:generate -w apps/api` e aplicar
`npm run db:deploy -w apps/api` no ambiente de destino. A migração adiciona somente
`imported_products` e seu índice, sem alterar pedidos ou estoque próprio. O entrypoint
existente já executa `prisma migrate deploy` no deploy da API.

A primeira população ocorre na próxima janela ativa. Até ela começar a preencher o
banco, a vitrine e o dropdown mostram estado vazio. Não foi aplicada migração nem
executada a população no banco remoto durante a implementação.

## Validação

`npm test -w apps/api -- test/local-catalog.test.js test/imported-routes.test.js test/app.test.js test/swr-cache.test.js test/seo.test.js`

Cobertura: limites do horário, reinício, repetição horária, paginação, interrupção à
meia-noite, falhas, lease, prioridade de cliques, conversão/filtros, atualização fresca,
ordem do Top 8, autorização administrativa e proteção dos preços internos.
`npm run build` verifica a compilação do frontend.
