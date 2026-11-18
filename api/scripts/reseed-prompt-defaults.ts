// Sync the SECTIONS_TO_SYNC sections of app_settings.default_prompt_sections to the constant (source
// of truth), AND the same sections inside every phone_numbers.prompt_sections snapshot.
// aiLayer.resolveIdentitySection prefers a number's own snapshot and only falls back to app_settings,
// so syncing app_settings alone leaves live numbers running the old prompt.
//
// update.ps1 runs this on every deploy, so a prompt change ships with the build. A section staff
// edited in the dashboard since the last sync is kept and reported, not overwritten - see
// promptSync.syncPromptSections. --force overwrites those too.
// Retired sections (promptSync.SECTIONS_RETIRED, from the prompt this bot was ported from) are removed
// from both. Identity is never synced (per-number persona) except an unedited previous default (promptSync.PREVIOUS_IDENTITY_DEFAULTS): one that does not name Imperial Indopack
// is reported, so a database seeded before the Imperial prompt gets its Identity fixed by hand.
// Idempotent; leaves all other DB content untouched.
// Run: tsx scripts/reseed-prompt-defaults.ts [--force]
import 'dotenv/config';
import { SYSTEM_PROMPT_SECTIONS as NEW } from '../src/domain/constants.js';
import {
  getDefaultPromptSections, setDefaultPromptSections, getShippedPromptSections, setShippedPromptSections,
} from '../src/repositories/appSettings.js';
import { listPhoneNumbers, updatePhoneNumber } from '../src/repositories/phoneNumbers.js';
import { SECTIONS_TO_SYNC, syncPromptSections, upgradeUneditedIdentity } from '../src/domain/promptSync.js';
import type { PromptSection } from '../src/domain/types.js';

const force = process.argv.includes('--force');

for (const name of SECTIONS_TO_SYNC) {
  if (!NEW.some((s) => s.name === name)) {
    console.error(`ABORT: constant is missing "${name}".`);
    process.exit(1);
  }
}

const baseline = await getShippedPromptSections();
let kept = 0;

// An Identity written for another business: sync leaves it alone, so say so.
function warnStaleIdentity(sections: PromptSection[], label: string): void {
  const identity = sections.find((s) => s.name === 'Identity');
  if (identity && !/imperial indopack/i.test(identity.content)) {
    console.warn(`! [${label}] Identity does not mention Imperial Indopack - it is never synced; update it in the dashboard (Nomor WhatsApp / prompt).`);
  }
}

function patch(live: PromptSection[], label: string): { patched: PromptSection[]; changed: number } {
  // An Identity still equal to a previous shipped default was never edited: upgrade it.
  const upgraded = upgradeUneditedIdentity(live, NEW.find((s) => s.name === 'Identity')!.content);
  if (upgraded.replaced) console.log(`~ [${label}] replaced the unedited old "Identity" with the new default.`);
  live = upgraded.sections;
  warnStaleIdentity(live, label);
  const { patched, actions } = syncPromptSections(live, NEW, baseline, force);
  let changed = upgraded.replaced ? 1 : 0;
  for (const [name, action] of Object.entries(actions)) {
    if (action === 'updated') { console.log(`~ [${label}] updated "${name}" in place.`); changed++; }
    else if (action === 'inserted') { console.log(`+ [${label}] inserted "${name}".`); changed++; }
    else if (action === 'removed') { console.log(`- [${label}] removed retired "${name}".`); changed++; }
    else if (action === 'kept-edited') {
      console.warn(`! [${label}] "${name}" was edited in the dashboard - kept. Run with --force to replace it with the shipped text.`);
      kept++;
    }
  }
  if (changed === 0) console.log(`= [${label}] all synced sections already match.`);
  return { patched: patched as PromptSection[], changed };
}

const defaults = patch(await getDefaultPromptSections(), 'defaults');
if (defaults.changed > 0) {
  await setDefaultPromptSections(defaults.patched);
  console.log(`Synced ${defaults.changed} section(s) in defaults; ${defaults.patched.length} sections total.`);
}

// A null/empty snapshot means the number already follows the defaults - nothing to patch.
for (const pn of await listPhoneNumbers()) {
  if (!pn.promptSections || pn.promptSections.length === 0) continue;
  const { patched, changed } = patch(pn.promptSections, pn.label ?? pn.number);
  if (changed > 0) await updatePhoneNumber(pn.id, { promptSections: patched });
}

// What this build shipped - the next sync tells a hand edit from a section nobody touched by this.
await setShippedPromptSections(Object.fromEntries(
  SECTIONS_TO_SYNC.map((name) => [name, NEW.find((s) => s.name === name)!.content])
));

console.log(kept > 0 ? `Done - ${kept} edited section(s) kept, see the warnings above.` : 'Done.');
process.exit(0);
