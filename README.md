# Controle de EPI — Colaboradores

**Aluno:** José Augusto da Silva Bertolino Falcão  
**Disciplina:** Desenvolvimento de Sistemas

Aplicação da etapa 2 da atividade: cadastrar, listar, pesquisar, editar e excluir colaboradores, salvando os dados em banco SQLite.

## Executar

Instale o **Node.js 24 ou superior**. Na pasta `controle-epi`, execute:

```bash
npm install
npm run dev
```

Abra **http://localhost:3000**. Para encerrar, pressione **Ctrl+C**.

`npm run dev` reinicia o servidor quando o código muda. Para executar sem esse recurso, use `npm start`.

## Exemplo de uso

1. Clique em **Novo colaborador**.
2. Informe nome `Ana Silva`, matrícula `001` e setor `Produção`.
3. Salve. O sistema exibe uma mensagem e permanece na tela de cadastro.
4. Volte à lista e pesquise por `Ana`.
5. Clique em **Editar**, altere os dados e salve.
6. Na lista, clique em **Excluir** e confirme ou cancele no aviso.

Todos os campos são obrigatórios. A matrícula não pode se repetir. Em caso de falha, os dados digitados são mantidos.

## Dados e arquivos

O banco é criado automaticamente em `dados/controle_epi.db`. Os registros permanecem salvos após fechar ou reiniciar o sistema. Não apague esse arquivo para manter os dados.

- `server.js`: inicia o servidor.
- `app.js`: rotas do Express e operações no banco.
- `schema.sql`: tabelas do banco.
- `public/`: interface em HTML, CSS e JavaScript.
- `tests/`: testes das operações.
- `Dockerfile`: execução opcional com Docker.

A documentação de planejamento fica na pasta separada `documentacao`, ao lado do projeto. O banco possui as quatro tabelas do DER, mas nesta etapa somente as telas de colaboradores estão implementadas. Login, EPIs, usuários e empréstimos fazem parte do planejamento. Use a aplicação localmente para a atividade escolar.

## Testes

```bash
npm test
```

Os testes usam um banco temporário e não alteram os cadastros reais.

Verificação realizada: oito testes passaram, a sintaxe JavaScript foi conferida e `npm run dev` iniciou e serviu a tela corretamente. A aparência não foi conferida em navegador nesta execução. O Dockerfile foi preparado, mas a execução com Docker não foi testada.

## Docker (opcional)

Com Docker instalado e em execução:

```bash
docker build -t controle-epi .
docker run --rm --name controle-epi -p 127.0.0.1:3000:3000 -v controle-epi-dados:/app/dados controle-epi
```

Abra **http://localhost:3000**. O volume mantém o banco após encerrar o contêiner. O banco do Docker é separado daquele usado por `npm run dev`.