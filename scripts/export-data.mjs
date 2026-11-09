// Copies everything the app needs at run time into ./data-export, ready to become ./data on the
// Docker host:   node scripts/export-data.mjs   (then zip the folder and send it)
//
// - signvoice.db: a consistent online backup (accounts, words, samples, proposals, history)
// - models/tsl51: the deployed sign model, the personal fine-tuned model and the replay caches
// - tts_cache: ElevenLabs sentences already spoken (saves credits)
// Datasets, the Python venv and old experiment models are not needed and are left out.
import { backup, DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const home = process.env.SIGNVOICE_HOME || join(homedir(), '.signvoice');
const out = resolve(process.argv[2] || 'data-export');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'models', 'tsl51'), { recursive: true });

const source = new DatabaseSync(join(home, 'signvoice.db'));
await backup(source, join(out, 'signvoice.db'));
source.close();

const model = join(home, 'models', 'tsl51');
for (const name of ['tsl51.onnx', 'tsl51.pt', 'labels.json', 'report.json', 'replay.npz', 'replay_mirror.npz', 'user']) {
  if (existsSync(join(model, name))) cpSync(join(model, name), join(out, 'models', 'tsl51', name), { recursive: true });
}
if (existsSync(join(home, 'tts_cache'))) cpSync(join(home, 'tts_cache'), join(out, 'tts_cache'), { recursive: true });

const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0) : statSync(p).size);
console.log(`exported to ${out} (${(size(out) / 2 ** 20).toFixed(0)} MB)`);
console.log('Zip it:  powershell Compress-Archive -Path data-export\\* -DestinationPath signvoice-data.zip');
console.log('On the host: unzip into the project folder as ./data, then: docker compose up -d --build');
