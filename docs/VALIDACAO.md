# Registro de validação da entrega

Validação inicial: 19/10/2026.
Retomada e nova execução dos 15 testes: 28/10/2026, todos aprovados.
A auditoria de dependências registrada abaixo corresponde à validação inicial.

## Executado neste ambiente

| Verificação | Resultado |
|---|---|
| Instalação de dependências pelo npm e geração do lockfile | Concluída |
| Testes de validação, senha, transação, outbox e HTTP | 12 aprovados |
| Testes de interface com DOM simulado (jsdom) | 3 aprovados |
| Total de `npm test` | **15 aprovados, 0 falhas** |
| Sintaxe dos arquivos JavaScript | Verificada |
| Leitura estrutural do YAML de Compose | Válida: quatro serviços e três volumes |
| `npm audit --omit=dev` | 0 vulnerabilidades conhecidas reportadas na consulta |

Os testes de interface usam respostas controladas de API. Verificam a renderização do catálogo, escape de conteúdo, filtro, modal, cadastro/login e montagem do documento de empresa. **Não são testes visuais nem testes contra bancos reais.**

Os testes da outbox verificam recuperação após falha, troca de partição, exclusão e a prevenção de tombstone sobre uma linha reinserida com a mesma chave. Os substitutos SQL/CQL não validam comandos no servidor dos bancos.

## Validação com infraestrutura real no Mac do usuário

Em 28/10/2026, o usuário executou o Compose no Mac e compartilhou o resultado: MySQL, MongoDB, Cassandra e aplicação em estado **Healthy**. Também executou o teste integrado, que retornou:

```text
OK: CRUD de contas, empresas, eventos e inscrições; autorização; disputa da última vaga; publicação e exclusão no Cassandra.
```

Essa evidência foi fornecida pelo usuário no chat; a execução não ocorreu no ambiente de elaboração.

Também não houve validação visual em navegador: o navegador de testes não estava instalado e a tentativa de obtê-lo não concluiu. Os testes de DOM não verificam layout, fontes, sobreposição ou responsividade visual.

## Como reproduzir a validação

Na pasta do projeto:

```bash
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 600
docker compose ps
docker compose exec app npm run test:integration
```

Abra http://localhost:3000 e percorra o roteiro de `APRESENTACAO.md`, tanto em tela ampla quanto estreita. O teste integrado deve terminar com a mensagem `OK: CRUD de contas, empresas, eventos e inscrições...` e código de saída zero.

O teste usa dados fictícios próprios e tenta removê-los ao terminar. Caso a infraestrutura falhe durante a limpeza, ele informa o sufixo para localizar registros remanescentes. O workflow GitHub incluído também executa esses passos; sua inclusão não significa que já tenha sido executado ou aprovado.

## O que não é alegado

- Não foram medidos tempos de resposta, throughput ou speedup.
- Não foi validada alta disponibilidade: cada banco possui apenas um nó local.
- O repositório de código não hospeda a aplicação em execução; o sistema é executado localmente com Docker.
- Não foi realizada migração dos dados ou credenciais do ZIP original.

O pacote contém implementação, configuração e testes. A execução integrada foi confirmada pelo resultado fornecido pelo usuário. A validação visual completa continua sendo uma etapa manual.
