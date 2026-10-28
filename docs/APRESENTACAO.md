# Roteiro de apresentação — EventFlow

Duração sugerida: 7 a 10 minutos. Todos os dados usados na demonstração devem ser fictícios.

## 1. Problema e proposta (1 minuto)

“O EventFlow permite que empresas publiquem eventos e que usuários confirmem presença. Aplicamos persistência poliglota: cada banco foi escolhido considerando a estrutura dos dados e as consultas da aplicação.”

## 2. Escolha dos bancos (2 minutos)

- **MySQL:** contas e inscrições precisam de unicidade, relacionamentos e transações. O controle de vagas fica aqui para impedir que duas pessoas ocupem a mesma última vaga.
- **MongoDB:** o perfil da empresa é lido como um agregado, com endereço e especialidades embarcados. A estrutura documental permite evolução do perfil.
- **Cassandra:** o catálogo é modelado pelas consultas, com uma tabela para buscar por ID e outra para listar por mês. O modelo duplica dados deliberadamente para atender essas consultas.

“Os bancos NoSQL são tecnologias diferentes e o sistema também possui um banco relacional, atendendo à arquitetura solicitada.”

## 3. Demonstração funcional (3 a 4 minutos)

1. Verifique os serviços pelo botão no rodapé e mostre `docker compose ps`.
2. Crie uma conta, entre e cadastre uma empresa fictícia.
3. Crie um evento futuro de uma vaga, com preço zero.
4. Aguarde a publicação e encontre o evento pelo mês no catálogo.
5. Em janela anônima, cadastre um participante, confirme presença e edite a observação.
6. Tente excluir o evento pelo organizador: explique a recusa por haver inscritos.
7. Cancele a inscrição, edite o evento, exclua o evento e aguarde a sincronização.
8. Mostre a exclusão de empresa e conta, completando os CRUDs.

Antes da apresentação, execute `docker compose exec app npm run test:integration`. Esse comando exercita os três bancos reais e disputa a última vaga com requisições concorrentes. Só apresente o teste como aprovado se ele concluir com sucesso no seu ambiente.

## 4. Concorrência e recuperação (1 a 2 minutos)

“A inscrição é transacional: bloqueamos a linha de capacidade, verificamos a vaga e confirmamos inscrição e contador juntos. Para publicar eventos no Cassandra, usamos uma outbox persistente no MySQL. Se a publicação falhar, a tarefa permanece e é tentada novamente. Não há transação global entre os três bancos.”

Teste opcional de falha: pare Cassandra com `docker compose stop cassandra`, cadastre um evento e observe o estado pendente. Algumas telas que leem o catálogo podem exibir indisponibilidade. Reinicie com `docker compose start cassandra`, aguarde o healthcheck e confirme a publicação automática. Não precisa apagar volumes.

## 5. Limitações e conclusão (1 minuto)

“O ambiente usa um nó de cada banco e foi preparado para demonstração local. Não estamos comprovando alta disponibilidade nem desempenho superior. As principais contribuições são a escolha justificada de cada banco, o CRUD integrado, a modelagem por consulta e o tratamento explícito da consistência.”

## Perguntas prováveis

**Por que não usar só MySQL?**
Seria possível para esse porte. O objetivo acadêmico é aplicar modelos diferentes e discutir seus custos. Não afirmamos que três bancos sempre serão mais simples ou rápidos.

**Por que duplicar eventos no Cassandra?**
Cada tabela atende uma consulta com a chave de partição conhecida, evitando filtragem e varredura global.

**Por que parte do evento aparece no MySQL?**
Apenas o registro de controle e capacidade precisa da mesma transação das inscrições. Os dados do catálogo ficam no Cassandra. O conteúdo na outbox é temporário e serve para recuperação.

**Há consistência imediata entre os bancos?**
Não. Contas e inscrições usam transações SQL; a publicação do catálogo é eventual e sinalizada na interface. O sistema explicita as limitações da coordenação entre bancos.

**Onde está o CRUD?**
Conta: cadastro, perfil, edição e exclusão. Empresa: cadastro, consulta, edição e exclusão. Evento: criação, catálogo/agenda, edição e exclusão. Inscrição: confirmação, listagem, observação e cancelamento.
