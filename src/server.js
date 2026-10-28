"use strict";
const { connect, makePublisher } = require("./stores");
const { createApp } = require("./app");
async function main() {
  const stores = await connect();
  const publish = makePublisher(stores);
  const tick = () =>
    publish().catch((e) =>
      console.error(
        "Publicação pendente; nova tentativa em 2s:",
        e.code || e.name,
      ),
    );
  await tick();
  const timer = setInterval(tick, 2000);
  const server = createApp(stores).listen(3000, "0.0.0.0", () =>
    console.log("EventFlow disponível na porta 3000"),
  );
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    server.close(async () => {
      await stores.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main().catch((e) => {
  console.error("Inicialização falhou:", e.code || e.message);
  process.exit(1);
});
