import { criarAplicacao } from './app.js';

const porta = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  throw new Error('PORT deve ser uma porta válida entre 1 e 65535.');
}

const app = criarAplicacao();
const servidor = app.listen(porta, host, () => {
  console.log(`Controle de EPI disponível em http://localhost:${porta}`);
});
servidor.on('error', (erro) => {
  console.error(erro.code === 'EADDRINUSE' ? 'A porta está em uso. Encerre a outra execução ou configure PORT.' : 'Não foi possível iniciar o sistema.');
  app.locals.db.close();
  process.exitCode = 1;
});
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => servidor.close(() => {
    app.locals.db.close();
    process.exit(0);
  }));
}
