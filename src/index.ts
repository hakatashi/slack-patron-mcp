import { createApp } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "3456", 10);
const app = createApp();

app.listen(PORT, () => {
  console.log(`slack-patron-mcp listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  process.exit(0);
});
