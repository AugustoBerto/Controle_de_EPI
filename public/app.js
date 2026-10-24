const $ = (id) => document.getElementById(id);

let ocupado = false;
let secaoAtual = "colaboradores";
let usuarioAtual = null;

// Estados de edição / exclusão
let editandoColaboradorId = null;
let editandoEpiId = null;
let editandoEmprestimoId = null;
let editandoUsuarioId = null;

let exclusaoCallback = null;

// ========================================================
// FEEDBACK VISUAL
// ========================================================
function exibirAlerta(texto, erro = false) {
  const el = $("alerta-feedback");
  $("alerta-texto").textContent = texto;
  el.className = erro ? "alerta alerta-erro" : "alerta alerta-sucesso";
  el.hidden = false;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function fecharAlerta() {
  $("alerta-feedback").hidden = true;
}

$("alerta-fechar").addEventListener("click", fecharAlerta);

async function requisicao(url, opcoes = {}) {
  let resposta;
  try {
    resposta = await fetch(url, opcoes);
  } catch {
    throw new Error("Não foi possível conectar ao servidor. Verifique se o sistema está em execução.");
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 401 && !url.startsWith("/api/auth/")) {
      usuarioAtual = null;
      exibirTelaLogin();
    }
    throw new Error(dados.erro || "Não foi possível concluir a operação solicitada.");
  }
  return dados;
}

function formatarData(dataIso) {
  if (!dataIso) return "—";
  const partes = dataIso.split("-");
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return dataIso;
}

function obterDataHoje() {
  return new Date().toISOString().slice(0, 10);
}

function obterDataFutura(dias = 7) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function obterIniciais(nome) {
  if (!nome) return "AG";
  const partes = nome.trim().split(" ");
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// ========================================================
// AUTENTICAÇÃO REAL E SESSÃO
// ========================================================
async function verificarAutenticacao() {
  try {
    const res = await requisicao("/api/auth/me");
    if (res.autenticado && res.usuario) {
      definirUsuarioLogado(res.usuario);
      $("tela-login").hidden = true;
      carregarSecaoAtual();
    } else {
      exibirTelaLogin();
    }
  } catch {
    exibirTelaLogin();
  }
}

function definirUsuarioLogado(usuario) {
  usuarioAtual = usuario;
  $("topo-usuario-nome").textContent = usuario.nome;
  $("topo-usuario-perfil").textContent = usuario.perfil || "Operador";
  $("usuario-avatar").textContent = obterIniciais(usuario.nome);

  const ehAdmin = usuario.perfil === "Administrador";
  if ($("rotulo-nav-admin")) $("rotulo-nav-admin").hidden = !ehAdmin;
  if ($("nav-usuarios")) $("nav-usuarios").hidden = !ehAdmin;
  if (!ehAdmin) {
    if ($("view-usuarios")) $("view-usuarios").hidden = true;
    if (secaoAtual === "usuarios") {
      alternarSecao("colaboradores");
    }
  }
}

function exibirTelaLogin() {
  if ($("rotulo-nav-admin")) $("rotulo-nav-admin").hidden = true;
  if ($("nav-usuarios")) $("nav-usuarios").hidden = true;
  if ($("view-usuarios")) $("view-usuarios").hidden = true;
  $("form-login-auth").reset();
  $("login-alerta").hidden = true;
  $("tela-login").hidden = false;
}

$("form-login-auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-alerta").hidden = true;
  const usuario = $("login-usuario").value.trim();
  const senha = $("login-senha").value;

  try {
    const res = await requisicao("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });
    definirUsuarioLogado(res.usuario);
    $("tela-login").hidden = true;
    exibirAlerta(`Bem-vindo ao sistema, ${res.usuario.nome}!`);
    carregarSecaoAtual();
  } catch (erro) {
    $("login-alerta-texto").textContent = erro.message;
    $("login-alerta").hidden = false;
  }
});

$("btn-logout").addEventListener("click", async () => {
  try {
    await requisicao("/api/auth/logout", { method: "POST" });
  } finally {
    usuarioAtual = null;
    exibirTelaLogin();
  }
});

// ========================================================
// NAVEGAÇÃO ENTRE SEÇÕES
// ========================================================
const secoes = {
  colaboradores: { link: "nav-colaboradores", view: "view-colaboradores", titulo: "Colaboradores" },
  epis: { link: "nav-epis", view: "view-epis", titulo: "Equipamentos de Proteção (EPIs)" },
  emprestimos: { link: "nav-emprestimos", view: "view-emprestimos", titulo: "Controle de Empréstimos" },
  relatorios: { link: "nav-relatorios", view: "view-relatorios", titulo: "Relatórios de Empréstimo" },
  usuarios: { link: "nav-usuarios", view: "view-usuarios", titulo: "Gestão de Usuários" },
};

function alternarSecao(novaSecao) {
  if (!secoes[novaSecao]) return;
  if (novaSecao === "usuarios" && (!usuarioAtual || usuarioAtual.perfil !== "Administrador")) {
    exibirAlerta("Acesso restrito a administradores.", true);
    return;
  }
  fecharAlerta();
  secaoAtual = novaSecao;

  for (const chave in secoes) {
    const s = secoes[chave];
    $(s.link).className = chave === novaSecao ? "nav-item ativo" : "nav-item";
    $(s.view).hidden = chave !== novaSecao;
  }

  $("trilha-secao").textContent = secoes[novaSecao].titulo;
  carregarSecaoAtual();
}

function carregarSecaoAtual() {
  if (secaoAtual === "colaboradores") {
    mostrarListaColaboradores();
  } else if (secaoAtual === "epis") {
    mostrarListaEpis();
  } else if (secaoAtual === "emprestimos") {
    mostrarListaEmprestimos();
    atualizarMetricas();
  } else if (secaoAtual === "relatorios") {
    buscarRelatorios();
  } else if (secaoAtual === "usuarios") {
    mostrarListaUsuarios();
  }
}

for (const chave in secoes) {
  $(secoes[chave].link).addEventListener("click", (e) => {
    e.preventDefault();
    alternarSecao(chave);
  });
}
$("menu-home").addEventListener("click", (e) => {
  e.preventDefault();
  alternarSecao("colaboradores");
});

// ========================================================
// MODAL DE CONFIRMAÇÃO REUTILIZÁVEL
// ========================================================
function abrirConfirmacao(titulo, mensagem, onConfirmar) {
  $("modal-titulo").textContent = titulo;
  $("modal-mensagem").textContent = mensagem;
  exclusaoCallback = onConfirmar;
  $("modal-confirmacao").showModal();
}

$("modal-btn-cancelar").addEventListener("click", () => {
  $("modal-confirmacao").close();
  exclusaoCallback = null;
});

$("modal-btn-confirmar").addEventListener("click", async () => {
  if (typeof exclusaoCallback === "function") {
    const acao = exclusaoCallback;
    exclusaoCallback = null;
    $("modal-confirmacao").close();
    await acao();
  }
});

// ========================================================
// 1. MÓDULO DE COLABORADORES
// ========================================================
async function carregarColaboradores() {
  const busca = $("busca-colaborador").value.trim();
  $("tabela-colaboradores-corpo").replaceChildren();
  $("vazio-colaboradores").hidden = true;

  try {
    const lista = await requisicao(`/api/colaboradores?nome=${encodeURIComponent(busca)}`);
    if (lista.length === 0) {
      $("vazio-colaboradores").hidden = false;
      return;
    }

    for (const item of lista) {
      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.innerHTML = `<strong>${item.nome}</strong>`;
      tr.append(tdNome);

      const tdMatricula = document.createElement("td");
      tdMatricula.innerHTML = `<span style="font-family: monospace; font-size: 13px; font-weight: 600;">${item.matricula}</span>`;
      tr.append(tdMatricula);

      const tdSetor = document.createElement("td");
      tdSetor.textContent = item.setor;
      tr.append(tdSetor);

      const tdAcao = document.createElement("td");
      tdAcao.style.textAlign = "right";

      const btnEditar = document.createElement("button");
      btnEditar.type = "button";
      btnEditar.textContent = "Editar";
      btnEditar.className = "btn-acao btn-acao-editar";
      btnEditar.addEventListener("click", () => abrirFormColaborador(item));
      tdAcao.append(btnEditar);

      const btnDeletar = document.createElement("button");
      btnDeletar.type = "button";
      btnDeletar.textContent = "Excluir";
      btnDeletar.className = "btn-acao btn-acao-deletar";
      btnDeletar.addEventListener("click", () => {
        abrirConfirmacao(
          "Excluir Colaborador",
          `Deseja realmente remover o colaborador "${item.nome}"?`,
          async () => {
            try {
              const res = await requisicao(`/api/colaboradores/${item.id}`, { method: "DELETE" });
              exibirAlerta(res.mensagem);
              carregarColaboradores();
            } catch (e) {
              exibirAlerta(e.message, true);
            }
          }
        );
      });
      tdAcao.append(btnDeletar);

      tr.append(tdAcao);
      $("tabela-colaboradores-corpo").append(tr);
    }
  } catch (e) {
    exibirAlerta(e.message, true);
  }
}

function mostrarListaColaboradores() {
  $("colaboradores-form-card").hidden = true;
  $("colaboradores-lista").hidden = false;
  carregarColaboradores();
}

function abrirFormColaborador(colab = null) {
  editandoColaboradorId = colab?.id ?? null;
  $("form-colaborador").reset();
  $("titulo-form-colaborador").textContent = editandoColaboradorId ? "Editar Colaborador" : "Cadastrar Colaborador";

  if (colab) {
    $("colab-nome").value = colab.nome;
    $("colab-matricula").value = colab.matricula;
    $("colab-setor").value = colab.setor;
  }

  fecharAlerta();
  $("colaboradores-lista").hidden = true;
  $("colaboradores-form-card").hidden = false;
  $("colab-nome").focus();
}

$("btn-criar-colaborador").addEventListener("click", () => abrirFormColaborador());
$("voltar-colaborador").addEventListener("click", mostrarListaColaboradores);
$("busca-colaborador").addEventListener("input", carregarColaboradores);
$("colab-matricula").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D+/g, "").slice(0, 10);
});

$("form-colaborador").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) return;
  const dados = {
    nome: $("colab-nome").value.trim(),
    matricula: $("colab-matricula").value.trim(),
    setor: $("colab-setor").value.trim(),
  };

  ocupado = true;
  $("salvar-colaborador").disabled = true;
  try {
    const url = editandoColaboradorId ? `/api/colaboradores/${editandoColaboradorId}` : "/api/colaboradores";
    const res = await requisicao(url, {
      method: editandoColaboradorId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    if (!editandoColaboradorId) $("form-colaborador").reset();
    exibirAlerta(res.mensagem || "Colaborador salvo com sucesso!");
    $("colab-nome").focus();
  } catch (erro) {
    exibirAlerta(erro.message, true);
  } finally {
    ocupado = false;
    $("salvar-colaborador").disabled = false;
  }
});

// ========================================================
// 2. MÓDULO DE EQUIPAMENTOS (EPIS)
// ========================================================
async function carregarEpis() {
  const busca = $("busca-epi").value.trim();
  $("tabela-epis-corpo").replaceChildren();
  $("vazio-epis").hidden = true;

  try {
    const lista = await requisicao(`/api/epis?nome=${encodeURIComponent(busca)}`);
    if (lista.length === 0) {
      $("vazio-epis").hidden = false;
      return;
    }

    for (const item of lista) {
      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.innerHTML = `<strong>${item.nome}</strong>`;
      tr.append(tdNome);

      const tdDesc = document.createElement("td");
      tdDesc.textContent = item.descricao || "—";
      tr.append(tdDesc);

      const tdQtd = document.createElement("td");
      const emBaixa = item.quantidade_disponivel <= 5;
      tdQtd.innerHTML = `<span style="font-weight: 700; color: ${emBaixa ? "var(--perigo)" : "var(--sucesso)"}">${item.quantidade_disponivel} unidades</span>`;
      tr.append(tdQtd);

      const tdAcao = document.createElement("td");
      tdAcao.style.textAlign = "right";

      const btnEditar = document.createElement("button");
      btnEditar.type = "button";
      btnEditar.textContent = "Editar";
      btnEditar.className = "btn-acao btn-acao-editar";
      btnEditar.addEventListener("click", () => abrirFormEpi(item));
      tdAcao.append(btnEditar);

      const btnDeletar = document.createElement("button");
      btnDeletar.type = "button";
      btnDeletar.textContent = "Excluir";
      btnDeletar.className = "btn-acao btn-acao-deletar";
      btnDeletar.addEventListener("click", () => {
        abrirConfirmacao(
          "Excluir Equipamento",
          `Deseja remover o equipamento "${item.nome}" do catálogo?`,
          async () => {
            try {
              const res = await requisicao(`/api/epis/${item.id}`, { method: "DELETE" });
              exibirAlerta(res.mensagem);
              carregarEpis();
            } catch (e) {
              exibirAlerta(e.message, true);
            }
          }
        );
      });
      tdAcao.append(btnDeletar);

      tr.append(tdAcao);
      $("tabela-epis-corpo").append(tr);
    }
  } catch (e) {
    exibirAlerta(e.message, true);
  }
}

function mostrarListaEpis() {
  $("epis-form-card").hidden = true;
  $("epis-lista").hidden = false;
  carregarEpis();
}

function abrirFormEpi(epi = null) {
  editandoEpiId = epi?.id ?? null;
  $("form-epi").reset();
  $("titulo-form-epi").textContent = editandoEpiId ? "Editar Equipamento" : "Cadastrar Equipamento";

  if (epi) {
    $("epi-nome").value = epi.nome;
    $("epi-quantidade").value = epi.quantidade_disponivel;
    $("epi-descricao").value = epi.descricao || "";
  }

  fecharAlerta();
  $("epis-lista").hidden = true;
  $("epis-form-card").hidden = false;
  $("epi-nome").focus();
}

$("btn-criar-epi").addEventListener("click", () => abrirFormEpi());
$("voltar-epi").addEventListener("click", mostrarListaEpis);
$("busca-epi").addEventListener("input", carregarEpis);

$("form-epi").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) return;
  const dados = {
    nome: $("epi-nome").value.trim(),
    quantidade_disponivel: Number($("epi-quantidade").value),
    descricao: $("epi-descricao").value.trim(),
  };

  ocupado = true;
  $("salvar-epi").disabled = true;
  try {
    const url = editandoEpiId ? `/api/epis/${editandoEpiId}` : "/api/epis";
    const res = await requisicao(url, {
      method: editandoEpiId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    if (!editandoEpiId) $("form-epi").reset();
    exibirAlerta(res.mensagem || "Equipamento salvo com sucesso!");
    $("epi-nome").focus();
  } catch (erro) {
    exibirAlerta(erro.message, true);
  } finally {
    ocupado = false;
    $("salvar-epi").disabled = false;
  }
});

// ========================================================
// 3. MÓDULO DE CONTROLE DE EMPRÉSTIMOS
// ========================================================
async function atualizarMetricas() {
  try {
    const m = await requisicao("/api/metricas");
    $("kpi-disponivel").textContent = m.disponivel;
    $("kpi-emprestado").textContent = m.emprestado;
    $("kpi-vencido").textContent = m.vencido;
    $("kpi-colaboradores").textContent = m.colaboradores;
  } catch {
    // Mantém silencioso
  }
}

async function carregarEmprestimos() {
  const busca = $("busca-emprestimo").value.trim();
  $("tabela-emprestimos-corpo").replaceChildren();
  $("vazio-emprestimos").hidden = true;

  try {
    const lista = await requisicao(`/api/emprestimos?nome=${encodeURIComponent(busca)}`);
    if (lista.length === 0) {
      $("vazio-emprestimos").hidden = false;
      return;
    }

    for (const item of lista) {
      const tr = document.createElement("tr");

      const tdColab = document.createElement("td");
      tdColab.innerHTML = `<strong>${item.colaborador_nome}</strong><br><small style="color:var(--texto-mutado);">Matrícula: ${item.colaborador_matricula}</small>`;
      tr.append(tdColab);

      const tdEpi = document.createElement("td");
      tdEpi.innerHTML = `<strong>${item.epi_nome}</strong>`;
      tr.append(tdEpi);

      const tdDataEmp = document.createElement("td");
      tdDataEmp.textContent = formatarData(item.data_emprestimo);
      tr.append(tdDataEmp);

      const tdDataPrev = document.createElement("td");
      if (item.status === "Fornecido") {
        tdDataPrev.innerHTML = `<span style="color: var(--texto-mutado);">Sem devolução</span>`;
      } else {
        tdDataPrev.textContent = formatarData(item.data_prevista_devolucao);
      }
      tr.append(tdDataPrev);

      const tdStatus = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `badge-status status-${item.status}`;
      badge.textContent = item.status;
      tdStatus.append(badge);
      tr.append(tdStatus);

      const tdDev = document.createElement("td");
      if (item.status === "Fornecido") {
        tdDev.innerHTML = `<span style="color: var(--texto-mutado);">Entrega definitiva</span>`;
      } else if (item.data_devolucao) {
        tdDev.innerHTML = `<span>${formatarData(item.data_devolucao)}</span><br><small style="color:var(--texto-mutado);">${item.observacao_devolucao || ""}</small>`;
      } else {
        tdDev.innerHTML = `<span style="color: var(--texto-mutado);">Pendente</span>`;
      }
      tr.append(tdDev);

      const tdAcao = document.createElement("td");
      tdAcao.style.textAlign = "right";

      if (item.status !== "Fornecido") {
        const btnEditar = document.createElement("button");
        btnEditar.type = "button";
        btnEditar.textContent = "Atualizar";
        btnEditar.className = "btn-acao btn-acao-editar";
        btnEditar.addEventListener("click", () => abrirFormEmprestimo(item));
        tdAcao.append(btnEditar);
      } else {
        tdAcao.innerHTML = `<span style="color: var(--texto-mutado); font-size: 12px;">Concluído</span>`;
      }

      tr.append(tdAcao);
      $("tabela-emprestimos-corpo").append(tr);
    }
  } catch (e) {
    exibirAlerta(e.message, true);
  }
}

function mostrarListaEmprestimos() {
  $("emprestimos-form-card").hidden = true;
  $("emprestimos-lista").hidden = false;
  carregarEmprestimos();
}

async function popularSelectsEmprestimo(colabId = null, epiId = null) {
  const [colaboradores, epis] = await Promise.all([
    requisicao("/api/colaboradores"),
    requisicao("/api/epis"),
  ]);

  const selColab = $("emp-colaborador");
  selColab.replaceChildren();
  const optColabPadrao = document.createElement("option");
  optColabPadrao.value = "";
  optColabPadrao.textContent = "Selecione o colaborador…";
  selColab.append(optColabPadrao);
  for (const c of colaboradores) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.nome} (${c.matricula} - ${c.setor})`;
    if (c.id === colabId) opt.selected = true;
    selColab.append(opt);
  }

  const selEpi = $("emp-epi");
  selEpi.replaceChildren();
  const optEpiPadrao = document.createElement("option");
  optEpiPadrao.value = "";
  optEpiPadrao.textContent = "Selecione o equipamento…";
  selEpi.append(optEpiPadrao);
  for (const ep of epis) {
    const opt = document.createElement("option");
    opt.value = ep.id;
    opt.textContent = `${ep.nome} (Disponível: ${ep.quantidade_disponivel})`;
    if (ep.id === epiId) opt.selected = true;
    selEpi.append(opt);
  }
}

function configurarSelectStatus(statusAtual = "Emprestado", modoEdicao = false) {
  const selStatus = $("emp-status");
  selStatus.replaceChildren();

  const opcoes = modoEdicao
    ? ["Emprestado", "Fornecido", "Devolvido", "Danificado", "Perdido"]
    : ["Emprestado", "Fornecido"];

  for (const st of opcoes) {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = st;
    if (st === statusAtual) opt.selected = true;
    selStatus.append(opt);
  }
  atualizarCamposDevolucao();
}

function atualizarCamposDevolucao() {
  const status = $("emp-status").value;
  const ehFornecido = status === "Fornecido";
  const grupoPrevista = $("emp-data-prevista").closest(".form-grupo");

  if (ehFornecido) {
    if (grupoPrevista) grupoPrevista.hidden = true;
    $("emp-data-prevista").required = false;
    $("emp-data-prevista").disabled = true;
    $("emp-data-prevista").value = "";
  } else {
    if (grupoPrevista) grupoPrevista.hidden = false;
    if (!editandoEmprestimoId) {
      $("emp-data-prevista").required = true;
      $("emp-data-prevista").disabled = false;
      if (!$("emp-data-prevista").value) {
        $("emp-data-prevista").value = obterDataFutura(7);
      }
    }
  }

  const exibir = ["Devolvido", "Danificado", "Perdido"].includes(status);
  $("container-devolucao").hidden = !exibir;
  if (exibir && !$("emp-data-devolucao").value) {
    $("emp-data-devolucao").value = obterDataHoje();
  }
}

$("emp-status").addEventListener("change", atualizarCamposDevolucao);

async function abrirFormEmprestimo(emp = null) {
  editandoEmprestimoId = emp?.id ?? null;
  $("form-emprestimo").reset();
  fecharAlerta();

  try {
    await popularSelectsEmprestimo(emp?.colaborador_id, emp?.epi_id);
  } catch (e) {
    exibirAlerta(e.message, true);
    return;
  }

  if (editandoEmprestimoId) {
    $("titulo-form-emprestimo").textContent = "Atualizar Status do Empréstimo";
    $("subtitulo-form-emprestimo").textContent = "Os dados de entrega originais permanecem protegidos para integridade do registro.";

    $("emp-data-emprestimo").value = emp.data_emprestimo;
    $("emp-data-prevista").value = emp.data_prevista_devolucao;
    $("emp-condicoes").value = emp.condicoes_equipamento || "";
    $("emp-data-devolucao").value = emp.data_devolucao || "";
    $("emp-observacao").value = emp.observacao_devolucao || "";

    // Bloqueia campos de entrega original na atualização
    $("emp-colaborador").disabled = true;
    $("emp-epi").disabled = true;
    $("emp-data-emprestimo").disabled = true;
    $("emp-data-prevista").disabled = true;
    $("emp-data-prevista").removeAttribute("min");

    configurarSelectStatus(emp.status, true);
  } else {
    $("titulo-form-emprestimo").textContent = "Registrar Novo Empréstimo";
    $("subtitulo-form-emprestimo").textContent = "Informe o colaborador, o equipamento de segurança e as datas do empréstimo.";

    $("emp-colaborador").disabled = false;
    $("emp-epi").disabled = false;
    $("emp-data-emprestimo").disabled = false;
    $("emp-data-prevista").disabled = false;

    $("emp-data-emprestimo").value = obterDataHoje();
    $("emp-data-prevista").min = obterDataFutura(1);
    $("emp-data-prevista").value = obterDataFutura(7);
    configurarSelectStatus("Emprestado", false);
  }

  $("emprestimos-lista").hidden = true;
  $("emprestimos-form-card").hidden = false;
}

$("emp-data-emprestimo").addEventListener("change", () => {
  if (editandoEmprestimoId) return;
  const base = $("emp-data-emprestimo").value || obterDataHoje();
  const hoje = obterDataHoje();
  const ref = base > hoje ? base : hoje;
  const d = new Date(ref + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const minPrevista = d.toISOString().slice(0, 10);
  $("emp-data-prevista").min = minPrevista;
  if ($("emp-data-prevista").value && $("emp-data-prevista").value < minPrevista) {
    $("emp-data-prevista").value = minPrevista;
  }
});

$("btn-criar-emprestimo").addEventListener("click", () => abrirFormEmprestimo());
$("voltar-emprestimo").addEventListener("click", mostrarListaEmprestimos);
$("busca-emprestimo").addEventListener("input", carregarEmprestimos);

$("form-emprestimo").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) return;

  ocupado = true;
  $("salvar-emprestimo").disabled = true;

  try {
    if (editandoEmprestimoId) {
      const dados = {
        status: $("emp-status").value,
        condicoes_equipamento: $("emp-condicoes").value.trim(),
        data_devolucao: $("emp-data-devolucao").value || null,
        observacao_devolucao: $("emp-observacao").value.trim(),
      };
      const res = await requisicao(`/api/emprestimos/${editandoEmprestimoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      exibirAlerta(res.mensagem || "Status atualizado com sucesso!");
      mostrarListaEmprestimos();
      atualizarMetricas();
    } else {
      const statusEscolhido = $("emp-status").value;
      const dados = {
        colaborador_id: Number($("emp-colaborador").value),
        epi_id: Number($("emp-epi").value),
        data_emprestimo: $("emp-data-emprestimo").value,
        data_prevista_devolucao: statusEscolhido === "Fornecido" ? "" : $("emp-data-prevista").value,
        status: statusEscolhido,
        condicoes_equipamento: $("emp-condicoes").value.trim(),
      };
      const res = await requisicao("/api/emprestimos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      await popularSelectsEmprestimo();
      $("form-emprestimo").reset();
      $("emp-data-emprestimo").value = obterDataHoje();
      $("emp-data-prevista").min = obterDataFutura(1);
      $("emp-data-prevista").value = obterDataFutura(7);
      configurarSelectStatus("Emprestado", false);
      exibirAlerta(res.mensagem || "Empréstimo registrado com sucesso!");
      atualizarMetricas();
    }
  } catch (erro) {
    exibirAlerta(erro.message, true);
  } finally {
    ocupado = false;
    $("salvar-emprestimo").disabled = false;
  }
});

// ========================================================
// 4. MÓDULO DE RELATÓRIOS (FILTRO AND)
// ========================================================
async function buscarRelatorios() {
  const colab = $("rel-colaborador").value.trim();
  const epi = $("rel-equipamento").value.trim();
  const status = $("rel-status").value;

  $("tabela-relatorios-corpo").replaceChildren();
  $("vazio-relatorios").hidden = true;

  try {
    const url = `/api/relatorios/emprestimos?colaborador=${encodeURIComponent(colab)}&equipamento=${encodeURIComponent(epi)}&status=${encodeURIComponent(status)}`;
    const lista = await requisicao(url);

    if (lista.length === 0) {
      $("vazio-relatorios").hidden = false;
      return;
    }

    for (const item of lista) {
      const tr = document.createElement("tr");

      const tdColab = document.createElement("td");
      tdColab.innerHTML = `<strong>${item.colaborador_nome}</strong><br><small style="color:var(--texto-mutado);">${item.colaborador_matricula}</small>`;
      tr.append(tdColab);

      const tdEpi = document.createElement("td");
      tdEpi.innerHTML = `<strong>${item.epi_nome}</strong>`;
      tr.append(tdEpi);

      const tdEmp = document.createElement("td");
      tdEmp.textContent = formatarData(item.data_emprestimo);
      tr.append(tdEmp);

      const tdPrev = document.createElement("td");
      tdPrev.textContent = item.status === "Fornecido" ? "Sem devolução" : formatarData(item.data_prevista_devolucao);
      tr.append(tdPrev);

      const tdStatus = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `badge-status status-${item.status}`;
      badge.textContent = item.status;
      tdStatus.append(badge);
      tr.append(tdStatus);

      const tdDev = document.createElement("td");
      if (item.status === "Fornecido") {
        tdDev.textContent = "Entrega definitiva";
      } else {
        tdDev.textContent = item.data_devolucao ? formatarData(item.data_devolucao) : "Pendente";
      }
      tr.append(tdDev);

      $("tabela-relatorios-corpo").append(tr);
    }
  } catch (e) {
    exibirAlerta(e.message, true);
  }
}

$("form-relatorio-filtro").addEventListener("submit", (e) => {
  e.preventDefault();
  buscarRelatorios();
});

// ========================================================
// 5. GESTÃO DE USUÁRIOS
// ========================================================
async function carregarUsuarios() {
  $("tabela-usuarios-corpo").replaceChildren();

  try {
    const lista = await requisicao("/api/usuarios");
    for (const u of lista) {
      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.innerHTML = `<strong>${u.nome}</strong>`;
      tr.append(tdNome);

      const tdLogin = document.createElement("td");
      tdLogin.innerHTML = `<span style="font-family: monospace; font-size: 13px; font-weight: 600;">@${u.usuario || "sem-login"}</span>`;
      tr.append(tdLogin);

      const tdPerfil = document.createElement("td");
      const tagPerfil = document.createElement("span");
      tagPerfil.className = `tag-perfil ${u.perfil === "Administrador" ? "tag-admin" : ""}`;
      tagPerfil.textContent = u.perfil || "Operador";
      tdPerfil.append(tagPerfil);
      tr.append(tdPerfil);

      const tdStatus = document.createElement("td");
      tdStatus.innerHTML = u.ativo
        ? `<span style="color: var(--sucesso); font-weight: 600;">Ativo</span>`
        : `<span style="color: var(--texto-mutado);">Inativo</span>`;
      tr.append(tdStatus);

      const tdCriado = document.createElement("td");
      tdCriado.style.color = "var(--texto-mutado)";
      tdCriado.textContent = u.criado_em ? u.criado_em.slice(0, 10) : "—";
      tr.append(tdCriado);

      const tdAcao = document.createElement("td");
      tdAcao.style.textAlign = "right";

      const btnEditar = document.createElement("button");
      btnEditar.type = "button";
      btnEditar.textContent = "Editar";
      btnEditar.className = "btn-acao btn-acao-editar";
      btnEditar.addEventListener("click", () => abrirFormUsuario(u));
      tdAcao.append(btnEditar);

      if (u.id !== 1 && u.id !== usuarioAtual?.id) {
        const btnDeletar = document.createElement("button");
        btnDeletar.type = "button";
        btnDeletar.textContent = "Excluir";
        btnDeletar.className = "btn-acao btn-acao-deletar";
        btnDeletar.addEventListener("click", () => {
          abrirConfirmacao(
            "Excluir Usuário",
            `Deseja realmente remover o usuário "${u.nome}" (@${u.usuario})?`,
            async () => {
              try {
                const res = await requisicao(`/api/usuarios/${u.id}`, { method: "DELETE" });
                exibirAlerta(res.mensagem);
                carregarUsuarios();
              } catch (e) {
                exibirAlerta(e.message, true);
              }
            }
          );
        });
        tdAcao.append(btnDeletar);
      }

      tr.append(tdAcao);
      $("tabela-usuarios-corpo").append(tr);
    }
  } catch (e) {
    exibirAlerta(e.message, true);
  }
}

function mostrarListaUsuarios() {
  $("usuarios-form-card").hidden = true;
  $("usuarios-lista").hidden = false;
  carregarUsuarios();
}

function abrirFormUsuario(u = null) {
  editandoUsuarioId = u?.id ?? null;
  $("form-usuario").reset();
  $("titulo-form-usuario").textContent = editandoUsuarioId ? "Editar Usuário" : "Cadastrar Usuário";

  if (editandoUsuarioId) {
    $("user-nome").value = u.nome;
    $("user-login").value = u.usuario || "";
    $("user-perfil").value = u.perfil || "Operador";
    $("user-ativo").checked = Boolean(u.ativo);
    $("user-senha").required = false;
    $("label-user-senha").innerHTML = 'Nova Senha de Acesso <small style="font-weight: 400; color: var(--texto-mutado);">(opcional)</small>';
    $("ajuda-user-senha").hidden = false;
    const ehProprioOuRaiz = u.id === 1 || u.id === usuarioAtual?.id;
    $("box-user-ativo").hidden = ehProprioOuRaiz;
    $("user-perfil").disabled = ehProprioOuRaiz;
  } else {
    $("user-senha").required = true;
    $("label-user-senha").innerHTML = 'Senha de Acesso <span class="obrigatorio">*</span>';
    $("ajuda-user-senha").hidden = true;
    $("box-user-ativo").hidden = false;
    $("user-perfil").disabled = false;
    $("user-ativo").checked = true;
  }

  fecharAlerta();
  $("usuarios-lista").hidden = true;
  $("usuarios-form-card").hidden = false;
  $("user-nome").focus();
}

$("btn-criar-usuario").addEventListener("click", () => abrirFormUsuario());
$("voltar-usuario").addEventListener("click", mostrarListaUsuarios);

$("form-usuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) return;

  const dados = {
    nome: $("user-nome").value.trim(),
    usuario: $("user-login").value.trim().toLowerCase(),
    perfil: $("user-perfil").value,
    ativo: $("user-ativo").checked ? 1 : 0,
  };

  const senha = $("user-senha").value;
  if (senha) dados.senha = senha;

  ocupado = true;
  $("salvar-usuario").disabled = true;

  try {
    const url = editandoUsuarioId ? `/api/usuarios/${editandoUsuarioId}` : "/api/usuarios";
    const res = await requisicao(url, {
      method: editandoUsuarioId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    exibirAlerta(res.mensagem || "Usuário salvo com sucesso!");
    mostrarListaUsuarios();
  } catch (erro) {
    exibirAlerta(erro.message, true);
  } finally {
    ocupado = false;
    $("salvar-usuario").disabled = false;
  }
});

// Inicialização
verificarAutenticacao();
