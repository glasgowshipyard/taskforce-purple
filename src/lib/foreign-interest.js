/**
 * FOREIGN INTEREST DETECTION - derived from the committee's own FEC-filed name
 *
 * Committees file full legal names, and organisations that exist to advance a
 * country's interests almost always say so: "AMERICAN ISRAEL PUBLIC AFFAIRS
 * COMMITTEE", "ARMENIAN NATIONAL COMMITTEE", "TURKISH COALITION USA PAC".
 * So the country is read out of the filing rather than assigned by us.
 *
 * Two rules keep this honest:
 *   1. WHOLE-WORD matching only. Substring matching produced a real error in
 *      testing - "AGUA CALIENTE BAND OF CAHUILLA INDIANS" matched "India".
 *      A tribal nation labelled a foreign interest is exactly the mistake
 *      that would discredit the page.
 *   2. EXCLUSIONS win. Names matching a tribal/domestic pattern are never
 *      given a country, whatever else they contain.
 *
 * Anything not matched carries no country - never a guess. Acronym-only
 * organisations (NORPAC, DMFI) are therefore missed by design; they can be
 * added to ALIASES with a citation rather than inferred.
 */

// country: [terms that identify it]. Terms are matched as whole words.
const COUNTRY_TERMS = {
  Israel: ['ISRAEL', 'ISRAELI'],
  Armenia: ['ARMENIA', 'ARMENIAN'],
  Turkey: ['TURKEY', 'TURKISH'],
  Greece: ['GREECE', 'GREEK', 'HELLENIC'],
  Cuba: ['CUBA', 'CUBAN'],
  // NOT bare 'INDIAN': in US filings that is overwhelmingly tribal
  // ("ONEIDA INDIAN NATION" was mislabelled India in testing). \bINDIA\b
  // does not match "INDIAN", so this is safe.
  India: ['INDIA', 'INDIAN AMERICAN', 'INDO-AMERICAN'],
  Pakistan: ['PAKISTAN', 'PAKISTANI'],
  Taiwan: ['TAIWAN', 'TAIWANESE', 'FORMOSA'],
  Ireland: ['IRELAND', 'IRISH'],
  Ukraine: ['UKRAINE', 'UKRAINIAN'],
  Poland: ['POLAND', 'POLISH'],
  Korea: ['KOREA', 'KOREAN'],
  Japan: ['JAPAN', 'JAPANESE'],
  China: ['CHINA', 'CHINESE'],
  Vietnam: ['VIETNAM', 'VIETNAMESE'],
  Philippines: ['PHILIPPINES', 'FILIPINO'],
  Nigeria: ['NIGERIA', 'NIGERIAN'],
  Egypt: ['EGYPT', 'EGYPTIAN'],
  Lebanon: ['LEBANON', 'LEBANESE'],
  Iran: ['IRAN', 'IRANIAN'],
  Iraq: ['IRAQ', 'IRAQI'],
  'Saudi Arabia': ['SAUDI'],
  Qatar: ['QATAR', 'QATARI'],
  Serbia: ['SERBIA', 'SERBIAN'],
  Croatia: ['CROATIA', 'CROATIAN'],
  Hungary: ['HUNGARY', 'HUNGARIAN'],
  Italy: ['ITALY', 'ITALIAN'],
  Mexico: ['MEXICO', 'MEXICAN'],
  Colombia: ['COLOMBIA', 'COLOMBIAN'],
  Venezuela: ['VENEZUELA', 'VENEZUELAN'],
  Haiti: ['HAITI', 'HAITIAN'],
  Ethiopia: ['ETHIOPIA', 'ETHIOPIAN'],
  Somalia: ['SOMALIA', 'SOMALI'],
  Morocco: ['MOROCCO', 'MOROCCAN'],
  Azerbaijan: ['AZERBAIJAN', 'AZERBAIJANI'],
  Georgia: ['GEORGIAN'], // note: NOT 'GEORGIA' - the US state collides
  Cyprus: ['CYPRUS', 'CYPRIOT'],
  Albania: ['ALBANIA', 'ALBANIAN'],
  Bangladesh: ['BANGLADESH', 'BANGLADESHI'],
};

const FLAGS = {
  Israel: '🇮🇱',
  Armenia: '🇦🇲',
  Turkey: '🇹🇷',
  Greece: '🇬🇷',
  Cuba: '🇨🇺',
  India: '🇮🇳',
  Pakistan: '🇵🇰',
  Taiwan: '🇹🇼',
  Ireland: '🇮🇪',
  Ukraine: '🇺🇦',
  Poland: '🇵🇱',
  Korea: '🇰🇷',
  Japan: '🇯🇵',
  China: '🇨🇳',
  Vietnam: '🇻🇳',
  Philippines: '🇵🇭',
  Nigeria: '🇳🇬',
  Egypt: '🇪🇬',
  Lebanon: '🇱🇧',
  Iran: '🇮🇷',
  Iraq: '🇮🇶',
  'Saudi Arabia': '🇸🇦',
  Qatar: '🇶🇦',
  Serbia: '🇷🇸',
  Croatia: '🇭🇷',
  Hungary: '🇭🇺',
  Italy: '🇮🇹',
  Mexico: '🇲🇽',
  Colombia: '🇨🇴',
  Venezuela: '🇻🇪',
  Haiti: '🇭🇹',
  Ethiopia: '🇪🇹',
  Somalia: '🇸🇴',
  Morocco: '🇲🇦',
  Azerbaijan: '🇦🇿',
  Georgia: '🇬🇪',
  Cyprus: '🇨🇾',
  Albania: '🇦🇱',
  Bangladesh: '🇧🇩',
};

// Never classified as a foreign interest, whatever words the name contains.
// "INDIANS"/"INDIAN COMMUNITY" in US filings are overwhelmingly tribal.
const EXCLUSIONS = [
  /\bINDIANS\b/,
  /\bINDIAN NATION\b/,
  /\bTRIBE\b/,
  /\bTRIBAL\b/,
  /\bBAND OF\b/,
  /\bNATION OF\b/,
  /\bPUEBLO\b/,
  /\bRANCHERIA\b/,
  /\bINDIAN COMMUNITY\b/,
  /\bINDIAN GAMING\b/,
];

// Acronym-only organisations, each needing a citable basis rather than
// inference. Kept deliberately small and explicit.
const ALIASES = {
  AIPAC: { country: 'Israel', basis: 'American Israel Public Affairs Committee' },
  NORPAC: { country: 'Israel', basis: 'self-described pro-Israel PAC' },
  JSTREETPAC: { country: 'Israel', basis: 'self-described pro-Israel PAC' },
  JSTREET: { country: 'Israel', basis: 'J Street: self-described pro-Israel PAC' },
  'J-STREET': { country: 'Israel', basis: 'J Street: self-described pro-Israel PAC' },
  'J STREET': { country: 'Israel', basis: 'J Street: self-described pro-Israel PAC' },
  DMFI: { country: 'Israel', basis: 'Democratic Majority for Israel' },
};

/**
 * @returns {{country: string, flag: string, basis: string} | null}
 */
export function detectForeignInterest(name) {
  const raw = (name || '').toUpperCase();
  if (!raw.trim()) {
    return null;
  }

  for (const pattern of EXCLUSIONS) {
    if (pattern.test(raw)) {
      return null;
    }
  }

  for (const [alias, entry] of Object.entries(ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(raw)) {
      return { country: entry.country, flag: FLAGS[entry.country], basis: entry.basis };
    }
  }

  for (const [country, terms] of Object.entries(COUNTRY_TERMS)) {
    for (const term of terms) {
      if (new RegExp(`\\b${term}\\b`).test(raw)) {
        return {
          country,
          flag: FLAGS[country],
          basis: `"${term}" appears in the committee's FEC-filed name`,
        };
      }
    }
  }

  return null;
}
