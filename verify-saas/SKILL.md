---
name: verify-saas
description: Verifica se uma mudança de código quebrou algo. Modo completo roda tipos, lint, build e testes e compara com um baseline salvo (separa erro NOVO de dívida antiga, e avisa de rota, dependência ou migration nova, destacando migrations com palavras de segurança). Modo rápido (--quick) roda só tipos mais lint e testes dos arquivos alterados. Use no momento certo (ver "Quando rodar"); é obrigatório antes de commit, push e deploy.
---

## Quando rodar (a regra que decide)

Rodar com critério, não por reflexo. Escolha o nível pela situação:

| Situação | O que rodar |
|---|---|
| Só documentação, notas, comentários, plano ou especificação | **Nada.** Diga que não foi necessário. |
| Meio do trabalho: entre edições, rodada de correção, "será que quebrei os tipos?" | **Rápido:** `node .claude/skills/verify-saas/driver.mjs --quick` (ou só o comando de tipos, se um único tipo mudou) |
| **Fim de cada tarefa ou lote lógico, antes do commit** | **Completo**, uma vez |
| **Antes de qualquer `git push`, deploy ou merge na branch principal** | **Completo, obrigatório.** Se a última rodada completa cobre exatamente o commit que vai subir, não repita. |
| Migration nova, mudança em `package.json`, config de build, regras de acesso/autenticação | **Completo** ao fim dessa mudança (risco de mudança estrutural) |
| Depois de `git pull` ou merge de trabalho de outra pessoa | **Completo** (reancora o baseline) |

Nunca:
- rodar duas vezes seguidas sem mudança no meio;
- começar uma segunda rodada antes de ler a primeira;
- rodar em paralelo com outro build ou teste na mesma pasta;
- rodar o modo completo no meio de uma rodada de ajustes ao vivo (espere o pedido de commit).

Sempre:
- confirmar que os testes apontam para um **banco/ambiente de teste**, nunca produção (veja o aviso no README);
- reler o próprio diff antes de rodar: import sobrando e nome errado de propriedade se pegam lendo, não gastando uma rodada;
- ler o relatório inteiro, não só o código de saída.

## Como rodar

Na raiz do projeto:

```bash
node .claude/skills/verify-saas/driver.mjs            # completo
node .claude/skills/verify-saas/driver.mjs --quick    # rápido, não mexe no baseline
node .claude/skills/verify-saas/driver.mjs --baseline # recaptura o estado atual como "bom"
```

Tudo que é específico do projeto (comandos, pastas, palavras de alerta, etapas ligadas ou desligadas) fica em `verify-saas.config.json`, na raiz do projeto. Sem esse arquivo, valem os padrões para Next.js + TypeScript + npm.

Código de saída: 0 = nada piorou; 1 = algo piorou ou algo já estava quebrado (tipos, build ou testes).

## Primeiro uso: adaptar ao projeto (para o agente que está lendo isto)

Se o usuário acabou de instalar a skill e pediu para adaptá-la ao SaaS dele, faça nesta ordem:

1. **Leia o projeto** (`package.json` ou equivalente, pastas de migrations, como os testes rodam) e ajuste `verify-saas.config.json`: comandos de tipos, lint, build e testes, `structure.migrationsDir` e `alertKeywords`. Desligue (`"enabled": false`) o que o projeto não tem.
2. **Pergunte o que o negócio não pode deixar quebrar** (agenda sem horário duplicado, estoque sem ficar negativo, saldo que bate, empresa A sem ver a B, pagamento recebido duas vezes creditando uma vez...). Não invente regras: confirme com o usuário e escreva testes para elas, usando `docs/exemplos-por-nicho.md` como modelo.
3. **Confirme o ambiente de testes.** Nunca rode testes contra produção. Se não houver banco ou ambiente de teste, pare e avise o usuário.
4. **Só então** rode `node .claude/skills/verify-saas/driver.mjs --baseline` e mostre o relatório, apontando o que já estava quebrado (dívida) e o que passou.
5. Diga ao usuário o que foi ajustado e que ele deve revisar os testes escritos.

## Como ler o relatório

Em ordem:
1. **Tipos**: passou/falhou e quantidade de erros contra o baseline.
2. **Lint**: comparado por impressão digital (arquivo:linha:coluna:regra), não só pela contagem. "5 erros antes, 5 depois" pode esconder 5 erros diferentes. Dívida antiga nunca é culpa sua; só os NOVOS contam.
3. **Build**: passou/falhou e lista de rotas (se configurado).
4. **Testes**: passou/falhou contra o baseline.
5. **Estrutura**: dependências novas, removidas ou com versão trocada; migrations novas, marcadas com aviso quando contêm palavras de alerta (segurança/permissões).

Símbolos: `✗` regressão (corrigir), `✓` melhorou, `=` sem mudança, `ℹ` informação, `⚠` conferir se foi intencional.

Depois de imprimir, o modo completo **sobrescreve o baseline** com o estado atual. Por isso: corrija as regressões antes de rodar de novo, senão a segunda rodada trata o erro como "dívida antiga".

## Boas práticas

- O baseline (`verify-saas.baseline.json`) deve ser **commitado no projeto**; é ele que faz a comparação "desde a última vez" funcionar entre sessões e máquinas.
- Primeira vez no projeto: rode com `--baseline` num estado que você sabe estar bom.
- Migrations são comparadas **só pelo nome do arquivo**. A skill não aplica nem valida o SQL; ela avisa que apareceu uma nova e se mexe em segurança.
- A skill não instala dependências (`npm install` é uma ação maior do que uma verificação deve fazer sozinha).
- Se o relatório mostra um problema "novo" que você não causou, veja se alguém mudou o repositório entre as rodadas (`git log -3 --oneline`).
- A proteção de verdade vem dos **testes que você escreve** (ver `docs/exemplos-por-nicho.md`). A skill só garante que eles rodam, e avisa quando algo muda.
