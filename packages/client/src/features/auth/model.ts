// TSX-free entry of the auth feature for other features' models: the account
// rules (handle, PIN uniqueness) live here, once.
export {
  HANDLE_PATTERN,
  PINS_MUST_DIFFER,
  pinsDistinct,
  sanitizeHandle,
} from "./model/credentials.ts";
