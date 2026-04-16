# Design Spec: Funnel Dinâmico (Dynamic Funnel Analyzer)

## Visão Geral
O sistema atual utiliza 9 etapas fixas de funil (`SAUDACAO`, `TRIAGEM_CLINICA`, etc.) voltadas exclusivamente para clínicas de estética. O objetivo desta refatoração é permitir que o sistema aceite qualquer nicho de negócios (imobiliário, e-commerce, SaaS, etc.) ao delegar para o LLM a responsabilidade de *descobrir* as etapas do funil do cliente com base no prompt da IA deles. A análise das mensagens no banco de dados continuará usando expressões regulares (RegEx) rápidas para manter o custo baixo.

## Componentes Afetados

### 1. `src/prompt-parser.js`
- **Mudança**: O *System Prompt* enviado ao `gpt-4o-mini` será totalmente reescrito.
- **Lógica Específica:** O LLM será instruído a atuar como um "Arquiteto de Processos de Vendas" e retornar um JSON Array dinâmico de objetos de etapa.
- **Contrato JSON Esperado:**
  ```json
  {
    "stageConfig": {
      "stages": [
        {
          "code": "NOME_DA_ETAPA_SNAKE_CASE",
          "keywords": ["array", "de", "palavras-chave", "em", "regex"],
          "indicates_professional": true // boolean
        }
      ]
    }
  }
  ```

### 2. `src/filter.js`
- **Mudança**: Remoção de *hardcoded* RegExp (`DEFAULT_PROCEDURE`, `DEFAULT_CLINICAL`, etc.).
- **Lógica Específica:** Uma conversa será classificada como profissional (não é spam ou erro) se qualquer mensagem nela engatilhar uma etapa onde o LLM definiu `indicates_professional: true`.  Casos explícitos antigos (ex: mensagem apenas da IA e "IA present" sendo sempre profissional) podem precisar de ajustes de suporte de acordo.

### 3. `src/stage-detector.js`
- **Mudança**: Remoção do array estático `STAGE_ORDER` no topo do arquivo.
- **Lógica Específica:** O detector iterará dinamicamente sobre as etapas recebidas em `stageConfig.stages`. Em vez de condicionais `if` engessadas, ele iterará sobre as mensagens e, para cada mensagem, verificará se alguma das `keywords` da etapa atual deram *match*. O campo `furthest` continuará existindo, calculado a partir da última etapa sequencial alcançada.

### 4. `src/metrics.js`
- **Mudança**: O cálculo de conversões (`conversion`) e estágios alcançados (`stages`) deve ser dinâmico em relação ao comprimento do array `stageConfig.stages`. As anomalias (`anomalies` - ex: "preço antes da queixa") que dependiam fortemente de regras de negócios de clínica precisarão ser padronizadas de forma mais genérica, talvez baseadas na ordem estrita do índice das etapas e violação dessa ordem sequencial.

## Ponto Cego e Riscos

- **Qualidade do RegEx**: O desafio mais significativo é o LLM em `prompt-parser` gerar regex impreciso ou termos simples como 'sim' ou 'ok' que dariam *falsos positivos* em todas as conversas. O system prompt DEVE ditar fortes penalidades ("forte instrução restritiva") para a criação de regex generalista.

## Abordagem Recomendada
- Utilizar a opção de `indicates_professional` no arquivo de parser, unificando a classificação da conversa junto com a sua geração por IA, resolvendo o engessamento de `filter.js` com grande perfomance.
