export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function serializeCookie(name: string, value: string, opts: { maxAgeSeconds: number; secure: boolean }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly', // inaccessible au JavaScript de la page : protège contre le vol de session
    'SameSite=Lax', // non envoyé par les formulaires d'autres sites
    `Max-Age=${opts.maxAgeSeconds}`,
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}
