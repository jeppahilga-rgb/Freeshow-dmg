// Generated from the pinned Google Fonts manifest. Assets and OFL licenses ship locally.
export const bundledFontNames = ["Roboto","Open Sans","Montserrat","Lato","Poppins","Noto Sans","Archivo","Darker Grotesque","Hanken Grotesk","Inter","Raleway","Red Hat Mono","VT323","Darker Grotesque SemiBold"] as const
export function isBundledFont(name: string) { return bundledFontNames.some(family => family.toLowerCase() === name.trim().replace(/^['"]|['"]$/g, '').toLowerCase()) }
