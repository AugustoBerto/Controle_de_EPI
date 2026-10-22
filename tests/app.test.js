import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { criarAplicacao } from '../app.js';

let pasta, banco, app, servidor, url;

async function iniciar() {
  app = criarAplicacao(banco);
  servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  url = `http://127.0.0.1:${servidor.address().port}`;
}

async function parar() {
  await new Promise((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
  app.locals.db.close();
}

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'controle-epi-'));
  banco = join(pasta, 'teste.db');
  await iniciar();
});

afterEach(async () => {
  await parar();
  rmSync(pasta, { recursive: true, force: true });
});

async function pedir(metodo = 'GET', rota = '/api/colaboradores', dados, headers = {}) {
  const resposta = await fetch(url + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: dados === undefined ? undefined : JSON.stringify(dados),
  });
  return { status: resposta.status, headers: resposta.headers, dados: await resposta.json().catch(() => ({})) };
}

async function cadastrar(nome = 'José Augusto', matricula = '001', setor = 'Produção') {
  const resposta = await pedir('POST', '/api/colaboradores', { nome, matricula, setor });
  assert.equal(resposta.status, 201);
  return resposta.dados.id;
}

test('cadastrar, listar, pesquisar, editar e excluir', async () => {
  const id = await cadastrar();
  await cadastrar('Ana Silva', '002');
  let resposta = await pedir('GET', '/api/colaboradores?nome=JOS%C3%89');
  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.dados.map((c) => c.id), [id]);
  const rota = `/api/colaboradores/${id}`;
  assert.equal((await pedir('GET', rota)).dados.setor, 'Produção');
  resposta = await pedir('PUT', rota, { nome: 'José Augusto', matricula: '001', setor: 'Estoque' });
  assert.equal(resposta.status, 200);
  assert.equal((await pedir('GET', rota)).dados.setor, 'Estoque');
  assert.equal((await pedir('DELETE', rota)).status, 200);
  assert.deepEqual((await pedir()).dados.map((c) => c.nome), ['Ana Silva']);
});

test('manter os registros após reiniciar a aplicação', async () => {
  const id = await cadastrar();
  await parar();
  await iniciar();
  const resposta = await pedir();
  assert.equal(resposta.status, 200);
  assert.equal(resposta.dados[0].id, id);
});

test('recusar campos vazios, valores inválidos e matrícula repetida', async () => {
  const id = await cadastrar();
  for (const dados of [[], {}, { nome: ' ', matricula: '002', setor: 'Produção' },
    { nome: 'A'.repeat(101), matricula: '002', setor: 'Produção' },
    { nome: 'Ana', matricula: 2, setor: 'Produção' }]) {
    assert.equal((await pedir('POST', '/api/colaboradores', dados)).status, 400);
  }
  const repetido = { nome: 'Outra pessoa', matricula: '001', setor: 'Estoque' };
  assert.equal((await pedir('POST', '/api/colaboradores', repetido)).status, 409);
  const outro = await cadastrar('Ana', '002');
  assert.equal((await pedir('PUT', `/api/colaboradores/${outro}`, repetido)).status, 409);
  assert.equal((await pedir('GET', `/api/colaboradores/${outro}`)).dados.matricula, '002');
  assert.equal((await pedir('PUT', `/api/colaboradores/${id}`, { nome: 'José', matricula: '001', setor: 'Estoque' })).status, 200);
});

test('buscar texto literal sem executar instruções SQL', async () => {
  const nome = "<script>alert('teste')</script> 100%";
  await cadastrar(nome);
  await cadastrar('Ana', '002');
  const resposta = await pedir('GET', '/api/colaboradores?nome=%25');
  assert.equal(resposta.dados.length, 1);
  assert.equal(resposta.dados[0].nome, nome);
  assert.deepEqual((await pedir('GET', '/api/colaboradores?nome=%27%20OR%201%3D1--')).dados, []);
});

test('impedir exclusão de colaborador com histórico de empréstimos', async () => {
  const id = await cadastrar();
  const db = app.locals.db;
  db.exec("INSERT INTO epis (nome, quantidade_disponivel) VALUES ('Luva', 10)");
  db.exec("INSERT INTO usuarios (nome, email, senha_protegida) VALUES ('Responsável', 'teste@example.com', 'valor-ficticio-para-teste')");
  db.prepare('INSERT INTO emprestimos (colaborador_id, epi_id, usuario_id, quantidade, data_emprestimo) VALUES (?, 1, 1, 1, ?)').run(id, '2026-10-09');
  const resposta = await pedir('DELETE', `/api/colaboradores/${id}`);
  assert.equal(resposta.status, 409);
  assert.match(resposta.dados.erro, /empréstimos/);
  assert.equal((await pedir()).dados.length, 1);
});

test('recusar registro inexistente e alterações iniciadas por outro site', async () => {
  for (const id of ['999', '-1', 'abc', '999999999999999999999999']) {
    assert.equal((await pedir('DELETE', `/api/colaboradores/${id}`)).status, 404);
  }
  const dados = { nome: 'Ana', matricula: '001', setor: 'Produção' };
  assert.equal((await pedir('POST', '/api/colaboradores', dados, { Origin: 'https://outro-site.example' })).status, 403);
  assert.deepEqual((await pedir()).dados, []);
});

test('servir a interface sem expor o arquivo do banco', async () => {
  for (const rota of ['/', '/style.css', '/app.js']) {
    const resposta = await fetch(url + rota);
    assert.equal(resposta.status, 200);
    assert.ok((await resposta.text()).length > 0);
  }
  assert.equal((await pedir('GET', '/dados/controle_epi.db')).status, 404);
});

test('tratar JSON inválido e dados acima do limite', async () => {
  let resposta = await fetch(url + '/api/colaboradores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalido',
  });
  assert.equal(resposta.status, 400);
  resposta = await pedir('POST', '/api/colaboradores', { nome: 'A'.repeat(9000) });
  assert.equal(resposta.status, 413);
  assert.deepEqual((await pedir()).dados, []);
});

test('cadastrar, listar, editar e excluir EPIs', async () => {
  const resCriacao = await pedir('POST', '/api/epis', {
    nome: 'Capacete de Segurança com Jugular',
    descricao: 'Classe B com isolamento elétrico',
    quantidade_disponivel: 15
  });
  assert.equal(resCriacao.status, 201);
  const epiId = resCriacao.dados.id;

  let resLista = await pedir('GET', '/api/epis');
  assert.equal(resLista.status, 200);
  assert.equal(resLista.dados.length, 1);
  assert.equal(resLista.dados[0].nome, 'Capacete de Segurança com Jugular');

  const resEpi = await pedir('GET', `/api/epis/${epiId}`);
  assert.equal(resEpi.status, 200);
  assert.equal(resEpi.dados.quantidade_disponivel, 15);

  const resEdicao = await pedir('PUT', `/api/epis/${epiId}`, {
    nome: 'Capacete de Segurança',
    descricao: 'Classe B Atualizado',
    quantidade_disponivel: 20
  });
  assert.equal(resEdicao.status, 200);

  const resEpiAtualizado = await pedir('GET', `/api/epis/${epiId}`);
  assert.equal(resEpiAtualizado.dados.nome, 'Capacete de Segurança');
  assert.equal(resEpiAtualizado.dados.quantidade_disponivel, 20);

  const resExclusao = await pedir('DELETE', `/api/epis/${epiId}`);
  assert.equal(resExclusao.status, 200);

  resLista = await pedir('GET', '/api/epis');
  assert.equal(resLista.dados.length, 0);
});

test('controle de empréstimo: cadastrar, validar datas e atualizar status', async () => {
  const colabId = await cadastrar('Carlos Pereira', '003', 'Obras');
  const resEpi = await pedir('POST', '/api/epis', {
    nome: 'Óculos de Proteção',
    quantidade_disponivel: 5
  });
  const epiId = resEpi.dados.id;

  // Tentar cadastrar com data prevista menor ou igual à data de empréstimo
  const resDataInvalida = await pedir('POST', '/api/emprestimos', {
    colaborador_id: colabId,
    epi_id: epiId,
    data_emprestimo: '2026-10-25',
    data_prevista_devolucao: '2026-10-24',
    status: 'Emprestado'
  });
  assert.equal(resDataInvalida.status, 400);

  // Tentar cadastrar com status proibido na criação (ex: Devolvido)
  const resStatusProibido = await pedir('POST', '/api/emprestimos', {
    colaborador_id: colabId,
    epi_id: epiId,
    data_emprestimo: '2026-10-25',
    data_prevista_devolucao: '2026-10-30',
    status: 'Devolvido'
  });
  assert.equal(resStatusProibido.status, 400);

  // Cadastrar empréstimo válido com condições
  const resCriacao = await pedir('POST', '/api/emprestimos', {
    colaborador_id: colabId,
    epi_id: epiId,
    data_emprestimo: '2026-10-25',
    data_prevista_devolucao: '2026-10-30',
    status: 'Emprestado',
    condicoes_equipamento: 'Em perfeito estado de conservação'
  });
  assert.equal(resCriacao.status, 201);
  const empId = resCriacao.dados.id;

  // Listar empréstimos
  const resLista = await pedir('GET', '/api/emprestimos');
  assert.equal(resLista.status, 200);
  assert.equal(resLista.dados.length, 1);
  assert.equal(resLista.dados[0].colaborador_nome, 'Carlos Pereira');
  assert.equal(resLista.dados[0].epi_nome, 'Óculos de Proteção');
  assert.equal(resLista.dados[0].status, 'Emprestado');
  assert.equal(resLista.dados[0].condicoes_equipamento, 'Em perfeito estado de conservação');

  // Impedir exclusão do EPI enquanto houver empréstimo vinculado
  const resDelEpi = await pedir('DELETE', `/api/epis/${epiId}`);
  assert.equal(resDelEpi.status, 409);

  // Atualizar status para Danificado com observação e data de devolução
  const resAtualizacao = await pedir('PUT', `/api/emprestimos/${empId}`, {
    status: 'Danificado',
    data_devolucao: '2026-10-28',
    observacao_devolucao: 'Lente trincada durante o trabalho',
    condicoes_equipamento: 'Lente avariada'
  });
  assert.equal(resAtualizacao.status, 200);

  // Verificar empréstimo atualizado e imutabilidade dos dados originais
  const resEmpAtualizado = await pedir('GET', `/api/emprestimos/${empId}`);
  assert.equal(resEmpAtualizado.dados.status, 'Danificado');
  assert.equal(resEmpAtualizado.dados.data_devolucao, '2026-10-28');
  assert.equal(resEmpAtualizado.dados.observacao_devolucao, 'Lente trincada durante o trabalho');
  assert.equal(resEmpAtualizado.dados.colaborador_id, colabId);
  assert.equal(resEmpAtualizado.dados.epi_id, epiId);
  assert.equal(resEmpAtualizado.dados.data_emprestimo, '2026-10-25');
  assert.equal(resEmpAtualizado.dados.data_prevista_devolucao, '2026-10-30');
});

test('autenticação real: login com usuário e senha, me e logout', async () => {
  // Login incorreto
  const resIncorreto = await pedir('POST', '/api/auth/login', {
    usuario: 'admin',
    senha: 'senha-errada'
  });
  assert.equal(resIncorreto.status, 401);

  // Login correto com usuário 'admin' e senha 'admin123'
  const resCorreto = await pedir('POST', '/api/auth/login', {
    usuario: 'admin',
    senha: 'admin123'
  });
  assert.equal(resCorreto.status, 200);
  assert.equal(resCorreto.dados.sucesso, true);
  assert.equal(resCorreto.dados.usuario.usuario, 'admin');

  const cookie = resCorreto.headers.get('set-cookie');
  assert.ok(cookie);

  // Consulta do usuário autenticado com cookie de sessão
  const resMe = await pedir('GET', '/api/auth/me', undefined, { Cookie: cookie });
  assert.equal(resMe.status, 200);
  assert.equal(resMe.dados.autenticado, true);
  assert.equal(resMe.dados.usuario.usuario, 'admin');

  // Logout
  const resLogout = await pedir('POST', '/api/auth/logout', {}, { Cookie: cookie });
  assert.equal(resLogout.status, 200);
});

test('gestão de usuários: criar, listar, atualizar e proteger exclusão do admin', async () => {
  // Listar usuários (já contém o admin id 1)
  let resLista = await pedir('GET', '/api/usuarios');
  assert.equal(resLista.status, 200);
  assert.ok(resLista.dados.length >= 1);
  assert.equal(resLista.dados[0].usuario, 'admin');

  // Criar novo usuário operador
  const resCriar = await pedir('POST', '/api/usuarios', {
    nome: 'Carlos Técnico',
    usuario: 'carlos.sst',
    senha: 'senha456',
    perfil: 'Operador'
  });
  assert.equal(resCriar.status, 201);
  const novoId = resCriar.dados.id;

  // Atualizar usuário criado
  const resUpdate = await pedir('PUT', `/api/usuarios/${novoId}`, {
    nome: 'Carlos Eduardo SST',
    usuario: 'carlos.sst',
    perfil: 'Operador'
  });
  assert.equal(resUpdate.status, 200);

  // Testar login com o novo usuário
  const resLoginNovo = await pedir('POST', '/api/auth/login', {
    usuario: 'carlos.sst',
    senha: 'senha456'
  });
  assert.equal(resLoginNovo.status, 200);
  assert.equal(resLoginNovo.dados.usuario.nome, 'Carlos Eduardo SST');

  // Impedir exclusão do admin id 1
  const resDelAdmin = await pedir('DELETE', '/api/usuarios/1');
  assert.equal(resDelAdmin.status, 403);

  // Excluir usuário criado
  const resDel = await pedir('DELETE', `/api/usuarios/${novoId}`);
  assert.equal(resDel.status, 200);
});

test('métricas e relatório de empréstimos com filtro AND', async () => {
  const colabId = await cadastrar('Marcos Souza', '004', 'Construção');
  const resEpi = await pedir('POST', '/api/epis', { nome: 'Protetor Auricular', quantidade_disponivel: 12 });
  const epiId = resEpi.dados.id;

  await pedir('POST', '/api/emprestimos', {
    colaborador_id: colabId,
    epi_id: epiId,
    data_emprestimo: '2026-10-20',
    data_prevista_devolucao: '2026-10-30',
    status: 'Emprestado'
  });

  // Métricas
  const resMetricas = await pedir('GET', '/api/metricas');
  assert.equal(resMetricas.status, 200);
  assert.ok(typeof resMetricas.dados.disponivel === 'number');
  assert.equal(resMetricas.dados.emprestado, 1);

  // Relatório com filtro AND positivo
  const resFiltro = await pedir('GET', `/api/relatorios/emprestimos?colaborador=Marcos&equipamento=Protetor&status=Emprestado`);
  assert.equal(resFiltro.status, 200);
  assert.equal(resFiltro.dados.length, 1);
  assert.equal(resFiltro.dados[0].colaborador_nome, 'Marcos Souza');

  // Relatório com filtro AND negativo
  const resFiltroVazio = await pedir('GET', `/api/relatorios/emprestimos?colaborador=Marcos&equipamento=Protetor&status=Devolvido`);
  assert.equal(resFiltroVazio.status, 200);
  assert.equal(resFiltroVazio.dados.length, 0);
});

test('validações de integridade em EPIs e Empréstimos', async () => {
  // EPI com nome vazio ou quantidade inválida
  assert.equal((await pedir('POST', '/api/epis', { nome: '', quantidade_disponivel: 10 })).status, 400);
  assert.equal((await pedir('POST', '/api/epis', { nome: 'Luva', quantidade_disponivel: -1 })).status, 400);

  // Empréstimo com colaborador ou EPI inexistente
  const resColabInvalido = await pedir('POST', '/api/emprestimos', {
    colaborador_id: 9999,
    epi_id: 1,
    data_emprestimo: '2026-10-25',
    data_prevista_devolucao: '2026-10-30',
  });
  assert.equal(resColabInvalido.status, 404);

  const colabId = await cadastrar('Lucas Silva', '009', 'Manutenção');
  const resEpiInvalido = await pedir('POST', '/api/emprestimos', {
    colaborador_id: colabId,
    epi_id: 9999,
    data_emprestimo: '2026-10-25',
    data_prevista_devolucao: '2026-10-30',
  });
  assert.equal(resEpiInvalido.status, 404);
});
