// Small checks on text people type: names, messages, topics.

// Characters that flip the direction of the text after them, which can disguise a link or a name.
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
/** Text with direction overrides taken out. */
export const withoutBidi = (text: string) => text.replace(BIDI_CONTROLS, '');
/** Nothing anyone could see: only spaces and invisible characters. */
export const looksBlank = (text: string) => !text.replace(/[\s\u200B-\u200D\u2060\uFEFF\u180E\u3164\u115F\u1160\uFFA0]/g, '').length;
