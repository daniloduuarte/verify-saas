# verify-saas

Uma skill para o [Claude Code](https://claude.com/claude-code) (e também um script Node que funciona sozinho) que responde a pergunta: **"o que eu acabei de mudar quebrou alguma coisa?"**

Feita para quem constrói um SaaS com ajuda de IA e não consegue ler cada linha que a IA altera.

- Sem dependências extras: só Node 18 ou mais novo.
- Configurável: Next.js + TypeScript é o padrão, mas funciona com Python, Go, Java ou qualquer coisa que tenha comandos de teste.
- Licença MIT.

---

## 1. O que é e qual problema resolve

Quando a IA mexe no seu código, você não vê tudo o que mudou. Os comandos de sempre (`tsc`, `eslint`, `build`, `test`) ajudam, mas só dizem **"passou ou falhou agora"**. Eles não respondem:

- Esse erro de lint é **novo** (culpa da mudança de hoje) ou é **dívida antiga** que já existia?
- Apareceu uma **rota nova**, uma **dependência nova** ou uma **migration de banco** que ninguém me contou?
- Essa migration mexe em **permissões e segurança**?

A `verify-saas` guarda uma "foto" do projeto (o **baseline**) e, a cada rodada, compara o estado atual com a foto. O resultado é um relatório curto que separa o que quebrou do que já estava lá e do que apenas mudou.

## 2. Como funciona

São 5 etapas, e cada uma pode ser ligada ou desligada na configuração:

| Etapa | O que faz |
|---|---|
| 1. Tipos | Roda o verificador de tipos (padrão: `npx tsc --noEmit`) e conta os erros |
| 2. Lint | Roda o lint e guarda uma **impressão digital** de cada problema (arquivo:linha:coluna:regra) |
| 3. Build | Limpa o cache e roda o build; lista as rotas geradas |
| 4. Testes | Roda a suíte de testes e conta passou/falhou |
| 5. Estrutura | Compara dependências e arquivos de migration com a última foto; avisa quando uma migration nova contém palavras de alerta |

Depois compara tudo com o `baseline` e imprime o relatório. Exemplo (dados fictícios):

```text
== 1/5 — tipos (npx tsc --noEmit) ==
  ok, zero erros
== 2/5 — lint ==
  3 erro(s), 2 warning(s)
== 3/5 — build (npm run build) ==
  ok, 14 rota(s)
== 4/5 — testes (npx vitest run --reporter=json) ==
  ok, 27/27 passou
== 5/5 — estrutura: dependências e migrations ==
  41 dependência(s), 18 migration(s)

========== RELATÓRIO ==========
✗ NOVO(S) PROBLEMA(S) DE LINT (1), não existiam antes:
    app/pedidos/page.tsx:42:7:no-unused-vars
✓ 1 problema(s) de lint corrigido(s) desde a última rodada.
ℹ Rota(s) nova(s): /relatorios
ℹ Dependência(s) nova(s): date-fns
ℹ Versão mudou: zod (3.22.0 → 3.23.8)
ℹ Migration(s) nova(s) desde a última verificação:
    20301105_clientes_policy.sql  ⚠ palavras de alerta (create policy): revise antes de aplicar em produção
================================

Baseline atualizado em verify-saas.baseline.json.
```

Código de saída: `0` se nada piorou, `1` se algo piorou (ou se tipos, build ou testes já estavam quebrados).

Atenção: ao final do modo completo o baseline é **sobrescrito** com o estado atual. Corrija as regressões antes de rodar de novo; senão a segunda rodada considera o erro "dívida antiga".

## 3. Instalação

### Com o Claude Code

Copie a pasta `verify-saas/` deste repositório para dentro do seu projeto:

```bash
# só para este projeto
mkdir -p .claude/skills
cp -r verify-saas .claude/skills/verify-saas

# ou para todos os seus projetos
mkdir -p ~/.claude/skills
cp -r verify-saas ~/.claude/skills/verify-saas
```

Copie também a configuração para a **raiz do projeto**:

```bash
cp verify-saas.config.json ./verify-saas.config.json
```

Edite o arquivo para os comandos do seu projeto (veja a seção 6 e a pasta `examples/`). O Claude Code passa a conhecer a skill e segue a regra "quando rodar" do `SKILL.md`.

Se instalou em `~/.claude/skills`, rode o driver apontando para esse caminho; o driver sempre trabalha na pasta onde você o executa.

### Passo importante: peça ao seu agente de IA para adaptar a skill ao seu SaaS

A skill vem com padrões de Next.js, mas **o seu SaaS é diferente**. Depois de instalar, peça ao agente de IA que você usa (**Claude Code, Codex, Cursor ou outro**) para ajustar tudo ao seu projeto. Cole algo assim:

```
Instalei a skill verify-saas neste projeto. Leia o projeto e adapte-a ao meu SaaS:
1. Ajuste o verify-saas.config.json aos comandos reais do meu projeto
   (tipos, lint, build e testes) e à pasta das migrations.
2. Me pergunte o que o meu negócio não pode deixar quebrar e escreva
   testes para essas regras (veja docs/exemplos-por-nicho.md).
3. Ajuste a lista alertKeywords ao vocabulário de permissões do meu banco.
4. Rode o driver com --baseline e me mostre o relatório.
Regra: nunca rode os testes contra o banco de produção. Se não houver
ambiente de teste, pare e me avise.
```

O que o agente vai fazer: trocar os comandos pelos do seu projeto, **escrever os testes das regras do seu nicho** (agenda sem horário duplicado, estoque que não fica negativo, saldo que bate, empresa A que não vê a B...) e só então gravar o primeiro baseline. Revise o que ele escreveu: é você quem conhece as regras do seu negócio.

### Com Codex ou outro agente que não usa "skills"

O driver é um script comum, então funciona com qualquer agente. Se o seu agente não reconhece a pasta `.claude/skills`, peça para ele ler `verify-saas/SKILL.md` e seguir como instrução, ou cole a regra "quando rodar" no arquivo de instruções do projeto (por exemplo, o `AGENTS.md`).

### Sem o Claude (só Node)

O driver é um arquivo só. Na raiz do seu projeto:

```bash
node caminho/para/verify-saas/driver.mjs
```

O driver usa a **pasta atual** como raiz do projeto e procura `verify-saas.config.json` nela (ou use `--config outro-arquivo.json`).

## 4. Primeiro uso: criando o baseline

Num momento em que você sabe que o projeto está "bom" (ou pelo menos conhecido):

```bash
node .claude/skills/verify-saas/driver.mjs --baseline
```

Isso grava `verify-saas.baseline.json`. **Faça commit desse arquivo no seu projeto.** É ele que permite a comparação "desde a última vez" entre sessões e máquinas. (Neste repositório da skill o baseline é ignorado pelo git, porque aqui não há projeto para comparar.)

Dívida antiga entra no baseline de propósito: a skill nunca vai dizer que ela é culpa sua. Se você corrigir um problema antigo, ela registra como melhoria.

## 5. Os 3 níveis (quando rodar)

| Nível | Quando | Comando |
|---|---|---|
| **Nada** | Só mexeu em documentação, notas ou comentários | (não rode) |
| **Rápido** | No meio do trabalho, entre edições | `node .claude/skills/verify-saas/driver.mjs --quick` |
| **Completo** | Fim de cada tarefa (antes do commit) e **sempre antes de push, deploy ou merge** | `node .claude/skills/verify-saas/driver.mjs` |

O modo rápido roda os tipos do projeto, o lint só dos arquivos alterados (via git) e só os testes ligados a eles. Não faz build, não olha estrutura e **não mexe no baseline**. Ele é um atalho, não substitui o completo.

## 6. Configuração e como adaptar ao seu projeto

Tudo mora em `verify-saas.config.json`. Qualquer campo que você não escrever usa o padrão. Exemplo mínimo para um projeto sem lint e sem build:

```json
{
  "lint":  { "enabled": false },
  "build": { "enabled": false },
  "tests": { "command": "npx jest --json", "format": "jest-json" }
}
```

Campos principais:

| Campo | Para que serve |
|---|---|
| `typecheck.command`, `typecheck.errorPattern` | Comando de tipos e a expressão regular que identifica uma linha de erro |
| `lint.command`, `lint.format` | `eslint-json` (impressão digital por problema), `lines` (cada linha de saída vira uma impressão digital, com filtro opcional em `linePattern`) ou `exit-code` (só passou/falhou) |
| `build.command`, `build.clean`, `build.routePattern` | Comando de build, pastas de cache a apagar antes, e expressão regular (com um grupo) para listar rotas. Deixe `routePattern` vazio se não se aplica |
| `tests.command`, `tests.format` | `vitest-json`, `jest-json` (contam testes) ou `exit-code` (pytest, go test, etc.) |
| `structure.dependencyFile`, `dependencyType` | `package.json` (`package-json`) ou `requirements.txt` (`requirements`) |
| `structure.migrationsDir`, `migrationExtensions` | Pasta das migrations (`supabase/migrations`, `db/migrate`, `prisma/migrations`...) |
| `structure.alertKeywords` | Palavras que fazem uma migration nova ser marcada com aviso. Padrão: `security definer`, `create policy`, `drop policy`, `grant execute`, `enable row level security`, `service_role` |
| `quick.sourcePattern`, `quick.lintCommand`, `quick.testsCommand` | Quais arquivos entram no modo rápido e os comandos dele (`{files}` vira a lista de arquivos alterados) |
| `baselinePath` | Onde guardar o baseline |

Cada etapa tem `"enabled": false` para ser desligada, e cada `command` pode ser trocado por qualquer comando que o seu projeto tenha. Há duas configurações prontas em [`examples/`](examples/): Next.js + Supabase e Python + pytest.

### Adapte por nicho: o que o seu negócio não pode deixar quebrar

A skill roda os testes, mas **quem protege o seu negócio são os testes que você escreve**. Pense: "o que, se quebrar, me custa dinheiro ou confiança?" Exemplos (código completo em [`docs/exemplos-por-nicho.md`](docs/exemplos-por-nicho.md)):

- **Agenda ou clínica:** nunca dois atendimentos no mesmo horário com o mesmo profissional.
- **Loja:** o estoque nunca fica negativo, nem com duas vendas ao mesmo tempo.
- **Financeiro:** o saldo sempre é igual à soma dos lançamentos, inclusive depois de estorno.
- **Multi-empresa (SaaS com vários clientes):** a empresa A nunca enxerga dados da empresa B. Teste entrando como o usuário real, não como administrador.
- **Pagamentos:** o mesmo aviso do provedor (webhook) recebido duas vezes credita uma vez só (idempotência).

Ajuste também `alertKeywords` ao seu banco: se você usa outro vocabulário de permissões, ou quer ser avisado de `drop table` e `drop column`, é só acrescentar à lista.

## 7. O que a skill NÃO faz

- **Não é garantia de segurança.** Ela avisa que uma migration mexeu em permissões; não diz se a mudança é segura.
- **Não valida nem aplica migrations.** Compara só os nomes dos arquivos e procura palavras de alerta no texto.
- **Não substitui testes.** Se você não escreveu um teste para uma regra, ninguém vai pegar quando ela quebrar.
- **Não instala dependências** nem corrige nada sozinha.
- **Não vê o que não foi configurado.** Se uma etapa está desligada, ela não existe no relatório.

O que ela faz bem: dizer **quando algo quebra**, separar **erro novo de dívida antiga** e avisar **quando a estrutura do projeto mudou**.

## 8. AVISO: cuidado com o banco de dados dos testes

**Rodar testes contra o banco de produção é perigoso.** Um teste que cria, altera ou apaga dados pode atingir clientes reais, enviar e-mails de verdade ou cobrar de verdade, e um erro no teste vira erro em produção.

- Use sempre um **banco de teste separado** (projeto de staging, banco local em Docker, ou o emulador do seu provedor).
- Carregue as variáveis do ambiente de teste **antes** de rodar a skill. Confira o endereço que está sendo usado.
- Nunca deixe credenciais reais (senhas, chaves de API, segredos de serviço) em arquivos commitados. A config da skill só guarda comandos e nomes de pastas, nada secreto; mantenha assim.
- Faça os dados de teste serem descartáveis e limpos no fim de cada teste.

## 9. Solução de problemas

| Sintoma | O que fazer |
|---|---|
| `Não consegui ler verify-saas.config.json` | O JSON está inválido (vírgula sobrando, aspas). Em expressões regulares dentro do JSON, barras invertidas precisam ser dobradas, ou use classes como `[0-9]` e `[.]` |
| "não consegui ler a saída do lint" | O `lint.format` não combina com o comando. Para `eslint-json` o comando precisa ter `--format json`. Se não usa ESLint, use `lines` ou `exit-code` |
| Tudo parece passar mesmo com erro de tipos | Seu comando de tipos pode não devolver código de saída diferente de zero. Teste-o à mão e veja o `echo $?` |
| Aparece problema "novo" que você não causou | Alguém mudou o repositório entre as rodadas (`git pull`). Veja `git log -3 --oneline` e rode `--baseline` se o estado atual for o bom |
| Build falha logo depois de um `git pull` | Provavelmente falta `npm install` (a skill não instala nada) ou o cache de build está velho |
| O modo rápido diz "0 arquivo(s)" | Não há mudanças não commitadas, ou `quick.sourcePattern` não combina com o caminho dos seus arquivos. O rápido usa `git`, então precisa estar num repositório |
| Falha no Windows com `rm` ou similar | Os comandos são executados pelo shell do sistema; use comandos que existam nele. A limpeza de cache (`build.clean`) é feita pelo próprio Node |

## 10. Contribuir

Contribuições são bem-vindas: abra uma issue descrevendo o caso ou um pull request pequeno e focado. Se você adaptou a skill para outra linguagem ou ferramenta de teste, uma config nova em `examples/` ajuda muita gente. Mantenha o driver sem dependências.

Licença: [MIT](LICENSE) (copyright Danilo Duarte).

## Credits

Criado por Danilo Duarte com Claude Code.

## English summary

**verify-saas** is a Claude Code skill and standalone zero-dependency Node script that answers "did my last change break anything?". It runs up to five steps (type check, lint, build, tests, structure check), compares the result to a saved **baseline** by fingerprint, and prints a report that separates **new** problems from **old debt**. It also flags new routes, dependencies and database migrations, and highlights migrations containing configurable alert keywords (for example `create policy`, `security definer`).

- Modes: full (before commit, push and deploy), `--quick` (type check plus lint and tests of changed files only, never touches the baseline), and `--baseline` (recapture the current state as the reference).
- Everything project-specific lives in `verify-saas.config.json`: commands, folders, alert keywords, and each step can be turned off. Defaults target Next.js + TypeScript + npm; see `examples/` for Next.js + Supabase and Python + pytest.
- Install: copy `verify-saas/` into `.claude/skills/` (project) or `~/.claude/skills/` (all projects), copy the config to your project root, run `node .claude/skills/verify-saas/driver.mjs --baseline` once, and commit the baseline.
- After installing, ask your AI agent (Claude Code, Codex, Cursor or whatever you use) to adapt the config and write tests for your business rules; a ready-to-paste prompt is in the install section. For agents without "skills", point them at `verify-saas/SKILL.md` or paste its rules into your project instructions (for example `AGENTS.md`).
- Exit code is 0 when nothing regressed and 1 otherwise.
- It is not a security guarantee; it only tells you something broke or changed. Protection comes from the tests you write (see `docs/exemplos-por-nicho.md`, in Portuguese). **Never run tests against a production database.**

MIT licensed. Created by Danilo Duarte with Claude Code.
