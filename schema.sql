PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS colaboradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 100),
    matricula TEXT NOT NULL UNIQUE CHECK (length(trim(matricula)) BETWEEN 1 AND 30),
    setor TEXT NOT NULL CHECK (length(trim(setor)) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS epis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    quantidade_disponivel INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_disponivel >= 0)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_protegida TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

CREATE TABLE IF NOT EXISTS emprestimos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE RESTRICT,
    epi_id INTEGER NOT NULL REFERENCES epis(id) ON DELETE RESTRICT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    data_emprestimo TEXT NOT NULL,
    data_devolucao TEXT,
    CHECK (data_devolucao IS NULL OR data_devolucao >= data_emprestimo)
);
