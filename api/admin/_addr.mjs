// Normalise the address stored on a lead before handing it to Resend. Customers
// paste emails with trailing spaces, non-breaking spaces, zero-width characters,
// "mailto:" prefixes or "Name <x@y.com>" wrappers, and Resend rejects all of
// those with a 422 "Invalid `to` field". Returns null when the value is not a
// single clean address (never guesses, so a typo can't go to a stranger).
export function cleanEmail(raw) {
  let s = String(raw == null ? '' : raw)
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/ /g, ' ')
    .trim();
  const angle = s.match(/<([^<>]+)>\s*$/);
  if (angle) s = angle[1].trim();
  s = s.replace(/^mailto:/i, '').replace(/[.,;]+$/, '');
  return /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s) ? s : null;
}
