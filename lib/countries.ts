// Country names offered in supplier / customer forms. Free text is still accepted;
// this list only drives the suggestions and normalises imported values.
export const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin',
  'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
  'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Chile', 'China', 'Colombia', 'Costa Rica', 'Croatia', 'Cuba',
  'Cyprus', 'Czech Republic', 'Denmark', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia',
  'Ethiopia', 'Fiji', 'Finland', 'France', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala', 'Honduras',
  'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Laos', 'Latvia', 'Lebanon', 'Libya',
  'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malaysia', 'Maldives', 'Malta',
  'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Nigeria', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Singapore', 'Slovakia',
  'Slovenia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland', 'Taiwan',
  'Tanzania', 'Thailand', 'Timor-Leste', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Venezuela', 'Vietnam',
  'Yemen', 'Zambia', 'Zimbabwe',
]

const ALIASES: Record<string, string> = {
  sg: 'Singapore', sgp: 'Singapore', my: 'Malaysia', id: 'Indonesia', ph: 'Philippines', th: 'Thailand',
  vn: 'Vietnam', au: 'Australia', cn: 'China', prc: 'China', hk: 'Hong Kong', jp: 'Japan', kr: 'South Korea',
  korea: 'South Korea', tw: 'Taiwan', in: 'India', us: 'United States', usa: 'United States',
  'united states of america': 'United States', uk: 'United Kingdom', gb: 'United Kingdom',
  'great britain': 'United Kingdom', uae: 'United Arab Emirates', de: 'Germany', fr: 'France', nz: 'New Zealand',
}

/** "sg" / "SINGAPORE" / " Singapore " → "Singapore"; unknown values are kept as typed. */
export function normalizeCountry(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  if (!s) return ''
  const k = s.toLowerCase()
  return ALIASES[k] ?? COUNTRIES.find(c => c.toLowerCase() === k) ?? s
}
