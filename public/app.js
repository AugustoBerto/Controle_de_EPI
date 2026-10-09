const $ = (id) => document.getElementById(id);
let editando = null;
let excluindo = null;
let ocupado = false;
let consulta = 0;

function mensagem(texto, erro = false) {
  $("mensagem").textContent = texto;
  $("mensagem").className = erro ? "mensagem erro" : "mensagem sucesso";
  $("mensagem").hidden = false;
}

async function requisicao(url, opcoes = {}) {
  let resposta;
  try {
    resposta = await fetch(url, opcoes);
  } catch {
    throw new Error("Não foi possível acessar o sistema. Verifique se ele está em execução.");
  }
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro || "Não foi possível concluir a operação.");
  return dados;
}

async function carregar() {
  const atual = ++consulta;
  $("vazio").textContent = "Carregando colaboradores…";
  $("vazio").hidden = false;
  $("colaboradores").replaceChildren();
  try {
    const dados = await requisicao(`/api/colaboradores?nome=${encodeURIComponent($("busca").value.trim())}`);
    if (atual !== consulta) return;
    $("total").textContent = `${dados.length} ${dados.length === 1 ? "colaborador" : "colaboradores"}`;
    $("vazio").hidden = dados.length > 0;
    $("vazio").textContent = $("busca").value.trim()
      ? "Nenhum colaborador encontrado para esse nome."
      : "Nenhum colaborador cadastrado. Clique em Novo colaborador para começar.";
    for (const colaborador of dados) {
      const linha = document.createElement("tr");
      for (const campo of ["nome", "matricula", "setor"]) {
        const celula = document.createElement("td");
        celula.textContent = colaborador[campo];
        linha.append(celula);
      }
      const acoes = document.createElement("td");
      for (const [rotulo, classe, acao] of [
        ["Editar", "botao-tabela", () => abrirFormulario(colaborador)],
        ["Excluir", "botao-tabela texto-perigo", () => confirmarExclusao(colaborador)],
      ]) {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.textContent = rotulo;
        botao.className = classe;
        botao.setAttribute("aria-label", `${rotulo} ${colaborador.nome}`);
        botao.addEventListener("click", acao);
        acoes.append(botao);
      }
      linha.append(acoes);
      $("colaboradores").append(linha);
    }
  } catch (erro) {
    if (atual !== consulta) return;
    $("total").textContent = "Lista indisponível";
    $("vazio").textContent = "Não foi possível carregar a lista. Clique em Pesquisar para tentar novamente.";
    mensagem(erro.message, true);
  }
}

function abrirFormulario(colaborador = null) {
  if (ocupado) return;
  editando = colaborador?.id ?? null;
  $("formulario").reset();
  for (const campo of ["nome", "matricula", "setor"]) $(campo).value = colaborador?.[campo] ?? "";
  $("titulo-formulario").textContent = editando ? "Editar colaborador" : "Cadastrar colaborador";
  $("salvar").textContent = editando ? "Salvar alterações" : "Salvar cadastro";
  $("mensagem").hidden = true;
  $("listagem").hidden = true;
  $("cadastro").hidden = false;
  $("novo").hidden = true;
  $("nome").focus();
}

function mostrarLista() {
  if (ocupado) return;
  $("cadastro").hidden = true;
  $("listagem").hidden = false;
  $("novo").hidden = false;
  $("busca").focus();
  carregar();
}

$("novo").addEventListener("click", () => abrirFormulario());
$("voltar").addEventListener("click", mostrarLista);
$("pesquisa").addEventListener("submit", (evento) => {
  evento.preventDefault();
  $("mensagem").hidden = true;
  carregar();
});
$("limpar").addEventListener("click", () => {
  $("busca").value = "";
  $("mensagem").hidden = true;
  carregar();
});

$("formulario").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (ocupado) return;
  const dados = {};
  for (const campo of ["nome", "matricula", "setor"]) {
    dados[campo] = $(campo).value.trim();
    if (!dados[campo]) {
      mensagem("Preencha nome, matrícula e setor.", true);
      $(campo).focus();
      return;
    }
  }
  ocupado = true;
  $("salvar").disabled = true;
  $("voltar").disabled = true;
  try {
    const resultado = await requisicao(editando ? `/api/colaboradores/${editando}` : "/api/colaboradores", {
      method: editando ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    if (!editando) $("formulario").reset();
    mensagem(resultado.mensagem);
    $("nome").focus();
  } catch (erro) {
    mensagem(erro.message, true);
  } finally {
    ocupado = false;
    $("salvar").disabled = false;
    $("voltar").disabled = false;
  }
});

function confirmarExclusao(colaborador) {
  if (ocupado) return;
  excluindo = colaborador.id;
  $("texto-exclusao").textContent = `Deseja excluir o cadastro de ${colaborador.nome}?`;
  $("confirmacao").showModal();
}
$("cancelar-exclusao").addEventListener("click", () => $("confirmacao").close());
$("confirmacao").addEventListener("cancel", (evento) => {
  if (ocupado) evento.preventDefault();
});
$("excluir").addEventListener("click", async () => {
  if (ocupado || excluindo === null) return;
  ocupado = true;
  $("excluir").disabled = true;
  $("cancelar-exclusao").disabled = true;
  try {
    const resultado = await requisicao(`/api/colaboradores/${excluindo}`, { method: "DELETE" });
    mensagem(resultado.mensagem);
    await carregar();
  } catch (erro) {
    mensagem(erro.message, true);
  } finally {
    ocupado = false;
    $("excluir").disabled = false;
    $("cancelar-exclusao").disabled = false;
    $("confirmacao").close();
    excluindo = null;
  }
});

carregar();
