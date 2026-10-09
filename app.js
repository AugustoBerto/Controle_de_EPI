import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));

export function criarAplicacao(banco = join(raiz, 'dados', 'controle_epi.db')) {
  if (banco !== ':memory:') mkdirSync(dirname(banco), { recursive: true });
  const db = new DatabaseSync(banco);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(raiz, 'schema.sql'), 'utf8'));
  db.function('normalizar', { deterministic: true }, (nome) => nome.toLocaleLowerCase('pt-BR'));

  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const origem = req.get('Origin');
      if (origem && origem !== `http://${req.get('Host')}`) {
        return res.status(403).json({ erro: 'Origem da solicitação não permitida.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/colaboradores', (req, res) => {
    const nome = typeof req.query.nome === 'string' ? req.query.nome.trim() : '';
    const dados = db.prepare(
      'SELECT id, nome, matricula, setor FROM colaboradores ' +
      'WHERE instr(normalizar(nome), normalizar(?)) > 0 ORDER BY normalizar(nome), id'
    ).all(nome);
    res.json(dados);
  });

  app.param('id', (req, res, next, valor) => {
    const id = Number(valor);
    if (!/^\d+$/.test(valor) || !Number.isSafeInteger(id) || id < 1) {
      return res.status(404).json({ erro: 'Colaborador não encontrado.' });
    }
    const colaborador = db.prepare('SELECT id, nome, matricula, setor FROM colaboradores WHERE id = ?').get(id);
    if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
    req.colaborador = colaborador;
    next();
  });

  app.get('/api/colaboradores/:id', (req, res) => res.json(req.colaborador));

  function validar(req, res, next) {
    if (!req.is('application/json')) {
      return res.status(400).json({ erro: 'Envie os dados em formato JSON.' });
    }
    const dados = req.body;
    if (!dados || Array.isArray(dados) || typeof dados !== 'object') {
      return res.status(400).json({ erro: 'Preencha nome, matrícula e setor.' });
    }
    req.dados = {};
    for (const [campo, rotulo, limite] of [['nome', 'Nome', 100], ['matricula', 'Matrícula', 30], ['setor', 'Setor', 80]]) {
      const valor = dados[campo];
      if (typeof valor !== 'string' || !valor.trim()) {
        return res.status(400).json({ erro: 'Preencha nome, matrícula e setor.' });
      }
      if (valor.trim().length > limite) {
        return res.status(400).json({ erro: `${rotulo} deve ter até ${limite} caracteres.` });
      }
      req.dados[campo] = valor.trim();
    }
    const repetido = db.prepare('SELECT id FROM colaboradores WHERE matricula = ? AND id != ?')
      .get(req.dados.matricula, req.colaborador?.id ?? 0);
    if (repetido) return res.status(409).json({ erro: 'Esta matrícula já está cadastrada.' });
    next();
  }

  app.post('/api/colaboradores', validar, (req, res) => {
    const { nome, matricula, setor } = req.dados;
    const resultado = db.prepare('INSERT INTO colaboradores (nome, matricula, setor) VALUES (?, ?, ?)')
      .run(nome, matricula, setor);
    res.status(201).json({ id: Number(resultado.lastInsertRowid), mensagem: 'Colaborador cadastrado com sucesso!' });
  });

  app.put('/api/colaboradores/:id', validar, (req, res) => {
    const { nome, matricula, setor } = req.dados;
    db.prepare('UPDATE colaboradores SET nome = ?, matricula = ?, setor = ? WHERE id = ?')
      .run(nome, matricula, setor, req.colaborador.id);
    res.json({ mensagem: 'Colaborador atualizado com sucesso!' });
  });

  app.delete('/api/colaboradores/:id', (req, res) => {
    const historico = db.prepare('SELECT id FROM emprestimos WHERE colaborador_id = ? LIMIT 1').get(req.colaborador.id);
    if (historico) {
      return res.status(409).json({ erro: 'Este colaborador possui empréstimos registrados e não pode ser excluído.' });
    }
    db.prepare('DELETE FROM colaboradores WHERE id = ?').run(req.colaborador.id);
    res.json({ mensagem: 'Colaborador excluído com sucesso!' });
  });

  app.use(express.static(join(raiz, 'public')));
  app.use((req, res) => res.status(404).json({ erro: 'Página não encontrada.' }));
  app.use((erro, req, res, next) => {
    if (erro.type === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'Os dados enviados são inválidos.' });
    }
    if (erro.type === 'entity.too.large') {
      return res.status(413).json({ erro: 'Os dados enviados são muito grandes.' });
    }
    res.status(500).json({ erro: 'Não foi possível concluir a operação. Tente novamente.' });
  });
  return app;
}
