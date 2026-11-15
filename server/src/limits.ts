// How much of anything one person can put in: message length, attachments, roles and so on.

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ALT_LENGTH = 1000;
export const MAX_ATTACHMENTS = 10;
export const MAX_REACTIONS = 20; // different emoji on one message
export const MAX_ROLES = 30;
export const MAX_TOPIC = 200;
export const MAX_DESCRIPTION = 300;
export const MAX_RULES = 2000;
export const MAX_GROUP_DM = 10; // people in a group conversation
export const MAX_FOLDERS = 20;
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000; // logins unused for 30 days expire
export const MAX_SOUNDS = 30;

/** One emoji character (or a flag), as a reaction or a status may use. */
export const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
