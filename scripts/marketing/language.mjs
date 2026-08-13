/**
 * Which language a profile is written in.
 *
 * The first version of this shipped a bug worth keeping in mind: its
 * Portuguese matcher included the bare word "a", so "Table tennis coach and
 * a former national player" came back Portuguese, and the English filter on
 * the outreach page quietly hid real English speakers. Eight of the first 72
 * rows were wrong that way.
 *
 * The rule that prevents a repeat: a marker must be a word that English does
 * not also use. No single letters, nothing that appears inside a domain
 * name, and nothing like "per", "con" or "die" that is ordinary English.
 * Scoring beats first-match, because bios are often bilingual and the
 * language of the sport term is the one that counts.
 */

/** Non-Latin scripts are decisive on their own. */
const SCRIPTS = [
  ["ru", /[Ѐ-ӿ]/],
  ["el", /[Ͱ-Ͽ]/],
  ["he", /[֐-׿]/],
  ["ar", /[؀-ۿ]/],
  ["hi", /[ऀ-ॿ]/],
  ["th", /[฀-๿]/],
  ["ja", /[぀-ヿ]/],
  ["zh", /[一-鿿]/],
];

/**
 * Weight 3 markers are the sport named in that language, which is as good as
 * a flag. Weight 1 markers are ordinary words that English does not share.
 */
const MARKERS = [
  ["de", 3, /tischtennis|tischtennisverein/i],
  ["de", 1, /\b(und|der|für|mit|nicht|auch|verein|jugend|meister|jahre)\b/i],
  ["fr", 3, /tennis de table|entra[iî]neur/i],
  ["fr", 1, /\b(les|une|pour|avec|dans|chez|école|joueur|entra[iî]nement)\b/i],
  ["es", 3, /tenis de mesa|entrenador/i],
  ["es", 1, /\b(los|para|más|años|clases|jugador|profesor)\b/i],
  ["pt", 3, /t[eê]nis de mesa|treinador/i],
  ["pt", 1, /\b(não|aulas|anos|jogador|professora?)\b/i],
  ["it", 3, /tennistavolo|allenatore/i],
  ["it", 1, /\b(della|degli|anni|scuola|giocatore|maestro)\b/i],
  ["pl", 3, /tenis sto[lł]owy|trener/i],
  ["pl", 1, /\b(oraz|jest|dla|treningi|klub[uy])\b/i],
  ["tr", 3, /masa tenisi|antren[oö]r/i],
  ["tr", 1, /\b(için|ile|spor|okulu)\b/i],
  ["nl", 3, /tafeltennis/i],
  ["nl", 1, /\b(vereniging|jeugd|trainingen)\b/i],
];

/**
 * Returns an ISO 639-1 code, or null when there is no text to judge.
 * Latin text with no foreign marker is English, which is the right default
 * for this list: it is the language the outreach is written in.
 */
export function detectLanguage(text) {
  const source = (text ?? "").trim();
  if (!source) return null;

  for (const [code, re] of SCRIPTS) if (re.test(source)) return code;

  const scores = new Map();
  for (const [code, weight, re] of MARKERS) {
    if (re.test(source)) scores.set(code, (scores.get(code) ?? 0) + weight);
  }

  let best = null;
  let bestScore = 0;
  for (const [code, score] of scores) {
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  if (best) return best;

  return /[a-z]/i.test(source) ? "en" : null;
}
