import page from "./listen-fixture/index.html";

// Layout-only browser fixture: no account, provider requests or simulated audio.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3119,
  routes: { "/": page },
});
console.log(
  `Open ${server.url} at desktop and mobile widths. Start, Advance, scroll, then Follow.`,
);
