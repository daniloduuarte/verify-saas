---
name: verify-saas
description: Verifica se uma mudança de código quebrou algo. Modo completo roda tipos, lint, build e testes e compara com um baseline salvo (separa erro NOVO de dívida antiga, e avisa de rota, dependência ou migration nova, destacando migrations com palavras de segurança). Modo rápido (--quick) roda tipos mais lint e testes só dos arquivos alterados (git). Use no momento certo (ver "Quando rodar"); é obrigatório antes de commit, push e deploy.
---

## Segurança primeiro

O `verify-saas.config.json` executa comandos arbitrários (como os `scripts` do `package.json`). **Não rode a skill em repositório não confiável** sem ler o config antes. Nunca rode testes contra banco de produção.

## Quando rodar (a regra que decide)

Rodar com critério, não por reflexo. Escolha o nível pela situação:

| Situação | O que rodar |
|---|---|
| Só documentação, notas, comentários, plano ou especificação | **Nada.** Diga que não foi necessário. |
| Meio do trabalho: entre edições, rodada de correção, "será que quebrei os tipos?" | **Rápido:** `node .claude/skills/verify-saas/driver.mjs --quick` |
| **Fim de cada tarefa ou lote lógico, antes do commit** | **Completo**, uma vez |
| **Antes de qualquer `git push`, deploy ou merge na branch principal** | **Completo, obrigatório.** Se a última rodada completa cobre exatamente o commit que vai subir, não repita. |
| Migration nova, mudança em `package.json`, config de build, regras de acesso/autenticação | **Completo** ao fim dessa mudança |
| Depois de `git pull` ou merge de trabalho de outra pessoa | **Completo** |

Nunca:
- rodar duas vezes seguidas sem mudança no meio;
- começar uma segunda rodada antes de ler a primeira;
- rodar em paralelo com outro build ou teste na mesma pasta;
- rodar o modo completo no meio de uma rodada de ajustes ao vivo (espere o pedido de commit).

Sempre:
- confirmar que os testes apontam para um **banco/ambiente de teste**, nunca produção;
- reler o próprio diff antes de rodar: import sobrando e nome errado de propriedade se pegam lendo;
- ler o relatório inteiro, não só o código de saída.

## Como rodar

Na **raiz do projeto** (a pasta atual é o projeto):

```bash
node .claude/skills/verify-saas/driver.mjs --init            # uma vez: cria verify-saas.config.json certo para o projeto
node .claude/skills/verify-saas/driver.mjs --baseline        # uma vez: grava o estado atual como "bom"
node .claude/skills/verify-saas/driver.mjs                   # completo
node .claude/skills/verify-saas/driver.mjs --quick           # rápido, nunca toca no baseline
node .claude/skills/verify-saas/driver.mjs --json            # igual, mas o stdout é um JSON para você ler
```

Sem `verify-saas.config.json` o driver para com mensagem (código 2): rode `--init`. Funciona em Windows, macOS e Linux, e detecta npm, pnpm, yarn ou bun sozinho.

Códigos de saída: **0** nada piorou; **1** regressão ou etapa quebrada (tipos, build, testes, leitura do lint); **2** uso/config errados ou **nada foi verificado**.

## Como ler o relatório

Prefira `--json` quando for interpretar o resultado: `ok`, `exitCode`, `steps.<etapa>.status` (`ok`, `failed`, `skipped`, `disabled`), `regressions`, `broken`, `skipped`, `baseline` (`criado`, `atualizado`, `mantido`, `não gravado`).

No texto, em ordem:
1. **Tipos**: passou/falhou e quantidade de erros contra o baseline.
2. **Lint**: por impressão digital (arquivo:linha:coluna:regra), não só pela contagem. Dívida antiga não é culpa da mudança; só os NOVOS contam.
3. **Build**: passou/falhou e rotas, se configurado.
4. **Testes**: passou/falhou contra o baseline.
5. **Estrutura**: dependências novas, removidas ou com versão trocada; migrations novas, marcadas quando contêm palavras de alerta.

Tags: `[REGRESSAO]` corrigir; `[melhorou]`; `[igual]`; `[info]`; `[atencao]` conferir se foi intencional.

**Etapas "PULADAS" não foram verificadas.** Diga isso ao usuário com clareza; nunca descreva como "tudo passou" algo que foi pulado.

## Baseline: regra que você nunca quebra

- Com regressão, o driver **não** atualiza o baseline. **Nunca use `--update-baseline` nem `--baseline` para fazer um aviso sumir.** Corrija a causa.
- Só use `--update-baseline` quando o usuário disser explicitamente que aceita o estado atual (por exemplo, uma dependência removida de propósito). Registre o motivo na resposta.
- `--baseline` é para o primeiro uso (ou depois de o usuário confirmar que o estado atual é o bom).
- Não edite `verify-saas.baseline.json` à mão e não apague o arquivo para "limpar" uma regressão.
- O baseline deve ser commitado no projeto.

## Primeiro uso: adaptar ao projeto (para o agente que está lendo isto)

Se o usuário acabou de instalar a skill e pediu para adaptá-la ao SaaS dele, nesta ordem:

1. Rode `--init` e **leia** o `verify-saas.config.json` gerado. Ajuste comandos de tipos, lint, build e testes, `structure.migrationsDir` e `alertKeywords`. Desligue (`"enabled": false`) o que o projeto não tem. Confira que cada comando é inofensivo e do próprio projeto.
2. **Pergunte o que o negócio não pode deixar quebrar** (agenda sem horário duplicado, estoque sem ficar negativo, saldo que bate, empresa A sem ver a B...). Não invente regras: confirme com o usuário e escreva testes, usando `docs/exemplos-por-nicho.md` como modelo.
3. **Confirme o ambiente de testes.** Nunca rode testes contra produção. Se não houver banco de teste, pare e avise.
4. **Só então** rode `--baseline` e mostre o relatório, apontando o que já estava quebrado (dívida) e o que foi pulado.
5. Diga o que foi ajustado e que o usuário deve revisar os testes escritos.

## Limites (diga quando relevante)

- Não substitui revisão de código nem teste de segurança; não prova ausência de bugs.
- Migrations são comparadas só pelo nome; o SQL não é validado nem aplicado.
- O deslocamento de linhas pode fazer dívida antiga parecer "nova" no lint: confira o arquivo antes de acusar a mudança.
- Não instala dependências.
