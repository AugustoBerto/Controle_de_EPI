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
  return { status: resposta.status, dados: await resposta.json() };
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
