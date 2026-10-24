import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const raiz = dirname(fileURLToPath(import.meta.url));

function hashSenha(senha) {
  return createHash('sha256').update(String(senha) + ':salt-controle-epi').digest('hex');
}

function extrairCookies(req) {
  const lista = {};
  const header = req.headers.cookie;
  if (!header) return lista;
  for (const item of header.split(';')) {
    const [chave, ...rest] = item.split('=');
    if (chave) lista[chave.trim()] = decodeURIComponent(rest.join('=').trim());
  }
  return lista;
}

export function criarAplicacao(banco = join(raiz, 'dados', 'controle_epi.db')) {
  if (banco !== ':memory:') mkdirSync(dirname(banco), { recursive: true });
  const db = new DatabaseSync(banco);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(raiz, 'schema.sql'), 'utf8'));
  db.function('normalizar', { deterministic: true }, (nome) => String(nome ?? '').toLocaleLowerCase('pt-BR'));

  // Migrações e compatibilidade de colunas
  const colunasEmprestimos = db.prepare("PRAGMA table_info(emprestimos)").all().map((c) => c.name);
  if (colunasEmprestimos.length > 0) {
    if (!colunasEmprestimos.includes('data_prevista_devolucao')) {
      db.exec("ALTER TABLE emprestimos ADD COLUMN data_prevista_devolucao TEXT NOT NULL DEFAULT ''");
    }
    if (!colunasEmprestimos.includes('status')) {
      db.exec("ALTER TABLE emprestimos ADD COLUMN status TEXT NOT NULL DEFAULT 'Emprestado'");
    }
    if (!colunasEmprestimos.includes('condicoes_equipamento')) {
      db.exec("ALTER TABLE emprestimos ADD COLUMN condicoes_equipamento TEXT NOT NULL DEFAULT ''");
    }
    if (!colunasEmprestimos.includes('observacao_devolucao')) {
      db.exec("ALTER TABLE emprestimos ADD COLUMN observacao_devolucao TEXT NOT NULL DEFAULT ''");
    }
  }

  const colunasUsuarios = db.prepare("PRAGMA table_info(usuarios)").all().map((c) => c.name);
  if (colunasUsuarios.length > 0) {
    if (!colunasUsuarios.includes('usuario')) {
      db.exec("ALTER TABLE usuarios ADD COLUMN usuario TEXT UNIQUE");
    }
    if (!colunasUsuarios.includes('perfil')) {
      db.exec("ALTER TABLE usuarios ADD COLUMN perfil TEXT NOT NULL DEFAULT 'Administrador'");
    }
    if (!colunasUsuarios.includes('criado_em')) {
      db.exec("ALTER TABLE usuarios ADD COLUMN criado_em TEXT NOT NULL DEFAULT (datetime('now'))");
    }
    db.exec(`
      INSERT OR IGNORE INTO usuarios (id, nome, usuario, email, senha_protegida, perfil, ativo)
      VALUES (1, 'Administrador Geral', 'admin', 'admin@empresa.com', '0a7b48d4cece1632cf7ee11dc1a59944cad885082868ac2a09795de2e4e6d517', 'Administrador', 1)
    `);
    db.exec("UPDATE usuarios SET usuario = 'admin' WHERE id = 1 AND (usuario IS NULL OR usuario = '')");
  }

  // Sessões em memória
  const sessoes = new Map();

  function encerrarSessoesDoUsuario(userId) {
    for (const [sid, s] of sessoes.entries()) {
      if (s.usuario.id === userId) sessoes.delete(sid);
    }
  }

  const app = express();
  app.locals.db = db;
  app.locals.sessoes = sessoes;
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; img-src 'self' data:");
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const origem = req.get('Origin');
      if (origem && origem !== `http://${req.get('Host')}`) {
        return res.status(403).json({ erro: 'Origem da solicitação não permitida.' });
      }
    }
    next();
  });

  app.use(express.json({ limit: '8kb' }));

  // Middleware para identificar e validar usuário logado via cookie
  app.use((req, res, next) => {
    const cookies = extrairCookies(req);
    const sessionId = cookies.session_id;
    if (sessionId && sessoes.has(sessionId)) {
      const sessao = sessoes.get(sessionId);
      if (sessao.expiraEm > Date.now()) {
        const usuarioDb = db.prepare('SELECT id, nome, usuario, email, perfil, ativo FROM usuarios WHERE id = ?').get(sessao.usuario.id);
        if (usuarioDb && usuarioDb.ativo) {
          const dadosAtualizados = {
            id: usuarioDb.id,
            nome: usuarioDb.nome,
            usuario: usuarioDb.usuario || usuarioDb.email,
            perfil: usuarioDb.perfil,
          };
          sessao.usuario = dadosAtualizados;
          req.usuarioLogado = dadosAtualizados;
        } else {
          sessoes.delete(sessionId);
          req.sessaoInvalida = true;
        }
      } else {
        sessoes.delete(sessionId);
        req.sessaoInvalida = true;
      }
    } else if (sessionId) {
      req.sessaoInvalida = true;
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.sessaoInvalida && !req.path.startsWith('/auth/')) {
      res.setHeader('Set-Cookie', 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
      return res.status(401).json({ erro: 'Sua sessão foi encerrada. Faça login novamente.' });
    }
    next();
  });

  function validarId(valor) {
    const id = Number(valor);
    if (!/^\d+$/.test(valor) || !Number.isSafeInteger(id) || id < 1) return null;
    return id;
  }

  // ==========================================
  // AUTENTICAÇÃO REAL (USUÁRIO E SENHA)
  // ==========================================
  app.post('/api/auth/login', (req, res) => {
    const login = req.body?.usuario || req.body?.email;
    const senha = req.body?.senha;

    if (!login || !senha) {
      return res.status(400).json({ erro: 'Informe o usuário e a senha.' });
    }

    const hash = hashSenha(senha);
    const termo = String(login).trim().toLowerCase();

    const usuario = db.prepare(`
      SELECT id, nome, usuario, email, perfil, ativo 
      FROM usuarios 
      WHERE (lower(usuario) = ? OR lower(email) = ?) AND senha_protegida = ?
    `).get(termo, termo, hash);

    if (!usuario) {
      return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    }

    if (!usuario.ativo) {
      return res.status(403).json({ erro: 'Este usuário está desativado no sistema.' });
    }

    const sessionId = randomUUID();
    const dadosUsuario = {
      id: usuario.id,
      nome: usuario.nome,
      usuario: usuario.usuario || usuario.email,
      perfil: usuario.perfil,
    };

    sessoes.set(sessionId, {
      usuario: dadosUsuario,
      expiraEm: Date.now() + 24 * 3600 * 1000,
    });

    res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({
      sucesso: true,
      mensagem: `Bem-vindo, ${usuario.nome}!`,
      usuario: dadosUsuario,
    });
  });

  app.get('/api/auth/me', (req, res) => {
    if (req.usuarioLogado) {
      return res.json({ autenticado: true, usuario: req.usuarioLogado });
    }
    if (req.sessaoInvalida) {
      res.setHeader('Set-Cookie', 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
    }
    return res.status(401).json({ autenticado: false, erro: 'Sessão não autenticada.' });
  });

  app.post('/api/auth/logout', (req, res) => {
    const cookies = extrairCookies(req);
    const sessionId = cookies.session_id;
    if (sessionId) sessoes.delete(sessionId);
    res.setHeader('Set-Cookie', 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
    res.json({ sucesso: true, mensagem: 'Sessão encerrada com sucesso.' });
  });

  // ==========================================
  // GESTÃO DE USUÁRIOS DO SISTEMA (APENAS ADMIN)
  // ==========================================
  app.use('/api/usuarios', (req, res, next) => {
    if (req.usuarioLogado && req.usuarioLogado.perfil !== 'Administrador') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }
    next();
  });

  app.get('/api/usuarios', (req, res) => {
    const usuarios = db.prepare(`
      SELECT id, nome, usuario, perfil, ativo, criado_em 
      FROM usuarios 
      ORDER BY id ASC
    `).all();
    res.json(usuarios);
  });

  app.get('/api/usuarios/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const usuario = db.prepare('SELECT id, nome, usuario, perfil, ativo, criado_em FROM usuarios WHERE id = ?').get(id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json(usuario);
  });

  app.post('/api/usuarios', (req, res) => {
    if (!req.is('application/json')) {
      return res.status(400).json({ erro: 'Envie os dados em formato JSON.' });
    }
    const dados = req.body || {};
    const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
    const usuario = typeof dados.usuario === 'string' ? dados.usuario.trim().toLowerCase() : '';
    const senha = typeof dados.senha === 'string' ? dados.senha : '';
    const perfil = dados.perfil === 'Operador' ? 'Operador' : 'Administrador';

    if (!nome) return res.status(400).json({ erro: 'Informe o nome completo do usuário.' });
    if (!usuario || usuario.length < 3 || usuario.length > 50) {
      return res.status(400).json({ erro: 'O nome de usuário deve ter entre 3 e 50 caracteres.' });
    }
    if (!/^[a-z0-9._-]+$/i.test(usuario)) {
      return res.status(400).json({ erro: 'O nome de usuário deve conter apenas letras, números, ponto ou traço.' });
    }
    if (!senha || senha.length < 4) {
      return res.status(400).json({ erro: 'A senha deve ter pelo menos 4 caracteres.' });
    }

    const jaExiste = db.prepare('SELECT id FROM usuarios WHERE lower(usuario) = ?').get(usuario);
    if (jaExiste) {
      return res.status(409).json({ erro: 'Este nome de usuário já está em uso.' });
    }

    const hash = hashSenha(senha);
    const resultado = db.prepare(`
      INSERT INTO usuarios (nome, usuario, senha_protegida, perfil, ativo)
      VALUES (?, ?, ?, ?, 1)
    `).run(nome, usuario, hash, perfil);

    res.status(201).json({ id: Number(resultado.lastInsertRowid), mensagem: 'Usuário criado com sucesso!' });
  });

  app.put('/api/usuarios/:id', (req, res) => {
    if (!req.is('application/json')) {
      return res.status(400).json({ erro: 'Envie os dados em formato JSON.' });
    }
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const usuarioAtual = db.prepare('SELECT id, senha_protegida FROM usuarios WHERE id = ?').get(id);
    if (!usuarioAtual) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const dados = req.body || {};
    const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
    const usuario = typeof dados.usuario === 'string' ? dados.usuario.trim().toLowerCase() : '';
    const perfil = dados.perfil === 'Operador' ? 'Operador' : 'Administrador';
    const ativo = dados.ativo === false || dados.ativo === 0 ? 0 : 1;

    if (!nome) return res.status(400).json({ erro: 'Informe o nome completo do usuário.' });
    if (!usuario || usuario.length < 3 || usuario.length > 50) {
      return res.status(400).json({ erro: 'O nome de usuário deve ter entre 3 e 50 caracteres.' });
    }

    const repetido = db.prepare('SELECT id FROM usuarios WHERE lower(usuario) = ? AND id != ?').get(usuario, id);
    if (repetido) {
      return res.status(409).json({ erro: 'Este nome de usuário já está em uso por outra conta.' });
    }

    let hash = usuarioAtual.senha_protegida;
    if (typeof dados.senha === 'string' && dados.senha.trim().length >= 4) {
      hash = hashSenha(dados.senha.trim());
    }

    // Protege contra autodesativação ou autorremoção de perfil admin
    if (req.usuarioLogado && req.usuarioLogado.id === id) {
      if (ativo === 0) {
        return res.status(403).json({ erro: 'Você não pode desativar sua própria conta.' });
      }
      if (perfil !== 'Administrador') {
        return res.status(403).json({ erro: 'Você não pode remover seu próprio perfil de administrador.' });
      }
    }

    const ativoFinal = id === 1 ? 1 : ativo;
    const perfilFinal = id === 1 ? 'Administrador' : perfil;

    db.prepare(`
      UPDATE usuarios 
      SET nome = ?, usuario = ?, senha_protegida = ?, perfil = ?, ativo = ?
      WHERE id = ?
    `).run(nome, usuario, hash, perfilFinal, ativoFinal, id);

    if (ativoFinal === 0) {
      encerrarSessoesDoUsuario(id);
    }

    res.json({ mensagem: 'Usuário atualizado com sucesso!' });
  });

  app.delete('/api/usuarios/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    if (id === 1) {
      return res.status(403).json({ erro: 'O administrador principal (admin) não pode ser excluído.' });
    }

    if (req.usuarioLogado && req.usuarioLogado.id === id) {
      return res.status(403).json({ erro: 'Você não pode excluir sua própria conta.' });
    }

    const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const temHistorico = db.prepare('SELECT id FROM emprestimos WHERE usuario_id = ? LIMIT 1').get(id);
    if (temHistorico) {
      return res.status(409).json({ erro: 'Este usuário possui registros de empréstimos associados e não pode ser excluído.' });
    }

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    encerrarSessoesDoUsuario(id);
    res.json({ mensagem: 'Usuário excluído com sucesso!' });
  });

  // ==========================================
  // INDICADORES / MÉTRICAS
  // ==========================================
  app.get('/api/metricas', (req, res) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const disponivel = db.prepare('SELECT coalesce(sum(quantidade_disponivel), 0) AS total FROM epis').get().total;
    const emprestado = db.prepare("SELECT count(*) AS total FROM emprestimos WHERE status = 'Emprestado'").get().total;
    const vencido = db.prepare("SELECT count(*) AS total FROM emprestimos WHERE status = 'Emprestado' AND data_prevista_devolucao < ?").get(hoje).total;
    const totalColaboradores = db.prepare('SELECT count(*) AS total FROM colaboradores').get().total;

    res.json({
      disponivel: Number(disponivel),
      emprestado: Number(emprestado),
      vencido: Number(vencido),
      colaboradores: Number(totalColaboradores),
    });
  });

  // ==========================================
  // COLABORADORES
  // ==========================================
  app.get('/api/colaboradores', (req, res) => {
    const nome = typeof req.query.nome === 'string' ? req.query.nome.trim() : '';
    const dados = db.prepare(
      'SELECT id, nome, matricula, setor FROM colaboradores ' +
      'WHERE instr(normalizar(nome), normalizar(?)) > 0 ORDER BY normalizar(nome), id'
    ).all(nome);
    res.json(dados);
  });

  app.get('/api/colaboradores/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
    const colaborador = db.prepare('SELECT id, nome, matricula, setor FROM colaboradores WHERE id = ?').get(id);
    if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
    res.json(colaborador);
  });

  function validarColaborador(req, res, next) {
    if (!req.is('application/json')) {
      return res.status(400).json({ erro: 'Envie os dados em formato JSON.' });
    }
    const dados = req.body;
    if (!dados || Array.isArray(dados) || typeof dados !== 'object') {
      return res.status(400).json({ erro: 'Preencha nome, matrícula e setor.' });
    }
    req.dados = {};
    for (const [campo, rotulo, limite] of [['nome', 'Nome', 100], ['matricula', 'Matrícula', 10], ['setor', 'Setor', 80]]) {
      const valor = dados[campo];
      if (typeof valor !== 'string' || !valor.trim()) {
        return res.status(400).json({ erro: 'Preencha nome, matrícula e setor.' });
      }
      if (valor.trim().length > limite) {
        return res.status(400).json({ erro: `${rotulo} deve ter até ${limite} caracteres.` });
      }
      req.dados[campo] = valor.trim();
    }
    if (!/^\d{1,10}$/.test(req.dados.matricula)) {
      return res.status(400).json({ erro: 'A matrícula deve conter apenas números (até 10 dígitos).' });
    }
    const idAtual = req.params.id ? Number(req.params.id) : 0;
    const repetido = db.prepare('SELECT id FROM colaboradores WHERE matricula = ? AND id != ?')
      .get(req.dados.matricula, idAtual);
    if (repetido) return res.status(409).json({ erro: 'Esta matrícula já está cadastrada.' });
    next();
  }

  app.post('/api/colaboradores', validarColaborador, (req, res) => {
    const { nome, matricula, setor } = req.dados;
    const resultado = db.prepare('INSERT INTO colaboradores (nome, matricula, setor) VALUES (?, ?, ?)')
      .run(nome, matricula, setor);
    res.status(201).json({ id: Number(resultado.lastInsertRowid), mensagem: 'Colaborador cadastrado com sucesso!' });
  });

  app.put('/api/colaboradores/:id', (req, res, next) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
    const colaborador = db.prepare('SELECT id FROM colaboradores WHERE id = ?').get(id);
    if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
    next();
  }, validarColaborador, (req, res) => {
    const id = Number(req.params.id);
    const { nome, matricula, setor } = req.dados;
    db.prepare('UPDATE colaboradores SET nome = ?, matricula = ?, setor = ? WHERE id = ?')
      .run(nome, matricula, setor, id);
    res.json({ mensagem: 'Colaborador atualizado com sucesso!' });
  });

  app.delete('/api/colaboradores/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
    const colaborador = db.prepare('SELECT id FROM colaboradores WHERE id = ?').get(id);
    if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado.' });

    const historico = db.prepare('SELECT id FROM emprestimos WHERE colaborador_id = ? LIMIT 1').get(id);
    if (historico) {
      return res.status(409).json({ erro: 'Este colaborador possui empréstimos registrados e não pode ser excluído.' });
    }
    db.prepare('DELETE FROM colaboradores WHERE id = ?').run(id);
    res.json({ mensagem: 'Colaborador excluído com sucesso!' });
  });

  // ==========================================
  // EQUIPAMENTOS (EPIS)
  // ==========================================
  app.get('/api/epis', (req, res) => {
    const nome = typeof req.query.nome === 'string' ? req.query.nome.trim() : '';
    const epis = db.prepare(
      'SELECT id, nome, descricao, quantidade_disponivel FROM epis ' +
      'WHERE instr(normalizar(nome), normalizar(?)) > 0 ORDER BY normalizar(nome), id'
    ).all(nome);
    res.json(epis);
  });

  app.get('/api/epis/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
    const epi = db.prepare('SELECT id, nome, descricao, quantidade_disponivel FROM epis WHERE id = ?').get(id);
    if (!epi) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
    res.json(epi);
  });

  function validarEpi(req, res, next) {
    if (!req.is('application/json')) {
      return res.status(400).json({ erro: 'Envie os dados em formato JSON.' });
    }
    const dados = req.body;
    if (!dados || Array.isArray(dados) || typeof dados !== 'object') {
      return res.status(400).json({ erro: 'Preencha o nome do equipamento e a quantidade disponível.' });
    }
    const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
    if (!nome) {
      return res.status(400).json({ erro: 'Informe o nome do equipamento.' });
    }
    if (nome.length > 100) {
      return res.status(400).json({ erro: 'Nome do equipamento deve ter até 100 caracteres.' });
    }

    const descricao = typeof dados.descricao === 'string' ? dados.descricao.trim() : '';
    if (descricao.length > 255) {
      return res.status(400).json({ erro: 'Descrição deve ter até 255 caracteres.' });
    }

    const quantidade = Number(dados.quantidade_disponivel ?? dados.quantidade);
    if (!Number.isInteger(quantidade) || quantidade < 0) {
      return res.status(400).json({ erro: 'A quantidade disponível deve ser um número inteiro igual ou superior a zero.' });
    }

    req.dadosEpi = { nome, descricao, quantidade_disponivel: quantidade };
    next();
  }

  app.post('/api/epis', validarEpi, (req, res) => {
    const { nome, descricao, quantidade_disponivel } = req.dadosEpi;
    const resultado = db.prepare('INSERT INTO epis (nome, descricao, quantidade_disponivel) VALUES (?, ?, ?)')
      .run(nome, descricao, quantidade_disponivel);
    res.status(201).json({ id: Number(resultado.lastInsertRowid), mensagem: 'Equipamento cadastrado com sucesso!' });
  });

  app.put('/api/epis/:id', (req, res, next) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
    const epi = db.prepare('SELECT id FROM epis WHERE id = ?').get(id);
    if (!epi) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
    next();
  }, validarEpi, (req, res) => {
    const id = Number(req.params.id);
    const { nome, descricao, quantidade_disponivel } = req.dadosEpi;
    db.prepare('UPDATE epis SET nome = ?, descricao = ?, quantidade_disponivel = ? WHERE id = ?')
      .run(nome, descricao, quantidade_disponivel, id);
    res.json({ mensagem: 'Equipamento atualizado com sucesso!' });
  });

  app.delete('/api/epis/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
    const epi = db.prepare('SELECT id FROM epis WHERE id = ?').get(id);
    if (!epi) return res.status(404).json({ erro: 'Equipamento não encontrado.' });

    const historico = db.prepare('SELECT id FROM emprestimos WHERE epi_id = ? LIMIT 1').get(id);
    if (historico) {
      return res.status(409).json({ erro: 'Este equipamento possui registros de empréstimos e não pode ser excluído.' });
    }

    db.prepare('DELETE FROM epis WHERE id = ?').run(id);
    res.json({ mensagem: 'Equipamento excluído com sucesso!' });
  });

  // ==========================================
  // CONTROLE DE EPI (EMPRÉSTIMOS)
  // ==========================================
  app.get('/api/emprestimos', (req, res) => {
    const termo = typeof req.query.nome === 'string' ? req.query.nome.trim() : '';
    const emprestimos = db.prepare(`
      SELECT 
        e.id, 
        e.colaborador_id, 
        c.nome AS colaborador_nome,
        c.matricula AS colaborador_matricula,
        e.epi_id, 
        ep.nome AS epi_nome,
        e.quantidade,
        e.data_emprestimo, 
        e.data_prevista_devolucao, 
        e.data_devolucao, 
        e.status, 
        e.condicoes_equipamento,
        e.observacao_devolucao
      FROM emprestimos e
      JOIN colaboradores c ON c.id = e.colaborador_id
      JOIN epis ep ON ep.id = e.epi_id
      WHERE (? = '' OR instr(normalizar(c.nome), normalizar(?)) > 0 OR instr(normalizar(ep.nome), normalizar(?)) > 0)
      ORDER BY e.id DESC
    `).all(termo, termo, termo);
    res.json(emprestimos);
  });

  app.get('/api/relatorios/emprestimos', (req, res) => {
    const colab = typeof req.query.colaborador === 'string' ? req.query.colaborador.trim() : '';
    const epi = typeof req.query.equipamento === 'string' ? req.query.equipamento.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const dados = db.prepare(`
      SELECT 
        e.id, 
        e.colaborador_id, 
        c.nome AS colaborador_nome,
        c.matricula AS colaborador_matricula,
        e.epi_id, 
        ep.nome AS epi_nome,
        e.data_emprestimo, 
        e.data_prevista_devolucao, 
        e.data_devolucao, 
        e.status, 
        e.condicoes_equipamento,
        e.observacao_devolucao
      FROM emprestimos e
      JOIN colaboradores c ON c.id = e.colaborador_id
      JOIN epis ep ON ep.id = e.epi_id
      WHERE (? = '' OR instr(normalizar(c.nome), normalizar(?)) > 0)
        AND (? = '' OR instr(normalizar(ep.nome), normalizar(?)) > 0)
        AND (? = '' OR e.status = ?)
      ORDER BY e.id DESC
    `).all(colab, colab, epi, epi, status, status);

    res.json(dados);
  });

  app.get('/api/emprestimos/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });
    const emprestimo = db.prepare(`
      SELECT 
        e.id, 
        e.colaborador_id, 
        c.nome AS colaborador_nome,
        c.matricula AS colaborador_matricula,
        e.epi_id, 
        ep.nome AS epi_nome,
        e.quantidade,
        e.data_emprestimo, 
        e.data_prevista_devolucao, 
        e.data_devolucao, 
        e.status, 
        e.condicoes_equipamento,
        e.observacao_devolucao
      FROM emprestimos e
      JOIN colaboradores c ON c.id = e.colaborador_id
      JOIN epis ep ON ep.id = e.epi_id
      WHERE e.id = ?
    `).get(id);
    if (!emprestimo) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });
    res.json(emprestimo);
  });

  app.post('/api/emprestimos', (req, res) => {
    if (!req.is('application/json')) {
      return res.status(400).json({ erro: 'Envie os dados em formato JSON.' });
    }
    const dados = req.body;
    if (!dados || typeof dados !== 'object') {
      return res.status(400).json({ erro: 'Preencha os dados do empréstimo.' });
    }

    const colaboradorId = Number(dados.colaborador_id);
    const epiId = Number(dados.epi_id);
    if (!Number.isInteger(colaboradorId) || colaboradorId < 1) {
      return res.status(400).json({ erro: 'Selecione um colaborador válido.' });
    }
    if (!Number.isInteger(epiId) || epiId < 1) {
      return res.status(400).json({ erro: 'Selecione um equipamento válido.' });
    }

    const colab = db.prepare('SELECT id FROM colaboradores WHERE id = ?').get(colaboradorId);
    if (!colab) return res.status(404).json({ erro: 'Colaborador não encontrado.' });

    const epi = db.prepare('SELECT id, quantidade_disponivel FROM epis WHERE id = ?').get(epiId);
    if (!epi) return res.status(404).json({ erro: 'Equipamento não encontrado.' });

    if (epi.quantidade_disponivel < 1) {
      return res.status(400).json({ erro: 'Este equipamento não possui estoque disponível.' });
    }

    const statusPermitidosInicial = ['Emprestado', 'Fornecido'];
    const status = dados.status ? String(dados.status).trim() : 'Emprestado';
    if (!statusPermitidosInicial.includes(status)) {
      return res.status(400).json({ erro: 'No cadastro inicial de empréstimo, selecione Emprestado ou Fornecido.' });
    }

    const dataEmprestimo = typeof dados.data_emprestimo === 'string' ? dados.data_emprestimo.trim() : '';
    const dataPrevista = typeof dados.data_prevista_devolucao === 'string' ? dados.data_prevista_devolucao.trim() : '';
    const condicoes = typeof dados.condicoes_equipamento === 'string' ? dados.condicoes_equipamento.trim() : '';

    if (!dataEmprestimo) {
      return res.status(400).json({ erro: 'Informe a data do empréstimo.' });
    }

    let dataPrevistaFinal = '';
    if (status === 'Emprestado') {
      if (!dataPrevista) {
        return res.status(400).json({ erro: 'Informe a data prevista para devolução.' });
      }
      const hoje = new Date().toISOString().slice(0, 10);
      if (dataPrevista <= dataEmprestimo || dataPrevista <= hoje) {
        return res.status(400).json({ erro: 'A data prevista para devolução deve ser posterior à data atual e à data do empréstimo.' });
      }
      dataPrevistaFinal = dataPrevista;
    }

    // Dá baixa no estoque disponível (temporária para Emprestado, definitiva para Fornecido)
    db.prepare('UPDATE epis SET quantidade_disponivel = quantidade_disponivel - 1 WHERE id = ?').run(epiId);

    const usuarioId = req.usuarioLogado?.id || 1;

    const resultado = db.prepare(`
      INSERT INTO emprestimos (colaborador_id, epi_id, usuario_id, data_emprestimo, data_prevista_devolucao, status, condicoes_equipamento)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(colaboradorId, epiId, usuarioId, dataEmprestimo, dataPrevistaFinal, status, condicoes);

    res.status(201).json({
      id: Number(resultado.lastInsertRowid),
      mensagem: status === 'Fornecido'
        ? 'Equipamento fornecido com baixa no estoque!'
        : 'Empréstimo registrado com sucesso!',
    });
  });

  app.put('/api/emprestimos/:id', (req, res) => {
    if (!req.is('application/json')) {
      return res.status(400).json({ erro: 'Envie os dados em formato JSON.' });
    }
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });

    const emprestimo = db.prepare('SELECT * FROM emprestimos WHERE id = ?').get(id);
    if (!emprestimo) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });

    if (emprestimo.status === 'Fornecido') {
      return res.status(400).json({ erro: 'Equipamentos fornecidos definitivamente não possuem devolução.' });
    }

    const dados = req.body;
    const statusValidos = ['Emprestado', 'Fornecido', 'Devolvido', 'Danificado', 'Perdido'];
    const novoStatus = typeof dados.status === 'string' ? dados.status.trim() : '';
    if (!statusValidos.includes(novoStatus)) {
      return res.status(400).json({ erro: 'Status informado é inválido.' });
    }

    let dataDevolucao = emprestimo.data_devolucao;
    let observacaoDevolucao = typeof dados.observacao_devolucao === 'string' ? dados.observacao_devolucao.trim() : (emprestimo.observacao_devolucao || '');
    const condicoes = typeof dados.condicoes_equipamento === 'string' ? dados.condicoes_equipamento.trim() : (emprestimo.condicoes_equipamento || '');

    if (['Devolvido', 'Danificado', 'Perdido'].includes(novoStatus)) {
      if (typeof dados.data_devolucao === 'string' && dados.data_devolucao.trim()) {
        dataDevolucao = dados.data_devolucao.trim();
        if (dataDevolucao < emprestimo.data_emprestimo) {
          return res.status(400).json({ erro: 'A data da devolução não pode ser anterior à data do empréstimo.' });
        }
      } else if (!dataDevolucao) {
        dataDevolucao = new Date().toISOString().slice(0, 10);
      }
    } else {
      dataDevolucao = null;
      observacaoDevolucao = '';
    }

    let dataPrevistaAtualizada = emprestimo.data_prevista_devolucao;
    if (novoStatus === 'Fornecido') {
      dataPrevistaAtualizada = '';
    }

    // Controle de estoque na mudança de status:
    // Devolvido repõe +1 no estoque; sair de Devolvido para outro status consome -1 do estoque
    const estavaDevolvido = emprestimo.status === 'Devolvido';
    const vaiSerDevolvido = novoStatus === 'Devolvido';

    if (!estavaDevolvido && vaiSerDevolvido) {
      db.prepare('UPDATE epis SET quantidade_disponivel = quantidade_disponivel + 1 WHERE id = ?').run(emprestimo.epi_id);
    } else if (estavaDevolvido && !vaiSerDevolvido) {
      const epi = db.prepare('SELECT id, quantidade_disponivel FROM epis WHERE id = ?').get(emprestimo.epi_id);
      if (!epi || epi.quantidade_disponivel < 1) {
        return res.status(400).json({ erro: 'Este equipamento não possui estoque disponível.' });
      }
      db.prepare('UPDATE epis SET quantidade_disponivel = quantidade_disponivel - 1 WHERE id = ?').run(emprestimo.epi_id);
    }

    db.prepare(`
      UPDATE emprestimos
      SET status = ?, data_prevista_devolucao = ?, data_devolucao = ?, observacao_devolucao = ?, condicoes_equipamento = ?
      WHERE id = ?
    `).run(novoStatus, dataPrevistaAtualizada, dataDevolucao, observacaoDevolucao, condicoes, id);

    res.json({ mensagem: 'Status do empréstimo atualizado com sucesso!' });
  });

  app.delete('/api/emprestimos/:id', (req, res) => {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });
    const emprestimo = db.prepare('SELECT id FROM emprestimos WHERE id = ?').get(id);
    if (!emprestimo) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });

    db.prepare('DELETE FROM emprestimos WHERE id = ?').run(id);
    res.json({ mensagem: 'Empréstimo excluído com sucesso!' });
  });

  // ==========================================
  // ARQUIVOS ESTÁTICOS E TRATAMENTO DE ERROS
  // ==========================================
  app.use(express.static(join(raiz, 'public'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
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
