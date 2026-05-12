// =====================================
// MUSICDROP BOT — ULTRA PRO EDITION
// =====================================
let lastScrape = Date.now();
function updateScrapeTimestamp() {
    lastScrape = Date.now();
}

// --------- IMPORTY PODSTAWOWE ---------
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cron = require("node-cron");
setInterval(() => console.log("HEARTBEAT"), 20000);
setInterval(() => { const x = Math.random() * Math.random(); }, 10000);
// --------- DISCORD.JS 14 --------------
const {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  InteractionContextType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

// --------- UTILS -----------------------
const { log, error } = require("./utils/logger");
const { loadJSON, saveJSON } = require("./utils/storage");
const { safeFetch } = require("./utils/fetcher");
const { isSpecial, parsePrice, formatPrice } = require("./utils/helpers");

// =====================================
// KONFIGURACJA
// =====================================

const { DISCORD_TOKEN } = require("./config.json");
if (!DISCORD_TOKEN) {
  console.error("❌ Brak DISCORD_TOKEN w config.json");
  process.exit(1);
}

const SHOP_BASE_URL = "https://musicdrop.pl";
const CHECK_INTERVAL_MINUTES = 5;
const DISCORD_INVITE = "https://discord.gg/bnTQejcg";
const LOG_CHANNEL_ID = "1489800618515366032";
const ADMIN_ID = "321304868264476673";

// =====================================
// ANTI‑CRASH
// =====================================

process.on("uncaughtException", e => error("UNCAUGHT EXCEPTION:", e));
process.on("unhandledRejection", e => error("UNHANDLED REJECTION:", e));

// =====================================
// HEARTBEAT
// =====================================

setInterval(() => log("💓 HEARTBEAT — bot żyje"), 30000);

// =====================================
// FOLDERY I PLIKI
// =====================================

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const FILE_SEEN = path.join(DATA_DIR, "seen_products.json");
const FILE_PRICES = path.join(DATA_DIR, "prices.json");
const FILE_ACTIVE = path.join(DATA_DIR, "active_products.json");
const FILE_VENDORS = path.join(DATA_DIR, "vendors.json");
const FILE_THEME = path.join(DATA_DIR, "embed_theme.json");

// =====================================
// THEME — SYSTEM C
// =====================================

const DEFAULT_THEME = {
  color: 0xf1c40f,
  labels: {
    price: "PRICE",
    prices: "PRICES",
    discord: "DISCORD",
    checkout: "CHECKOUT",
    newProduct: "🆕 NEW PRODUCT",
    specialEdition: "⭐ SPECIAL EDITION",
    restock: "🔁 RESTOCKED",
    priceChange: "🔄 PRICE CHANGE"
  },
  emoji: {
    newProduct: "🆕",
    specialEdition: "⭐",
    restock: "🔁",
    priceDrop: "📉",
    priceUp: "📈",
    checkout: "🛒",
    viewProduct: "🔗",
    goToLatest: "⬇️"
  }
};

let THEME = loadJSON(FILE_THEME, DEFAULT_THEME);
saveJSON(FILE_THEME, THEME);

// =====================================
// KLIENT DISCORD
// =====================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

log("🔧 MusicDrop ULTRA‑PRO — start…");

// =====================================
// LOGOWANIE DO KANAŁU
// =====================================

async function logToChannel(msg) {
  try {
    const ch = client.channels.cache.get(LOG_CHANNEL_ID);
    if (ch) ch.send(`\`${new Date().toLocaleString()}\` — ${msg}`);
  } catch (e) {
    error("Log channel error:", e);
  }
}

// =====================================
// ARTYŚCI — 1:1 routing (nazwa = kanał)
// =====================================

const ARTISTS = {
  "Ariana Grande": {
    channelId: "1490017376807162086",
    slugs: ["ariana-grande"],
    roleId: null
  },
  "Taylor Swift": {
    channelId: "1490017423951270121",
    slugs: ["taylor-swift"],
    roleId: null
  },
  "Selena Gomez": {
    channelId: "1490017467949650183",
    slugs: ["selena-gomez"],
    roleId: null
  },
  "Sabrina Carpenter": {
    channelId: "1490017665614348558",
    slugs: ["sabrina-carpenter"],
    roleId: null
  },
  "Lady Gaga": {
    channelId: "1490017494147141702",
    slugs: ["lady-gaga"],
    roleId: null
  },
  "Yungblud": {
    channelId: "1490017583100068031",
    slugs: ["yungblud"],
    roleId: null
  },
  "Olivia Rodrigo": {
    channelId: "1490017629270970398",
    slugs: ["olivia-rodrigo"],
    roleId: null
  },
  "Imagine Dragons": {
    channelId: "1491156786781360279",
    slugs: ["imagine-dragons"],
    roleId: null
  }
};

// =====================================
// ROUTING PRODUKTÓW
// =====================================

function routeProduct(product) {
  // 1) Najpewniejsze — artistName z kolekcji / convertProduct
  if (product.artistName && ARTISTS[product.artistName]) {
    return {
      channelId: ARTISTS[product.artistName].channelId,
      artistName: product.artistName,
      roleId: ARTISTS[product.artistName].roleId
    };
  }

  // 2) Vendor — preordery
  if (product.vendor && ARTISTS[product.vendor]) {
    return {
      channelId: ARTISTS[product.vendor].channelId,
      artistName: product.vendor,
      roleId: ARTISTS[product.vendor].roleId
    };
  }

  // 3) Tag fallback — jeśli MusicDrop doda tagi artystów
  if (product.tags && Array.isArray(product.tags)) {
    for (const [artistName, cfg] of Object.entries(ARTISTS)) {
      if (product.tags.some(t => t.toLowerCase().includes(artistName.toLowerCase()))) {
        return {
          channelId: cfg.channelId,
          artistName,
          roleId: cfg.roleId
        };
      }
    }
  }

  // 4) Slug fallback — ostatnia opcja
  const url = product.url.toLowerCase();
  for (const [artistName, cfg] of Object.entries(ARTISTS)) {
    if (cfg.slugs.some(slug => url.includes(slug))) {
      return {
        channelId: cfg.channelId,
        artistName,
        roleId: cfg.roleId
      };
    }
  }

  return null;
}

// =====================================
// SCRAPER — KOLEKCJE I PREORDERY
// =====================================

async function fetchCollection(slug) {
  const url = `${SHOP_BASE_URL}/collections/${slug}/products.json?limit=250`;
  const data = await safeFetch(url);
  if (!data || !data.products) return [];
  return data.products;
}

async function fetchPreorders() {
  const slugs = ["preorder", "preordery", "upcoming"];

  for (const slug of slugs) {
    const data = await safeFetch(
      `${SHOP_BASE_URL}/collections/${slug}/products.json?limit=250`
    );

    if (data && data.products && data.products.length > 0) {
      log(`📦 Preordery (${slug}): ${data.products.length}`);
      return data.products;
    }
  }

  return [];
}

// =====================================
// KONWERSJA PRODUKTU
// =====================================

function convertProduct(p, artistName = null) {
  if (!p.title) return null;

  // znajdź pierwsze dostępne zdjęcie
  let thumbnail = "";
  if (Array.isArray(p.images) && p.images.length > 0) {
    const img = p.images.find(i => i?.src) || p.images[0];
    thumbnail = img?.src || "";
    if (thumbnail.startsWith("/")) thumbnail = "https:" + thumbnail;
  }

  // znajdź pierwszy dostępny wariant
  let variant = null;
  if (Array.isArray(p.variants) && p.variants.length > 0) {
    variant = p.variants.find(v => v) || p.variants[0];
  }

  const priceNum = parsePrice(variant?.price);
  const compareNum = parsePrice(variant?.compare_at_price);

  const discount =
    compareNum && priceNum && compareNum > priceNum
      ? Math.round(((compareNum - priceNum) / compareNum) * 100)
      : null;

  const available = Array.isArray(p.variants)
    ? p.variants.some(v => v.available)
    : true;

  return {
    id: p.handle || String(p.id),
    handle: p.handle,
    updatedAt: p.updated_at || p.published_at || null,
    name: p.title,
    url: `${SHOP_BASE_URL}/products/${p.handle}`,
    price: formatPrice(priceNum),
    priceNumeric: priceNum,
    compareNumeric: compareNum,
    discountPercent: discount,
    isSoldOut: !available,
    thumbnail,
    vendor: p.vendor || null,
    artistName
  };
}

// =====================================
// MONITORING — PAMIĘĆ
// =====================================

let seenProducts = new Set(loadJSON(FILE_SEEN, []));
let trackedPrices = loadJSON(FILE_PRICES, {});
let lastActive = new Set(loadJSON(FILE_ACTIVE, []));
let vendorMap = loadJSON(FILE_VENDORS, {});
let lastCheckTime = null;
let checkCount = 0;
let lastMonitorTime = Date.now();

// =====================================
// LOGIKA MONITORINGU
// =====================================

async function handleProduct(client, channelId, product, pid, artistName, roleId) {
  const isFirstRun = lastCheckTime === null;

  // FIRST RUN — zapisujemy, ale NIE wysyłamy powiadomień
  if (isFirstRun) {
    seenProducts.add(pid);
    trackedPrices[pid] = {
      price: product.price,
      numeric: product.priceNumeric,
      name: product.name,
      url: product.url,
      soldOut: product.isSoldOut
    };
    return;
  }

  // NOWY PRODUKT
  if (!seenProducts.has(pid)) {
    seenProducts.add(pid);
    saveJSON(FILE_SEEN, [...seenProducts]);

    trackedPrices[pid] = {
      price: product.price,
      numeric: product.priceNumeric,
      name: product.name,
      url: product.url,
      soldOut: product.isSoldOut
    };
    saveJSON(FILE_PRICES, trackedPrices);

    await sendNewProduct(client, channelId, product, artistName, roleId);
    return;
  }

  const entry = trackedPrices[pid];

  // RESTOCK
  if (entry && entry.soldOut === true && product.isSoldOut === false) {
    entry.soldOut = false;
    entry.price = product.price;
    entry.numeric = product.priceNumeric;

    saveJSON(FILE_PRICES, trackedPrices);

    await sendRestock(client, channelId, product, artistName);
    return;
  }

  // ZMIANA CENY
  await checkPriceChange(client, channelId, product, pid);
}

// =====================================
// FUNKCJA SPRAWDZANIA ZMIANY CENY
// =====================================

async function checkPriceChange(client, channelId, product, pid) {
  const entry = trackedPrices[pid];
  if (!entry) return;

  const oldPrice = entry.price;
  const newPrice = product.price;

  if (oldPrice !== newPrice) {
    entry.price = newPrice;
    entry.numeric = parsePrice(newPrice);
    entry.soldOut = product.isSoldOut;

    saveJSON(FILE_PRICES, trackedPrices);

    await sendPriceChange(client, channelId, product, oldPrice, newPrice);
  }
}

// =====================================
// CZYSZCZENIE KANAŁÓW
// =====================================

async function clearEntireChannel(channel) {
  let deleted = 0;

  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size === 0) break;

    const bulk = messages.filter(
      m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
    );
    if (bulk.size > 0) {
      await channel.bulkDelete(bulk, true);
      deleted += bulk.size;
    }

    const old = messages.filter(m => !bulk.has(m.id));
    for (const msg of old.values()) {
      await msg.delete().catch(() => {});
      deleted++;
    }
  }

  return deleted;
}

// =====================================
// GŁÓWNA FUNKCJA MONITORINGU
// =====================================

async function runCheck(client) {
  log(`[Monitor] Sprawdzam sklep… (${new Date().toLocaleString("pl-PL")})`);

  lastCheckTime = new Date();
  checkCount++;

  const currentActive = new Set();

  // KOLEKCJE ARTYSTÓW
  for (const [artistName, config] of Object.entries(ARTISTS)) {
    for (const slug of config.slugs) {
      try {
        const raw = await fetchCollection(slug);
        const products = raw.map(p => convertProduct(p, artistName)).filter(Boolean);

        log(`[Scraper] ${artistName} (${slug}): ${products.length} produktów`);

        for (const product of products) {
          const pid = `artist:${artistName}:${product.handle}`;
          currentActive.add(pid);

          await handleProduct(client, config.channelId, product, pid, artistName, config.roleId);
        }
      } catch (err) {
        error(`[Monitor] Błąd kolekcji ${artistName}:`, err.message);
      }
    }
  }

  // PREORDERY
  try {
    const raw = await fetchPreorders();
    const products = raw.map(p => convertProduct(p, null)).filter(Boolean);

    for (const product of products) {
      const pid = `preorder:${product.handle}`;
      currentActive.add(pid);

      const match = routeProduct(product);
      if (!match) {
        log(`[Monitor] Pomijam preorder (brak dopasowania): ${product.name}`);
        continue;
      }

      const { channelId, artistName, roleId } = match;
      await handleProduct(client, channelId, product, pid, artistName, roleId);
    }
  } catch (err) {
    error("[Monitor] Błąd preorderów:", err.message);
  }

  // ZAPIS
  lastActive = currentActive;
  saveJSON(FILE_ACTIVE, [...currentActive]);

  lastMonitorTime = Date.now();

  log(`[Monitor] Zakończono. Aktywne produkty: ${currentActive.size}. Sprawdzeń: ${checkCount}`);
}

// =====================================
// EMBED BUILDERY — SYSTEM C
// =====================================

function getEmbedColor() {
  return typeof THEME.color === "number" ? THEME.color : DEFAULT_THEME.color;
}

function buildBaseEmbed(product) {
  const embed = new EmbedBuilder()
    .setTitle(product.name)
    .setURL(product.url)
    .setColor(getEmbedColor())
    .setTimestamp();

  if (product.thumbnail) embed.setThumbnail(product.thumbnail);

  return embed;
}

function buildSoldOutLine(product) {
  return product.isSoldOut ? "\n📦 SOLD OUT" : "";
}

function buildDiscountLine(product) {
  if (product.discountPercent && product.discountPercent > 0) {
    return `\n${THEME.emoji.priceDrop || "📉"} -${product.discountPercent}%`;
  }
  return "";
}

function buildCheckoutField(url) {
  const qty = (n) =>
    `[${n === 1 ? "ONE" : n === 2 ? "TWO" : n === 3 ? "THREE" : "FOUR"}](${url})`;

  return {
    name: THEME.labels.checkout || "CHECKOUT",
    value: `${qty(1)} | ${qty(2)} | ${qty(3)} | ${qty(4)}`,
    inline: false
  };
}

function buildViewButton(url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("VIEW PRODUCT")
      .setEmoji(THEME.emoji.viewProduct || "🔗")
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

function buildJumpToLatestButton(channelId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("GO TO LATEST")
      .setEmoji(THEME.emoji.goToLatest || "⬇️")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${channelId}`)
  );
}

// =====================================
// POWIADOMIENIA — NEW PRODUCT
// =====================================

async function sendNewProduct(client, channelId, product, artistName, roleId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const typeLabel = product.isSpecial
      ? THEME.labels.specialEdition
      : THEME.labels.newProduct;

    let priceLine = `${THEME.labels.price}: ${product.price}`;
    priceLine += buildDiscountLine(product);
    priceLine += buildSoldOutLine(product);

    const embed = buildBaseEmbed(product).addFields(
      { name: typeLabel, value: product.name, inline: false },
      { name: THEME.labels.price, value: priceLine, inline: false },
      { name: THEME.labels.discord, value: DISCORD_INVITE, inline: false },
      buildCheckoutField(product.url)
    );

    let content = `**${typeLabel} — ${product.name}**`;

    if (product.isSpecial && roleId) {
      content = `<@&${roleId}> 🚨 **${typeLabel} — ${product.name}**`;
    }

    await channel.send({
      content,
      embeds: [embed],
      components: [
        buildViewButton(product.url),
        buildJumpToLatestButton(channelId, client.guilds.cache.first().id)
      ]
    });

    log(`📢 NEW PRODUCT: ${product.name} → ${channelId}`);
    logToChannel(`NEW PRODUCT: ${product.name}`);
  } catch (err) {
    error("sendNewProduct:", err.message);
  }
}

// =====================================
// POWIADOMIENIA — PRICE CHANGE
// =====================================

async function sendPriceChange(client, channelId, product, oldPrice, newPrice) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const oldNum = parsePrice(oldPrice);
    const newNum = parsePrice(newPrice);

    let label = THEME.labels.priceChange;

    if (oldNum && newNum && oldNum !== newNum) {
      const diff = newNum - oldNum;
      const percent = Math.abs((diff / oldNum) * 100).toFixed(0);

      label =
        diff < 0
          ? `${THEME.emoji.priceDrop} PRICE DROP (-${Math.abs(diff).toFixed(2)} zł, -${percent}%)`
          : `${THEME.emoji.priceUp} PRICE INCREASE (+${diff.toFixed(2)} zł, +${percent}%)`;
    }

    const priceBlock =
      `${THEME.labels.price} (OLD): ${oldPrice}\n` +
      `${THEME.labels.price} (NEW): ${newPrice}` +
      buildSoldOutLine(product);

    const embed = buildBaseEmbed(product).addFields(
      { name: THEME.labels.priceChange, value: product.name, inline: false },
      { name: THEME.labels.prices, value: priceBlock, inline: false },
      { name: THEME.labels.discord, value: DISCORD_INVITE, inline: false },
      buildCheckoutField(product.url)
    );

    await channel.send({
      content: `**${label} — ${product.name}**`,
      embeds: [embed],
      components: [
        buildViewButton(product.url),
        buildJumpToLatestButton(channelId, client.guilds.cache.first().id)
      ]
    });

    log(`💰 PRICE CHANGE: ${product.name} ${oldPrice} → ${newPrice}`);
    logToChannel(`PRICE CHANGE: ${product.name} ${oldPrice} → ${newPrice}`);
  } catch (err) {
    error("sendPriceChange:", err.message);
  }
}

// =====================================
// POWIADOMIENIA — RESTOCK
// =====================================

async function sendRestock(client, channelId, product, artistName) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    let priceLine = `${THEME.labels.price}: ${product.price}`;
    priceLine += buildDiscountLine(product);

    const embed = buildBaseEmbed(product).addFields(
      { name: THEME.labels.restock, value: product.name, inline: false },
      { name: THEME.labels.price, value: priceLine, inline: false },
      { name: THEME.labels.discord, value: DISCORD_INVITE, inline: false },
      buildCheckoutField(product.url)
    );

    await channel.send({
      content: `**RESTOCK — ${product.name}**`,
      embeds: [embed],
      components: [
        buildViewButton(product.url),
        buildJumpToLatestButton(channelId, client.guilds.cache.first().id)
      ]
    });

    log(`🔁 RESTOCK: ${product.name} → ${channelId}`);
    logToChannel(`RESTOCK: ${product.name}`);
  } catch (err) {
    error("sendRestock:", err.message);
  }
}

// =====================================
// KOMENDY — DEFINICJA
// =====================================

const startTime = new Date();

const commands = [
  // -------------------------------------
  // ADMIN
  // -------------------------------------
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Panel administracyjny")
    .addStringOption(opt =>
      opt.setName("action")
        .setDescription("Co chcesz zrobić?")
        .setRequired(true)
        .addChoices(
          { name: "reload", value: "reload" },
          { name: "run", value: "run" },
          { name: "stats", value: "stats" },
          { name: "vendors", value: "vendors" },
          { name: "clearcache", value: "clearcache" }
        )
    )
    .setContexts(InteractionContextType.Guild),

  // -------------------------------------
  // PODSTAWOWE
  // -------------------------------------
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Sprawdź czy bot działa")
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Pełny status bota MusicDrop")
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Czas działania bota")
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("test")
    .setDescription("Wyślij testowe powiadomienie")
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("check")
    .setDescription("Natychmiastowe sprawdzenie sklepu")
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("prices")
    .setDescription("Pokaż śledzone ceny produktów")
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Wyczyść wiadomości na kanale")
    .addStringOption(opt =>
      opt.setName("amount")
        .setDescription("Liczba wiadomości lub 'all'")
        .setRequired(true)
    )
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("clearallchannels")
    .setDescription("Wyczyść wszystkie kanały oprócz logów, admina i botów")
    .setContexts(InteractionContextType.Guild),

  // -------------------------------------
  // PANEL ADMINA (PRZYCISKI)
  // -------------------------------------
  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Interaktywny panel admina z przyciskami")
    .setContexts(InteractionContextType.Guild),

  // -------------------------------------
  // SYSTEM EMBEDÓW — WERSJA C
  // -------------------------------------
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Edycja wyglądu powiadomień")

    .addSubcommand(sub =>
      sub.setName("kolor")
        .setDescription("Ustaw kolor embedów")
        .addStringOption(o =>
          o.setName("wartosc")
            .setDescription("Kolor HEX, np. #F1C40F")
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName("price")
        .setDescription("Ustaw etykietę PRICE")
        .addStringOption(o =>
          o.setName("wartosc")
            .setDescription("Nowa etykieta, np. PRICE / CENA / KOSZT")
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName("emoji")
        .setDescription("Ustaw emoji dla typu powiadomienia")
        .addStringOption(o =>
          o.setName("pole")
            .setDescription("Które emoji zmienić?")
            .setRequired(true)
            .addChoices(
              { name: "newProduct", value: "newProduct" },
              { name: "specialEdition", value: "specialEdition" },
              { name: "restock", value: "restock" },
              { name: "priceDrop", value: "priceDrop" },
              { name: "priceUp", value: "priceUp" },
              { name: "checkout", value: "checkout" },
              { name: "viewProduct", value: "viewProduct" },
              { name: "goToLatest", value: "goToLatest" }
            )
        )
        .addStringOption(o =>
          o.setName("wartosc")
            .setDescription("Nowe emoji")
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName("style")
        .setDescription("Ustaw styl embedów")
        .addStringOption(o =>
          o.setName("wartosc")
            .setDescription("compact | full | premium")
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName("preview")
        .setDescription("Podgląd aktualnego stylu embedów")
    )

    .setContexts(InteractionContextType.Guild)
];

// =====================================
// FUNKCJA UPTIME
// =====================================

function getUptime() {
  const s = Math.floor((Date.now() - startTime.getTime()) / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

// =====================================
// READY + REJESTRACJA KOMEND
// =====================================

client.on(Events.ClientReady, async (ready) => {
  log(`[Bot] Zalogowano jako: ${ready.user.tag}`);
  logToChannel(`Bot zalogowany jako: ${ready.user.tag}`);

  ready.user.setActivity("MusicDrop.pl", {
    type: ActivityType.Watching
  });

  try {
    const rest = new REST().setToken(DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(ready.user.id),
      { body: commands.map(c => c.toJSON()) }
    );
    log("[Bot] Slash commands zarejestrowane!");
    logToChannel("Slash commands zarejestrowane.");
  } catch (err) {
    error("[Bot] Błąd rejestracji komend:", err.message);
  }
});

// =====================================
// OBSŁUGA INTERAKCJI
// =====================================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // -------------------------------------
    // BUTTONY PANELU ADMINA
    // -------------------------------------
    if (interaction.isButton()) {
      if (interaction.user.id !== ADMIN_ID)
        return interaction.reply({ content: "❌ Brak uprawnień.", ephemeral: true });

      const id = interaction.customId;

      if (id === "admin_run") {
        await interaction.deferReply({ ephemeral: true });
        await runCheck(client);
        return interaction.editReply("🟣 Monitoring uruchomiony ręcznie.");
      }

      if (id === "admin_reload") {
        seenProducts = new Set(loadJSON(FILE_SEEN, []));
        trackedPrices = loadJSON(FILE_PRICES, {});
        lastActive = new Set(loadJSON(FILE_ACTIVE, []));
        vendorMap = loadJSON(FILE_VENDORS, {});
        return interaction.reply({ content: "🔄 Przeładowano konfigurację.", ephemeral: true });
      }

      if (id === "admin_clearcache") {
        seenProducts = new Set();
        trackedPrices = {};
        lastActive = new Set();
        saveJSON(FILE_SEEN, []);
        saveJSON(FILE_PRICES, {});
        saveJSON(FILE_ACTIVE, []);
        return interaction.reply({ content: "🧹 Cache wyczyszczony.", ephemeral: true });
      }

      if (id === "admin_stats") {
        return interaction.reply({
          content:
            `📊 Statystyki:\n` +
            `• Seen: ${seenProducts.size}\n` +
            `• Active: ${lastActive.size}\n` +
            `• Prices: ${Object.keys(trackedPrices).length}`,
          ephemeral: true
        });
      }

      if (id === "admin_vendors") {
        return interaction.reply({
          content: "📦 Vendor map:\n```json\n" + JSON.stringify(vendorMap, null, 2) + "\n```",
          ephemeral: true
        });
      }

      return;
    }

    // -------------------------------------
    // KOMENDY SLASH
    // -------------------------------------
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // -------------------------------------
    // /admin
    // -------------------------------------
    if (commandName === "admin") {
      if (interaction.user.id !== ADMIN_ID)
        return interaction.reply({ content: "❌ Brak uprawnień.", ephemeral: true });

      const action = interaction.options.getString("action");

      if (action === "reload") {
        seenProducts = new Set(loadJSON(FILE_SEEN, []));
        trackedPrices = loadJSON(FILE_PRICES, {});
        lastActive = new Set(loadJSON(FILE_ACTIVE, []));
        vendorMap = loadJSON(FILE_VENDORS, {});
        return interaction.reply("🔄 Przeładowano konfigurację.");
      }

      if (action === "run") {
        await interaction.deferReply();
        await runCheck(client);
        return interaction.editReply("🟣 Monitoring uruchomiony ręcznie.");
      }

      if (action === "stats") {
        return interaction.reply(
          `📊 Statystyki:\n` +
          `• Seen: ${seenProducts.size}\n` +
          `• Active: ${lastActive.size}\n` +
          `• Prices: ${Object.keys(trackedPrices).length}`
        );
      }

      if (action === "vendors") {
        return interaction.reply("📦 Vendor map:\n```json\n" + JSON.stringify(vendorMap, null, 2) + "\n```");
      }

      if (action === "clearcache") {
        seenProducts = new Set();
        trackedPrices = {};
        lastActive = new Set();
        saveJSON(FILE_SEEN, []);
        saveJSON(FILE_PRICES, {});
        saveJSON(FILE_ACTIVE, []);
        return interaction.reply("🧹 Cache wyczyszczony.");
      }

      return;
    }

    // -------------------------------------
    // /adminpanel
    // -------------------------------------
    if (commandName === "adminpanel") {
      if (interaction.user.id !== ADMIN_ID)
        return interaction.reply({ content: "❌ Brak uprawnień.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("🛠 MusicDrop — Admin Panel")
        .setDescription(
          "Szybkie akcje administracyjne:\n" +
          "• RUN — ręczne sprawdzenie sklepu\n" +
          "• RELOAD — przeładuj konfigurację\n" +
          "• CLEARCACHE — wyczyść cache\n" +
          "• STATS — statystyki bota\n" +
          "• VENDORS — mapa vendorów"
        )
        .setColor(getEmbedColor())
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("admin_run").setLabel("RUN").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("admin_reload").setLabel("RELOAD").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("admin_clearcache").setLabel("CLEAR CACHE").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("admin_stats").setLabel("STATS").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("admin_vendors").setLabel("VENDORS").setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
    }

    // -------------------------------------
    // /clear
    // -------------------------------------
    if (commandName === "clear") {
      const amount = interaction.options.getString("amount");

      if (interaction.user.id !== ADMIN_ID)
        return interaction.reply({ content: "❌ Brak uprawnień.", ephemeral: true });

      const channel = interaction.channel;

      if (amount === "all") {
        await interaction.deferReply({ ephemeral: true });
        const deleted = await clearEntireChannel(channel);
        return interaction.editReply(`🧹 Usunięto **${deleted}** wiadomości z tego kanału.`);
      }

      const num = parseInt(amount);
      if (isNaN(num) || num < 1 || num > 100)
        return interaction.reply({ content: "❌ Podaj liczbę 1–100 lub 'all'.", ephemeral: true });

      const messages = await channel.messages.fetch({ limit: num });
      await channel.bulkDelete(messages, true);

      return interaction.reply({
        content: `🧹 Usunięto **${messages.size}** wiadomości.`,
        ephemeral: true
      });
    }

// -------------------------------------
// /clearallchannels
// -------------------------------------
if (commandName === "clearallchannels") {
  if (interaction.user.id !== ADMIN_ID)
    return interaction.reply({ content: "❌ Brak uprawnień.", ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;

  // KANAŁY, KTÓRYCH NIE CZYŚCIMY
  const EXCLUDED = [
    "1489800618515366032", // LOGI
    "1495565216233160836", // ADMIN
    "1491198973136863422"  // BOTY / CARL
  ];

  let cleaned = 0;

  for (const [id, channel] of guild.channels.cache) {
    if (!channel.isTextBased()) continue;
    if (EXCLUDED.includes(id)) continue;

    await clearEntireChannel(channel);
    cleaned++;
  }

  return interaction.editReply(`🧹 Wyczyściłam **${cleaned}** kanałów (bez logów/admin/boty).`);
}

    // -------------------------------------
    // /embed — SYSTEM C
    // -------------------------------------
    if (commandName === "embed") {
      if (interaction.user.id !== ADMIN_ID)
        return interaction.reply({ content: "❌ Brak uprawnień.", ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === "kolor") {
        const value = interaction.options.getString("wartosc");
        THEME.color = parseInt(value.replace("#", ""), 16) || DEFAULT_THEME.color;
        saveJSON(FILE_THEME, THEME);
        return interaction.reply("🎨 Zmieniono kolor embedów.");
      }

      if (sub === "price") {
        const value = interaction.options.getString("wartosc");
        THEME.labels.price = value;
        saveJSON(FILE_THEME, THEME);
        return interaction.reply("🏷 Zmieniono etykietę PRICE.");
      }

      if (sub === "emoji") {
        const field = interaction.options.getString("pole");
        const value = interaction.options.getString("wartosc");
        THEME.emoji[field] = value;
        saveJSON(FILE_THEME, THEME);
        return interaction.reply(`😎 Zmieniono emoji dla: ${field}.`);
      }

      if (sub === "style") {
        const value = interaction.options.getString("wartosc");
        THEME.style = value;
        saveJSON(FILE_THEME, THEME);
        return interaction.reply(`✨ Zmieniono styl embedów na: ${value}.`);
      }

      if (sub === "preview") {
        const dummy = {
          name: "PREVIEW PRODUCT",
          url: "https://musicdrop.pl",
          price: "99,99 zł",
          discountPercent: 10,
          isSoldOut: false,
          thumbnail: ""
        };

        const embed = buildBaseEmbed(dummy).addFields(
          { name: THEME.labels.newProduct, value: dummy.name, inline: false },
          { name: THEME.labels.price, value: `${THEME.labels.price}: ${dummy.price}`, inline: false },
          { name: THEME.labels.discord, value: DISCORD_INVITE, inline: false },
          buildCheckoutField(dummy.url)
        );

        return interaction.reply({ embeds: [embed] });
      }

      return;
    }

    // -------------------------------------
    // /ping
    // -------------------------------------
    if (commandName === "ping") {
      return interaction.reply("🏓 Pong!");
    }

    // -------------------------------------
    // /status
    // -------------------------------------
    if (commandName === "status") {
      return interaction.reply(
        `📊 Status bota:\n` +
        `• Uptime: ${getUptime()}\n` +
        `• Seen: ${seenProducts.size}\n` +
        `• Active: ${lastActive.size}\n` +
        `• Prices: ${Object.keys(trackedPrices).length}\n` +
        `• Last monitor: ${new Date(lastMonitorTime).toLocaleString("pl-PL")}`
      );
    }

    // -------------------------------------
    // /uptime
    // -------------------------------------
    if (commandName === "uptime") {
      return interaction.reply(`⏱ Uptime: ${getUptime()}`);
    }

    // -------------------------------------
    // /check
    // -------------------------------------
    if (commandName === "check") {
      await interaction.deferReply();
      await runCheck(client);
      return interaction.editReply("🟣 Monitoring uruchomiony ręcznie.");
    }

    // -------------------------------------
    // /prices
    // -------------------------------------
    if (commandName === "prices") {
      const list = Object.values(trackedPrices)
        .slice(0, 20)
        .map(p => `• ${p.name} — ${p.price}`)
        .join("\n") || "Brak śledzonych produktów.";

      return interaction.reply("💰 Śledzone ceny:\n" + list);
    }

    // -------------------------------------
    // /test
    // -------------------------------------
    if (commandName === "test") {
      if (interaction.user.id !== ADMIN_ID)
        return interaction.reply({ content: "❌ Brak uprawnień.", ephemeral: true });

      const channel = interaction.channel;
      const dummy = {
        name: "TEST PRODUCT",
        url: "https://musicdrop.pl",
        price: "99,99 zł",
        discountPercent: 15,
        isSoldOut: false,
        thumbnail: ""
      };

      await sendNewProduct(client, channel.id, dummy, "TEST", null);
      return interaction.reply({ content: "✅ Wysłano testowe powiadomienie.", ephemeral: true });
    }

  } catch (err) {
    error("Interaction error:", err.message);
  }
});

// =====================================
// CRON — AUTOMATYCZNY MONITORING
// =====================================

cron.schedule(`*/${CHECK_INTERVAL_MINUTES} * * * *`, () => {
  log("[Cron] Automatyczne sprawdzenie sklepu…");
  runCheck(client);
});

// =====================================
// START BOTA
// =====================================

client.login(DISCORD_TOKEN);
setInterval(() => {
    console.log("💓 HEARTBEAT – bot żyje");
}, 30000);
