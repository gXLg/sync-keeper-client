const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const fs = require("fs");
const { spawn } = require("child_process");

const axios = require("axios");
const { relaunchInTerminal } = require("node-relaunch");

const { parseCustomJson } = require("./parser.js");

function getAppDir() {
  switch (process.platform) {
    case "win32":
      return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    case "linux":
      return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

async function prompt(input, text, filterMap) {
  while (true) {
    const answer = await input.question(text + "\n    ").then(a => a.trim());
    const { keep, value } = filterMap(answer);
    if (keep) return value;
    console.log("Wrong format, please re-check your input and try again!");
  }
}

async function promptFilter(input, text, filter) {
  return await prompt(input, text, value => ({ "keep": filter(value), value }));
}

async function promptConfirm(input, action) {
  await prompt(input, `Press [Enter] to ${action ?? "continue"} ...`, a => ({ "keep": true }));
}

async function main(input, cmd, args) {
  const INSTALL_DIR = path.join(getAppDir(), "SyncKeeper_by_gXLg");
  const SYNC_INTERVAL = 1000 * 60 * 10; // 10 minutes

  console.log();
  console.log("- SyncKeeper - Author: gXLg - Date: Nov 2026 - LICENSE: MIT -");
  console.log();

  const host = fs.readFileSync(path.join(INSTALL_DIR, "host.txt"), "utf8").trim();
  const folder = fs.readFileSync(path.join(INSTALL_DIR, "folder.txt"), "utf8").trim();
  const username = fs.readFileSync(path.join(INSTALL_DIR, "username.txt"), "utf8").trim();
  console.log(`Welcome, ${username}!`);
  console.log();

  const identity = fs.readFileSync(path.join(INSTALL_DIR, "identity"), "utf8").trim();
  const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(INSTALL_DIR, "key"), "utf8").trim());

  function makeProof(content) {
    return crypto.sign(null, Buffer.from(content), privateKey).toString("hex");
  }

  if (!fs.existsSync(path.join(INSTALL_DIR, "UUIDs.txt"))) {
    fs.writeFileSync(path.join(INSTALL_DIR, "UUIDs.txt"), "");
  }
  const uuids = fs.readFileSync(path.join(INSTALL_DIR, "UUIDs.txt"), "utf8")
    .trim().split("\n").map(l => l.split("#")[0].trim()).filter(l => l.length);

  const freeWorlds = [];
  const lockedWorlds = [];
  let longestName = 20;
  for (const uuid of uuids) {
    const { success, data } = await axios.get(`${host}/${uuid}/meta`).then(res => res.data);
    if (!success) continue;
    const { name, id, owner } = data;
    if (owner == null) {
      freeWorlds.push({ uuid, name, id });
    } else {
      lockedWorlds.push({ uuid, name, id, owner });
    }
    longestName = Math.max(longestName, name.length);
  }

  async function sync(uuid, index) {
    const map = fs.readFileSync(path.join(folder, "servermaps", `${index}.mapparts.gzip`)).toString("base64");
    const gen = fs.readFileSync(path.join(folder, "worldgenparams", `${index}.json`)).toString("base64");
    const info = fs.readFileSync(path.join(folder, "worldinfos", `${index}.worldinfo`)).toString("base64");
    const world = fs.readFileSync(path.join(folder, "worlds", `${index}.world.gzip`)).toString("base64");
    const proof = makeProof(map + gen + info + world);
    const { success } = await axios.post(`${host}/${uuid}/sync`, { map, gen, info, world, proof }).then(res => res.data);
    if (!success) {
      console.log("Error during world sync!");
    }
    return success;
  }

  async function unlock(uuid, index) {
    const synced = await sync(uuid, index);
    if (!synced) return false;
    const lockId = (
      fs.existsSync(path.join(folder, "worldinfos", `SyncKeeper_${index}.lock`))
        ? fs.readFileSync(path.join(folder, "worldinfos", `SyncKeeper_${index}.lock`), "utf8").trim()
        : ""
    );
    const proof = makeProof(lockId);
    const { success } = await axios.post(`${host}/${uuid}/unlock`, { proof }).then(res => res.data);
    if (!success) {
      console.log("Error during world unlock!");
      return false;
    }
    fs.unlinkSync(path.join(folder, "servermaps", `${index}.mapparts.gzip`));
    fs.unlinkSync(path.join(folder, "worldgenparams", `${index}.json`));
    fs.unlinkSync(path.join(folder, "worldinfos", `${index}.worldinfo`));
    fs.unlinkSync(path.join(folder, "worlds", `${index}.world.gzip`));
    fs.unlinkSync(path.join(folder, "worldinfos", `SyncKeeper_${index}.lock`));
    console.log("Cleaned up synced files!");
    return true;
  }

  const infos = fs.readdirSync(path.join(folder, "worlds")).filter(f => f.endsWith(".world.gzip"));
  for (const n of infos) {
    const i = n.split(".")[0];
    const info = parseCustomJson(fs.readFileSync(path.join(folder, "worldinfos", `${i}.worldinfo`), "utf8"));
    if (info == null) continue;
    let locked = true;
    let wi = lockedWorlds.findIndex(w => info.guid == w.id);
    if (wi == -1) {
      locked = false;
      wi = freeWorlds.findIndex(w => info.guid == w.id);
      if (wi == -1) continue;
    }
    const { uuid, name, id } = (locked ? lockedWorlds : freeWorlds)[wi];
    console.log(`Found unsynced data in world '${name}', syncing and unlocking ...`);
    const unlocked = await unlock(uuid, i);
    if (!unlocked) continue;
    if (locked) {
      lockedWorlds.splice(wi, 1);
      freeWorlds.push({ uuid, name, id });
    }
  }
  console.log();

  const tableWidth = longestName + 17;
  console.log("Worlds, your friends are currently playing in:");
  console.log(",".repeat(tableWidth));
  console.log("| Friend     | World" + " ".repeat(tableWidth - 21) + "|");
  console.log("|------------|" + "-".repeat(tableWidth - 15) + "|");
  for (const { name, owner } of lockedWorlds) {
    console.log(`| ${owner.padEnd(10)} | ${name.padEnd(longestName)} |`);
  }
  if (lockedWorlds.length == 0) {
    console.log("| (none)" + " ".repeat(tableWidth - 9) + "|");
  }
  console.log("'".repeat(tableWidth));
  console.log();
  console.log("Worlds, you can play in yourself:");
  console.log(",".repeat(tableWidth));
  console.log("| Index      | World" + " ".repeat(tableWidth - 21) + "|");
  console.log("|------------|" + "-".repeat(tableWidth - 15) + "|");
  for (let i = 0; i < freeWorlds.length; i++) {
    const name = freeWorlds[i].name;
    console.log(`| ${(i + 1).toString().padEnd(10)} | ${name.padEnd(longestName)} |`);
  }
  if (freeWorlds.length == 0) {
    console.log("| (none)" + " ".repeat(tableWidth - 9) + "|");
  }
  console.log("'".repeat(tableWidth));

  const selected = await prompt(
    input,
    "Select a world for SyncPlay or press [Enter] to not sync any worlds:",
    v => {
      if (v.length == 0) return { "keep": true, "value": null };
      const num = parseInt(v);
      if (isNaN(num) || num < 1 || num > freeWorlds.length) return { "keep": false };
      return { "keep": true, "value": freeWorlds[num - 1] };
    }
  );

  if (selected != null) {
    console.log(`World selected: '${selected.name}', finding a fitting world slot ...`);
    let i = 0;
    while (fs.existsSync(path.join(folder, "worlds", `${i}.world.gzip`))) {
      i++;
    }
    selected.index = i;
    console.log(`Acquiring lock and downloading data into slot ${i + 1} ...`);
    const { success, data } = await axios.post(`${host}/${selected.uuid}/lock`, { identity, username, "proof": makeProof(identity + username) }).then(res => res.data);
    if (!success) {
      console.log("Could not acquire lock for the world, perhaps one of your friends already got it, skipping setup ...");
    } else {
      console.log();
      const { lockId, map, gen, info, world } = data;
      fs.writeFileSync(path.join(folder, "servermaps", `${selected.index}.mapparts.gzip`), Buffer.from(map, "base64"));
      fs.writeFileSync(path.join(folder, "worldgenparams", `${selected.index}.json`), Buffer.from(gen, "base64"));
      fs.writeFileSync(path.join(folder, "worldinfos", `${selected.index}.worldinfo`), Buffer.from(info, "base64"));
      fs.writeFileSync(path.join(folder, "worlds", `${selected.index}.world.gzip`), Buffer.from(world, "base64"));
      fs.writeFileSync(path.join(folder, "worldinfos", `SyncKeeper_${selected.index}.lock`), lockId);
    }
  }

  let syncInterval = null;
  let stop = false;
  function scheduleSyncLoop() {
    syncInterval = setTimeout(() => syncLoop(), SYNC_INTERVAL);
  }
  async function syncLoop() {
    if (stop) return;
    await sync(selected.uuid, selected.index);
    scheduleSyncLoop();
  }
  function stopSyncLoop() {
    stop = true;
    clearTimeout(syncInterval);
  }
  if (selected != null) scheduleSyncLoop();

  console.log();
  console.log("-- STARTING GAME --");
  console.log();

  console.log(cmd, args);
  const child = spawn(cmd, args, { "detached": false, "stdio": ["ignore", "inherit", "inherit"] });
  await new Promise(res => child.once("close", res));

  console.log();
  console.log("-- GAME CLOSED --");
  console.log();

  if (selected != null) {
    stopSyncLoop();
    await unlock(selected.uuid, selected.index);
  }
}

async function wrapTerminal(input, cmd, ...args) {
  process.on("SIGINT", () => {
    console.log("\rCTRL+C pressed, exitting ...");
    process.exit(0);
  });

  try {
    await main(input, cmd, args);
    console.log();
    console.log("-- CLIENT FINISHED --");
    console.log();

  } catch (err) {
    console.log();
    console.log();
    console.log("-- ERROR --");
    console.log();
    console.error(err);
    console.log();
    await promptConfirm(input, "exit");
  }
}

(async () => {
  await relaunchInTerminal("Sync Keeper", wrapTerminal);
})();
