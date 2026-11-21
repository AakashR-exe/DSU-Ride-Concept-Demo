// Minimal safe templating: html`...` escapes every interpolated value unless it is itself
// an html`` result (or wrapped in raw()). Arrays are joined; null, undefined and false render nothing.

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Mark a trusted string as HTML. Only use with markup this app generates itself. */
export const raw = (value) => new SafeHtml(String(value));

function toHtml(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  return new SafeHtml(strings.reduce((out, s, i) => out + toHtml(values[i - 1]) + s));
}
