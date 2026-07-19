-- Schema del database — Costi Commessa
-- Pensato per più aziende fin da subito: ogni tabella ha una colonna azienda_id.
-- Oggi si usa sempre lo stesso valore fisso ('azienda-prova'); in futuro (Tappa 2,
-- login) basterà popolare azienda_id con l'azienda dell'utente autenticato, senza
-- toccare questa struttura.

CREATE TABLE IF NOT EXISTS aziende (
  id   TEXT PRIMARY KEY,
  nome TEXT NOT NULL
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
