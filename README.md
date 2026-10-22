# Controle de EPI — Sistema de Gerenciamento e Empréstimos

Sistema corporativo para controle de Equipamentos de Proteção Individual (EPI), gestão da equipe de colaboradores, controle de retiradas, devoluções e vistorias de segurança do trabalho para empresas de construção civil.

---

## Informações do Projeto

- **Equipe de Desenvolvimento:**
  - José Augusto da Silva Bertolino Falcão
  - Taiane Silva de Oliveira
- **Curso:** Técnico em Desenvolvimento de Sistemas
- **Disciplina:** Desenvolvimento de Sistemas
- **Atividade Avaliativa:** Sistema de Gerenciamento de EPIs

---

## Acesso e Autenticação (Real)

O sistema conta com autenticação real baseada em **Nome de Usuário** e **Senha** (sem exigência de e-mail), com controle de sessão seguro (`HttpOnly` cookie) e hash criptográfico SHA-256 com salt.

O administrador geral padrão é gerado automaticamente na inicialização:

| Campo | Credencial |
| :--- | :--- |
| **Usuário** | `admin` |
| **Senha** | `admin123` |
| **Perfil** | Administrador Geral |

Novos usuários com perfil de **Administrador** ou **Operador** podem ser criados, editados e gerenciados no módulo de **Gestão de Usuários**.

---

## Módulos e Funcionalidades

### 1. Gestão de Usuários (Administração)
- Cadastro de novos operadores e administradores com login único (`@usuario`), nome e senha protegida.
- Edição de cadastros existentes com opção de redefinição de senha e ativação/desativação.
- Proteção da conta raiz: o administrador principal (`admin`) é protegido contra exclusão ou desativação acidental.
- Proteção de integridade: usuários vinculados a histórico de empréstimos não podem ser excluídos.

### 2. Cadastro de Colaboradores
- Cadastro com validação de campos obrigatórios: Nome completo, Matrícula única e Setor.
- Busca em tempo real por nome com normalização de acentuação em pt-BR.
- Edição e exclusão com diálogo modal de confirmação.

### 3. Catálogo de Equipamentos (EPIs)
- Controle de estoque físico e disponibilidade de itens.
- Cadastro de itens com Nome, Quantidade disponível e Certificado de Aprovação (C.A.).
- Proteção de exclusão: bloqueia remoção de EPIs com histórico de empréstimo.

### 4. Controle de Empréstimos e Vistorias
- **Painel de Indicadores (KPIs):**
  - **Itens Disponíveis:** Total em estoque para novas entregas.
  - **Empréstimos Ativos:** Equipamentos atualmente em uso.
  - **Prazos Vencidos:** Alerta de devoluções com data limite expirada.
  - **Total de Colaboradores:** Efetivo cadastrado.
- **Emissão de Empréstimo:** Associação entre Colaborador e EPI, registro de condições na entrega, data de empréstimo e previsão de devolução (validada obrigatoriamente para ser posterior à entrega).
- **Atualização de Status e Vistoria:**
  - Status gerenciados: `Emprestado`, `Fornecido`, `Devolvido`, `Danificado`, `Perdido`.
  - Dados de entrega originais bloqueados contra edição para preservar o histórico.
  - Exibição dinâmica de campos de **Data da Devolução** e **Observações / Avarias** para encerramento de empréstimo.

### 5. Relatórios com Filtro Combinatório (AND)
- Filtro simultâneo por Colaborador + Equipamento + Status.
- Tabela com atalhos de inspeção e atualização de registros.

---

## Como Executar

Requer **Node.js 24 ou superior** (utiliza o módulo nativo `node:sqlite`).

```bash
npm install
npm run dev
```

Abra **http://localhost:3000** no navegador e efetue o login com `admin` / `admin123`.

Para executar em modo produção:
```bash
npm start
```

---

## Testes Automatizados

Suíte completa de 14 testes cobrindo todo o ciclo da aplicação utilizando `node:test`:

```bash
npm test
```

Testes inclusos:
- CRUD de colaboradores e integridade de matrículas
- Catálogo e estoque de EPIs
- Regras de datas, status e imutabilidade de empréstimos
- Autenticação com usuário e senha, sessões e logout
- Gestão de usuários e proteção de contas administrativas
- Métricas em tempo real e relatórios combinatórios (AND)
- Segurança contra CSRF, limites de payload e persistência

---

## Execução com Docker (opcional)

```bash
docker build -t controle-epi .
docker run --rm --name controle-epi -p 127.0.0.1:3000:3000 -v controle-epi-dados:/app/dados controle-epi
```
