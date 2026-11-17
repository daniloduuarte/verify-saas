# verify-saas

Uma skill para o [Claude Code](https://claude.com/claude-code) (e também um script Node que funciona sozinho) que responde a pergunta: **"o que eu acabei de mudar quebrou alguma coisa?"**

Feita para quem constrói um SaaS com ajuda de IA e não consegue ler cada linha que a IA altera.

- Sem dependências extras: só Node 18 ou mais novo (e `git`, para o modo rápido).
- Funciona com Next.js/Node (npm, pnpm, yarn ou bun), Python, Go ou qualquer coisa que tenha comandos de teste.
- Windows, macOS e Linux.
- Licença MIT.

---

## 1. O que é e qual problema resolve

Quando a IA mexe no seu código, você não vê tudo o que mudou. Os comandos de sempre (`tsc`, `eslint`, `build`, `test`) ajudam, mas só dizem **"passou ou falhou agora"**. Eles não respondem:

- Esse erro de lint é **novo** (culpa da mudança de hoje) ou é **dívida antiga** que já existia?
- Apareceu uma **rota nova**, uma **dependência nova** ou uma **migration de banco** que ninguém me contou?
- Essa migration mexe em **permissões e segurança**?

A `verify-saas` guarda uma "foto" do projeto (o **baseline**) e, a cada rodada, compara o estado atual com a foto. O resultado é um relatório curto que separa o que quebrou do que já estava lá e do que apenas mudou.

## 2. Requisitos

- **Node 18 ou mais novo** (`node --version`).
- Rodar **na raiz do seu projeto**: o driver usa a pasta atual como o projeto.
- As dependências do projeto já instaladas (`npm install` ou equivalente). A skill nunca instala nada sozinha.
- `git`, só para o `--quick`.
- As ferramentas que você quer checar (tsc, eslint, pytest, go...) instaladas no projeto. As que não existirem são **puladas com aviso**, nunca contadas como falha nem como sucesso.

## 3. Instalação em 3 passos

Na **raiz do seu projeto**.

**Passo 1: copiar a skill para o projeto**

macOS, Linux ou Git Bash no Windows:

```bash
git clone --depth 1 https://github.com/daniloduuarte/verify-saas.git .verify-saas-tmp
mkdir -p .claude/skills
cp -r .verify-saas-tmp/verify-saas .claude/skills/verify-saas
rm -rf .verify-saas-tmp
```

PowerShell (Windows):

```powershell
git clone --depth 1 https://github.com/daniloduuarte/verify-saas.git .verify-saas-tmp
New-Item -ItemType Directory -Force .claude/skills | Out-Null
Copy-Item -Recurse .verify-saas-tmp/verify-saas .claude/skills/verify-saas
Remove-Item -Recurse -Force .verify-saas-tmp
```

Se `.claude/skills/verify-saas` já existir, apague-a antes (senão a cópia cai dentro dela). Para valer em todos os seus projetos, use `~/.claude/skills/verify-saas` no lugar; o driver sempre trabalha na pasta onde você o executa.

**Passo 2: gerar a configuração certa para o seu projeto**

```bash
node .claude/skills/verify-saas/driver.mjs --init
```

Isso cria o `verify-saas.config.json` olhando o seu projeto (Next.js, Node, Python ou Go). Só liga as etapas que existem: sem ESLint instalado, o lint nasce desligado, e assim por diante. Ele avisa o que desligou e nunca sobrescreve um config existente (use `--init --force` para recriar). Abra o arquivo e confira os comandos: eles vão rodar no seu computador.

**Passo 3: gravar o primeiro baseline**

```bash
node .claude/skills/verify-saas/driver.mjs --baseline
```

Isso grava `verify-saas.baseline.json` com o estado de agora. **Faça commit desse arquivo.** A dívida antiga entra no baseline de propósito: a skill nunca vai dizer que ela é culpa da mudança de hoje.

Pronto. Dali em diante, rode o completo antes de cada commit e o `--quick` entre as edições (seção 5).

### Instalação pelo agente de IA (alternativa)

Abra o seu agente (Claude Code, Codex, Cursor ou outro) dentro da pasta do projeto e cole:

```
Instale a skill verify-saas neste projeto, sem rodar o verificador ainda:
1. git clone --depth 1 https://github.com/daniloduuarte/verify-saas.git numa pasta temporária.
2. Copie a pasta verify-saas/ do clone para .claude/skills/verify-saas deste projeto.
3. Apague a pasta temporária.
4. Rode: node .claude/skills/verify-saas/driver.mjs --init
5. Mostre o verify-saas.config.json criado e me diga o que foi desligado e por quê.
Não rode testes contra banco de produção. Se não houver ambiente de teste, pare e me avise.
```

Depois, para adaptar ao negócio, peça: "Pergunte o que o meu negócio não pode deixar quebrar e escreva testes para essas regras (veja docs/exemplos-por-nicho.md)". Revise o que ele escrever: quem conhece as regras do negócio é você.

Agentes sem o conceito de "skills" (Codex etc.): peça para ler `.claude/skills/verify-saas/SKILL.md` e seguir como instrução, ou cole a regra "quando rodar" no `AGENTS.md`.

## 4. O que cada etapa faz e exige

| Etapa | O que faz | O que exige | Se faltar |
|---|---|---|---|
| 1. Tipos | Roda o verificador de tipos (`npx tsc --noEmit`, `go vet`, `mypy`...) e conta os erros | A ferramenta instalada e `typecheck.enabled` ligado | Pulada com aviso |
| 2. Lint | Roda o lint e guarda uma **impressão digital** de cada problema (arquivo:linha:coluna:regra) | ESLint, ruff etc. instalado | Pulada com aviso |
| 3. Build | Apaga as pastas de `build.clean` (só dentro do projeto) e roda o build; lista as rotas se `routePattern` estiver definido | Script `build` no `package.json` (ou comando equivalente) | Pulada com aviso |
| 4. Testes | Roda a suíte e conta passou/falhou | Testes existentes | Pulada com aviso |
| 5. Estrutura | Compara dependências e arquivos de migration com a última foto; avisa quando uma migration nova contém palavras de alerta | `package.json`, `requirements.txt` ou `go.mod`; pasta de migrations opcional | Ignorada sem erro |

Pulada quer dizer **não verificada**, e o relatório lista isso no fim. Se **todas** as etapas forem puladas, o resultado é "nada foi verificado" (código 2), nunca aprovado.

O gerenciador de pacotes é detectado sozinho (`packageManager` do `package.json`, depois `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, senão npm): `npx` e `npm run` do config viram `pnpm exec`, `yarn`, `bunx` etc. Para forçar, use `"packageManager": "pnpm"` no config.

### Exemplo de relatório (dados fictícios)

```text
== 1/5 tipos (npx tsc --noEmit) ==
  ok, zero erros
== 2/5 lint ==
  3 erro(s), 2 warning(s)
== 3/5 build (npm run build) ==
  ok, 14 rota(s)
== 4/5 testes (npx vitest run --reporter=json) ==
  ok, 27/27 passou
== 5/5 estrutura: dependências e migrations ==
  41 dependência(s), 18 migration(s)

========== RELATORIO ==========
[REGRESSAO] Lint: 1 problema(s) novo(s), não existiam antes:
[REGRESSAO]     app/pedidos/page.tsx:42:7:no-unused-vars
[melhorou] Lint: 1 problema(s) corrigido(s) desde a última rodada.
[info] Rota(s) nova(s): /relatorios
[info] Dependência(s) nova(s): date-fns
[info] Versão mudou: zod (3.22.0 para 3.23.8)
[info] Migration(s) nova(s) desde a última verificação:
[atencao]     20301105_clientes_policy.sql  palavras de alerta (create policy): revise antes de aplicar em produção
================================

Baseline NÃO atualizado: houve regressão. Corrija e rode de novo.
(Se aceita o estado atual de propósito, rode com --update-baseline.)
RESULTADO: REPROVADO (1 regressão(ões); quebrado: nada).
```

### Códigos de saída

| Código | Significado |
|---|---|
| `0` | Nada piorou e nada estava quebrado |
| `1` | Houve regressão, ou tipos, build, testes (ou a leitura do lint) estão quebrando |
| `2` | Uso ou configuração errados, config ausente, ou nada foi verificado |

### Saída em JSON

`--json` imprime um único JSON no stdout (o texto legível vai para o stderr), com `exitCode`, `ok`, `steps`, `regressions`, `broken`, `skipped` e `baseline`. Útil para o Claude Code ou para o CI ler sem interpretar texto.

## 5. Os 3 níveis (quando rodar)

| Nível | Quando | Comando |
|---|---|---|
| **Nada** | Só mexeu em documentação, notas ou comentários | (não rode) |
| **Rápido** | No meio do trabalho, entre edições | `node .claude/skills/verify-saas/driver.mjs --quick` |
| **Completo** | Fim de cada tarefa (antes do commit) e **sempre antes de push, deploy ou merge** | `node .claude/skills/verify-saas/driver.mjs` |

O **modo rápido** pergunta ao `git` quais arquivos mudaram (alterados, novos e renomeados; apagados ficam de fora; funciona em repositório sem commits). Roda os tipos do projeto inteiro e passa **só esses arquivos** ao lint e ao teste. Fora de um repositório git ele avisa e roda só os tipos. Não faz build, não olha estrutura e **nunca mexe no baseline**. É um atalho, não substitui o completo.

### Como o baseline é tratado (mudou)

- **Sem regressão:** o completo atualiza o baseline (melhorias viram o novo "bom").
- **Com regressão:** o baseline **não** é sobrescrito. Antes, ele era sobrescrito sempre, e a segunda rodada tratava o erro novo como dívida antiga: um falso verde. Agora o erro continua aparecendo até você corrigir.
- `--update-baseline` grava o baseline mesmo com regressão: use só quando aceitar o estado atual de propósito.
- `--baseline` ignora o baseline antigo e captura o estado atual do zero (primeiro uso).
- Uma etapa pulada numa rodada não apaga o que o baseline sabia sobre ela.

## 6. Configuração

Tudo mora em `verify-saas.config.json` (o `--init` gera). Campo que você não escrever usa o padrão. Modelos prontos ficam em [`verify-saas/templates/`](verify-saas/templates/): `nextjs`, `python-pytest` e `go`.

| Campo | Para que serve |
|---|---|
| `typecheck.command`, `typecheck.errorPattern` | Comando de tipos e a expressão regular que identifica uma linha de erro |
| `lint.command`, `lint.format` | `eslint-json` (impressão digital por problema), `lines` (cada linha vira uma impressão digital, filtro opcional em `linePattern`) ou `exit-code` |
| `build.command`, `build.clean`, `build.routePattern` | Comando de build, pastas de cache a apagar antes (só dentro do projeto) e expressão regular com um grupo para listar rotas. Vazio se não se aplica |
| `tests.command`, `tests.format` | `vitest-json`, `jest-json` (contam testes) ou `exit-code` (pytest, go test etc.) |
| `structure.dependencyFile`, `dependencyType` | `package-json`, `requirements` ou `go-mod` |
| `structure.migrationsDir`, `migrationExtensions` | Pasta das migrations (`supabase/migrations`, `db/migrate`, `prisma/migrations`...) |
| `structure.alertKeywords` | Palavras que marcam uma migration nova com aviso |
| `quick.sourcePattern`, `quick.lintCommand`, `quick.testsCommand` | Quais arquivos entram no modo rápido e os comandos dele. `{files}` precisa ser um argumento separado por espaços: `npx eslint {files}` |
| `timeoutSeconds` | Limite por etapa (padrão 600). Cada etapa aceita o seu próprio `timeoutSeconds` |
| `maxOutputMB` | Saída máxima guardada por comando (padrão 64). O excesso é descartado, a memória não estoura |
| `packageManager` | `auto` (padrão), `npm`, `pnpm`, `yarn` ou `bun` |
| `baselinePath` | Onde guardar o baseline |

Cada etapa tem `"enabled": false`. Exemplo mínimo para um projeto sem lint e sem build:

```json
{
  "lint":  { "enabled": false },
  "build": { "enabled": false },
  "tests": { "command": "npx jest --json", "format": "jest-json" }
}
```

### Adapte por nicho: o que o seu negócio não pode deixar quebrar

A skill roda os testes, mas **quem protege o seu negócio são os testes que você escreve**. Pense: "o que, se quebrar, me custa dinheiro ou confiança?" Exemplos (código em [`docs/exemplos-por-nicho.md`](docs/exemplos-por-nicho.md)): agenda sem horário duplicado, estoque que não fica negativo, saldo que bate, empresa A que nunca vê a B, webhook de pagamento recebido duas vezes creditando uma vez.

## 7. Segurança

- **O config executa comandos arbitrários**, exatamente como os `scripts` de um `package.json`. Quem controla o `verify-saas.config.json` controla o que roda na sua máquina. **Não rode a skill em repositório que você não confia** (um clone aleatório, um pull request de desconhecido) sem ler o config antes.
- Comandos simples são executados **sem shell**, com argumentos separados. Só comandos com operadores de shell (`&&`, `|`, `;`, `>`) passam por shell, e nesse caso `{files}` é recusado.
- Os arquivos alterados do `--quick` vão como argumentos, nunca colados em texto de shell. Nomes com aspas, `%` ou quebra de linha são ignorados; nomes começando com `-` ganham `./` para não virarem opção.
- O `build.clean` só apaga pastas **dentro** do projeto. A skill não baixa nem executa pacotes novos: se o `npx` pedir uma ferramenta que o projeto não instalou, a etapa é pulada.
- Segredos conhecidos (chaves, tokens, JWT, senha em URL) são cortados da saída impressa e do baseline. É uma rede de proteção, não garantia: não deixe segredo em saída de teste.
- **Nunca rode testes contra o banco de produção.** Teste que cria, altera ou apaga dados pode atingir clientes reais, enviar e-mail ou cobrar de verdade. Use banco de teste separado, carregue as variáveis do ambiente de teste antes e confira o endereço usado. Credenciais reais nunca vão em arquivo commitado; o config só guarda comandos e nomes de pasta.

## 8. Limites (sem enfeite)

- **Não substitui revisão de código nem teste de segurança.** Avisar que uma migration mexe em permissões não diz se a mudança é segura.
- **Não prova ausência de bugs.** Só diz que, no que foi medido, nada piorou desde a última foto. Sem teste para uma regra, ninguém pega quando ela quebra.
- Migrations são comparadas **só pelo nome**; a skill não aplica nem valida o SQL.
- A impressão digital do lint inclui a linha: se você insere código acima de um problema antigo, ele pode parecer "novo" (e o antigo "corrigido"). Confira o arquivo antes de concluir que foi culpa da mudança.
- Etapa pulada ou desligada **não é verificada**. Leia a linha "Etapas puladas".
- Não instala dependências nem corrige nada.
- Testado no Windows e em Linux com Node 24 e projetos fictícios; Python/pytest e Go ficam cobertos pelos testes de `--init` e da lógica, não por uma rodada real de cada ferramenta.

## 9. Se algo falhar

| Sintoma | O que fazer |
|---|---|
| `Não achei verify-saas.config.json` | Você não está na raiz do projeto, ou falta o passo 2: `node .claude/skills/verify-saas/driver.mjs --init` |
| `Este projeto tem package.json mas não tem a pasta node_modules` | Instale as dependências (`npm install`, `pnpm install`...) e rode de novo |
| `Não consegui ler verify-saas.config.json` | JSON inválido (vírgula sobrando, aspas). Em expressões regulares dentro do JSON, barra invertida precisa ser dobrada, ou use `[0-9]` e `[.]` |
| `PULADO: o script "x" não existe` ou `"x" não está instalado` | A etapa não se aplica ao projeto, ou falta instalar a ferramenta. Desligue-a com `"enabled": false` ou instale |
| `RESULTADO: nada foi verificado` | Todas as etapas foram puladas. Revise o config e as dependências |
| `FALHOU: não consegui ler a saída do lint` | O `lint.format` não combina com o comando. Para `eslint-json` o comando precisa ter `--format json`; sem ESLint, use `lines` ou `exit-code`. Pode também ser o ESLint quebrando por config inválida: rode o comando à mão |
| `passou do limite de Ns` | O comando demorou mais que `timeoutSeconds`. Aumente o valor na config se for normal |
| Aparece problema "novo" que você não causou | Alguém mudou o repositório entre as rodadas (`git pull`), ou foi o deslocamento de linha (seção 8). Veja `git log -3 --oneline`; se o estado atual é o bom, `--baseline` |
| O `--quick` diz "0 arquivo(s)" | Sem mudanças não commitadas, ou `quick.sourcePattern` não casa com o caminho dos seus arquivos |
| `Baseline NÃO atualizado` | É de propósito: há regressão. Corrija. Só use `--update-baseline` se aceitar o estado atual |
| Falha no Windows com `rm` ou similar no config | Use comandos que existam no Windows ou prefira o Node (`node script.mjs`). A limpeza de cache (`build.clean`) é feita pelo próprio Node |

## 10. Rodar os testes da própria skill

```bash
node --test
```

Sem dependências. Cobrem: projeto que passa, erro de tipo novo, lint novo contra dívida antiga, etapas puladas, baseline não sobrescrito, `--init`, `--quick` em repositório git temporário, quoting para Windows, timeout e redação de segredos.

## 11. Contribuir

Contribuições são bem-vindas: abra uma issue descrevendo o caso ou um pull request pequeno e focado. Se você adaptou a skill para outra linguagem, um modelo novo em `verify-saas/templates/` ajuda muita gente. Mantenha o driver sem dependências e rode `node --test` antes.

Licença: [MIT](LICENSE) (copyright Danilo Duarte).

## Credits

Criado por [Danilo Duarte](https://github.com/daniloduuarte) com Claude Code.

## English summary

**verify-saas** is a Claude Code skill and standalone zero-dependency Node script that answers "did my last change break anything?". It runs up to five steps (type check, lint, build, tests, structure check), compares the result to a saved **baseline** by fingerprint, and prints a report that separates **new** problems from **old debt**. It also flags new routes, dependencies and database migrations, and highlights migrations containing configurable alert keywords.

- Install in 3 steps: copy `verify-saas/` into `.claude/skills/`, run `node .claude/skills/verify-saas/driver.mjs --init` (detects Next.js/Node, Python or Go and writes a matching config), then `--baseline`.
- Modes: full (before commit, push and deploy), `--quick` (type check plus lint and tests of git-changed files only, never touches the baseline), `--baseline`, `--update-baseline`, `--json`.
- The baseline is **not** overwritten when a regression is found (use `--update-baseline` to accept it on purpose). Steps whose tools or scripts are missing are skipped with a warning, never counted as pass or fail; if everything is skipped the exit code is 2.
- Exit codes: 0 ok, 1 regression or broken step, 2 usage/config error or nothing verified.
- The config runs arbitrary commands like `package.json` scripts: do not run it on untrusted repositories. It is not a security guarantee and does not prove the absence of bugs. **Never run tests against a production database.**

MIT licensed. Created by Danilo Duarte with Claude Code.
