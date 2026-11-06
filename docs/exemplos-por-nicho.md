# Exemplos de testes de regra crítica, por nicho

A skill `verify-saas` só roda os testes; quem protege o negócio são os testes que você escreve. Regra de ouro: escreva um teste para cada coisa que, se quebrar, **custa dinheiro ou confiança**. Cada exemplo abaixo é curto e genérico: adapte nomes, tabelas e funções ao seu projeto.

Dica para todos: um bom teste de regra crítica **tenta quebrar a regra de propósito** e confirma que o sistema recusa.

## 1. Agenda ou clínica: nunca dois atendimentos no mesmo horário

Regra: o mesmo profissional não pode ter duas marcações confirmadas sobrepostas. A melhor defesa fica no banco (restrição de exclusão ou índice único), e o teste prova que ela funciona de verdade.

```ts
// Vitest. Usa um banco de TESTE.
import { describe, it, expect } from "vitest";
import { criarAgendamento } from "./helpers";

describe("agenda", () => {
  it("recusa segundo agendamento no mesmo horário e profissional", async () => {
    const prof = await criarProfissional();
    const horario = "2030-01-10T14:00:00Z";

    const primeiro = await criarAgendamento({ prof, inicio: horario, duracaoMin: 30 });
    expect(primeiro.error).toBeNull();

    const segundo = await criarAgendamento({ prof, inicio: horario, duracaoMin: 30 });
    expect(segundo.error).not.toBeNull(); // o banco recusou
  });

  it("aceita o horário de novo se o primeiro foi cancelado", async () => {
    const prof = await criarProfissional();
    const a = await criarAgendamento({ prof, inicio: "2030-01-11T10:00:00Z", duracaoMin: 30 });
    await cancelar(a.id);
    const b = await criarAgendamento({ prof, inicio: "2030-01-11T10:00:00Z", duracaoMin: 30 });
    expect(b.error).toBeNull();
  });
});
```

## 2. Loja: estoque nunca fica negativo

Regra: vender mais do que existe tem de falhar, e a venda que falha não pode mexer no estoque.

```python
# pytest
def test_nao_vende_alem_do_estoque(db):
    produto = criar_produto(db, estoque=2)

    with pytest.raises(EstoqueInsuficiente):
        vender(db, produto.id, quantidade=3)

    assert buscar_produto(db, produto.id).estoque == 2  # nada mudou

def test_duas_vendas_ao_mesmo_tempo_nao_estouram(db):
    produto = criar_produto(db, estoque=1)
    resultados = executar_em_paralelo(
        lambda: vender(db, produto.id, 1),
        lambda: vender(db, produto.id, 1),
    )
    assert sum(1 for r in resultados if r.ok) == 1
    assert buscar_produto(db, produto.id).estoque == 0
```

## 3. Financeiro: o saldo sempre bate

Regra: o saldo de uma conta é a soma dos seus lançamentos, e nunca diverge, mesmo depois de estornos.

```ts
it("saldo é a soma dos lançamentos, inclusive depois de estorno", async () => {
  const conta = await criarConta();
  await lancar(conta.id, +10000); // entrada de 100,00 (em centavos)
  const saida = await lancar(conta.id, -2500);
  await estornar(saida.id);

  const lancamentos = await listarLancamentos(conta.id);
  const somaDosLancamentos = lancamentos.reduce((total, l) => total + l.valor, 0);

  expect(await saldoDaConta(conta.id)).toBe(somaDosLancamentos);
  expect(await saldoDaConta(conta.id)).toBe(10000);
});
```

Dica: guarde dinheiro em **centavos inteiros**, nunca em número com vírgula; o teste acima fica exato.

## 4. Multi-empresa: uma empresa nunca vê dados de outra

Regra: o usuário da empresa A, mesmo pedindo pelo id exato de um registro da empresa B, não recebe nada. O teste deve entrar **como o usuário de verdade** (com as permissões dele), nunca com a chave administrativa, que ignora as regras de acesso e não prova nada.

```ts
describe("isolamento entre empresas", () => {
  it("usuário da empresa A não lê pedido da empresa B", async () => {
    const empresaA = await criarEmpresa("A");
    const empresaB = await criarEmpresa("B");
    const pedidoB = await criarPedido(empresaB.id);

    const comoUsuarioA = await entrarComo(empresaA.usuario); // sessão real, não admin
    const { data } = await comoUsuarioA.from("pedidos").select("*").eq("id", pedidoB.id);

    expect(data).toEqual([]); // lista vazia, não o dado e não um erro revelador
  });

  it("listagem da empresa A só traz registros da empresa A", async () => {
    const comoUsuarioA = await entrarComo((await criarEmpresa("A2")).usuario);
    const { data } = await comoUsuarioA.from("pedidos").select("organization_id");
    expect(new Set(data.map((p) => p.organization_id)).size).toBeLessThanOrEqual(1);
  });
});
```

Se alguém adicionar uma tabela nova com dados de cliente, este é o tipo de teste que deve ganhar uma linha nova. Migrations que mexem em permissões aparecem com aviso no relatório da skill.

## 5. Pagamentos: a mesma cobrança nunca é processada duas vezes (idempotência)

Regra: o provedor de pagamento reenvia avisos (webhooks) quando acha que você não respondeu. Receber o mesmo aviso duas vezes não pode creditar duas vezes.

```python
# pytest
def test_webhook_repetido_credita_uma_vez(db):
    pedido = criar_pedido(db, valor_centavos=5000)
    evento = {"id": "evt_123", "tipo": "pagamento.aprovado", "pedido": pedido.id}

    processar_webhook(db, evento)
    processar_webhook(db, evento)  # o provedor reenviou

    assert saldo_do_vendedor(db, pedido.vendedor_id) == 5000
    assert contar_lancamentos(db, pedido.id) == 1

def test_evento_com_assinatura_invalida_e_recusado(db):
    with pytest.raises(AssinaturaInvalida):
        processar_webhook_http(db, corpo="{}", assinatura="falsa")
```

## Como escolher o que testar

1. Liste as 3 a 5 coisas que, se quebrarem, fazem você perder dinheiro, dado ou cliente.
2. Para cada uma, escreva o teste que tenta quebrar a regra e espera recusa.
3. Prove que o teste funciona: estrague a regra de propósito (num commit descartável), veja o teste falhar e então desfaça. Teste que nunca falhou não protege nada.
4. Rode a skill depois: ela garante que esses testes continuam rodando a cada mudança.
