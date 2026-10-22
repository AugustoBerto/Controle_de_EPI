PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS colaboradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 100),
    matricula TEXT NOT NULL UNIQUE CHECK (length(trim(matricula)) BETWEEN 1 AND 30),
    setor TEXT NOT NULL CHECK (length(trim(setor)) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS epis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 100),
    descricao TEXT NOT NULL DEFAULT '',
    quantidade_disponivel INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_disponivel >= 0)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 100),
    usuario TEXT UNIQUE CHECK (usuario IS NULL OR length(trim(usuario)) BETWEEN 2 AND 50),
    email TEXT UNIQUE,
    senha_protegida TEXT NOT NULL,
    perfil TEXT NOT NULL DEFAULT 'Administrador' CHECK (perfil IN ('Administrador', 'Operador')),
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emprestimos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE RESTRICT,
    epi_id INTEGER NOT NULL REFERENCES epis(id) ON DELETE RESTRICT,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
    quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    data_emprestimo TEXT NOT NULL,
    data_prevista_devolucao TEXT NOT NULL DEFAULT '',
    data_devolucao TEXT,
    status TEXT NOT NULL DEFAULT 'Emprestado' CHECK (status IN ('Emprestado', 'Fornecido', 'Devolvido', 'Danificado', 'Perdido')),
    condicoes_equipamento TEXT NOT NULL DEFAULT '',
    observacao_devolucao TEXT NOT NULL DEFAULT ''
);

-- Administrador Geral Padrão (usuário: admin / senha: admin123)
INSERT OR IGNORE INTO usuarios (id, nome, usuario, email, senha_protegida, perfil, ativo)
VALUES (1, 'Administrador Geral', 'admin', 'admin@empresa.com', '0a7b48d4cece1632cf7ee11dc1a59944cad885082868ac2a09795de2e4e6d517', 'Administrador', 1);
