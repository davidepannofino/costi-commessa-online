const CHIAVE_TOKEN = "costiCommessa.token";

export function leggiToken() {
  return localStorage.getItem(CHIAVE_TOKEN);
}

export function salvaToken(token) {
  localStorage.setItem(CHIAVE_TOKEN, token);
}

export function cancellaToken() {
  localStorage.removeItem(CHIAVE_TOKEN);
}
