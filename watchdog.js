const { spawn } = require("child_process");

function startBot() {
    console.log("[WATCHDOG] Startuję bota...");

    const bot = spawn("node", ["index.js"], {
        stdio: "inherit",
        shell: true
    });

    bot.on("exit", (code) => {
        console.log(`[WATCHDOG] Bot padł z kodem ${code}. Restart za 3 sekundy...`);
        setTimeout(startBot, 3000);
    });
}

startBot();
