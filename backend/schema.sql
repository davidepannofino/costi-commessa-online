-- Schema del database — Costi Commessa
-- Pensato per più aziende fin da subito: ogni tabella ha una colonna azienda_id.
-- Tappa 2 (login): azienda_id viene ora popolato con l'azienda dell'utente
-- autenticato (tabella utenti), non più con un valore fisso.

CREATE TABLE IF NOT EXISTS aziende (
  id   TEXT PRIMARY KEY,
  nome TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS utenti (
  id             SERIAL PRIMARY KEY,
  azienda_id     TEXT UNIQUE NOT NULL REFERENCES aziende(id),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  creato_il      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dipendenti (
  id             TEXT PRIMARY KEY,
  azienda_id     TEXT NOT NULL REFERENCES aziende(id),
  nome           TEXT NOT NULL,
  cognome        TEXT NOT NULL DEFAULT '',
  lordo_mensile  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_dipendenti_azienda ON dipendenti(azienda_id);

CREATE TABLE IF NOT EXISTS commesse (
  id          TEXT PRIMARY KEY,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id),
  codice      TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_commesse_azienda ON commesse(azienda_id);

CREATE TABLE IF NOT EXISTS registrazioni (
  id             TEXT PRIMARY KEY,
  azienda_id     TEXT NOT NULL REFERENCES aziende(id),
  dipendente_id  TEXT NOT NULL REFERENCES dipendenti(id) ON DELETE CASCADE,
  commessa_id    TEXT NOT NULL REFERENCES commesse(id) ON DELETE CASCADE,
  data           DATE NOT NULL,
  ore            NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registrazioni_azienda ON registrazioni(azienda_id);
CREATE INDEX IF NOT EXISTS idx_registrazioni_dipendente ON registrazioni(dipendente_id);
CREATE INDEX IF NOT EXISTS idx_registrazioni_commessa ON registrazioni(commessa_id);

INSERT INTO aziende (id, nome) VALUES ('azienda-prova', 'Azienda di prova')
ON CONFLICT (id) DO NOTHING;
