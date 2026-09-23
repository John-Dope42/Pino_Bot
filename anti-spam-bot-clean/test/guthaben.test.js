import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guthabenTagesoptionen,
  istGuthabenPingTag,
  naechsterStichtag,
  parsePingTage,
  verarbeiteFaelligeAbzuege,
} from '../guthaben.js';

test('Guthaben pingt standardmäßig nur montags und donnerstags', () => {
  const woche = Array.from({ length: 7 }, (_, index) => {
    // 21.09.2026 ist ein Montag; die lokale Uhrzeit vermeidet UTC-Tageswechsel.
    const datum = new Date(2026, 8, 21 + index, 12, 0, 0);
    return guthabenTagesoptionen(datum);
  });

  assert.deepEqual(woche.map((tag) => tag.ping), [true, false, false, true, false, false, false]);
  assert.ok(woche.every((tag) => tag.neueNachricht));
});

test('Die beiden Ping-Tage sind konfigurierbar und ungültige Angaben fallen sicher zurück', () => {
  assert.deepEqual(parsePingTage('2,5'), [2, 5]);
  assert.deepEqual(parsePingTage('5,2,2'), [2, 5]);
  assert.deepEqual(parsePingTage('1'), [1, 4]);
  assert.deepEqual(parsePingTage('0,8'), [1, 4]);

  const freitag = new Date(2026, 8, 25, 12, 0, 0);
  assert.equal(istGuthabenPingTag(freitag, [2, 5]), true);
  assert.equal(istGuthabenPingTag(freitag, [1, 4]), false);
});

test('Die Einführung des Monatsabzugs bucht bestehende Guthaben nicht rückwirkend ab', () => {
  const data = { guthaben: 40, letzteAktualisierung: null };
  const ergebnis = verarbeiteFaelligeAbzuege(data, new Date(2026, 8, 23, 12), 54.70, 8);

  assert.deepEqual(ergebnis, { anzahl: 0, initialisiert: true });
  assert.equal(data.guthaben, 40);
  assert.equal(data.letzterMonatsabzug, '2026-09');
});

test('Am Stichtag wird das Monatsziel genau einmal abgezogen und ein Minusstand erlaubt', () => {
  const data = { guthaben: 40, letzterMonatsabzug: '2026-09' };
  const stichtag = new Date(2026, 9, 8, 12);

  const ersterLauf = verarbeiteFaelligeAbzuege(data, stichtag, 54.70, 8);
  const zweiterLauf = verarbeiteFaelligeAbzuege(data, stichtag, 54.70, 8);

  assert.deepEqual(ersterLauf, { anzahl: 1, initialisiert: false });
  assert.deepEqual(zweiterLauf, { anzahl: 0, initialisiert: false });
  assert.equal(data.guthaben, -14.70);
  assert.equal(data.letzterMonatsabzug, '2026-10');
  assert.equal(naechsterStichtag(stichtag, data.letzterMonatsabzug, 8).getMonth(), 10);
});

test('Nach einer längeren Offline-Zeit werden alle verpassten Monatsabzüge nachgeholt', () => {
  const data = { guthaben: 100, letzterMonatsabzug: '2026-09' };
  const ergebnis = verarbeiteFaelligeAbzuege(data, new Date(2026, 11, 9, 12), 54.70, 8);

  assert.deepEqual(ergebnis, { anzahl: 3, initialisiert: false });
  assert.equal(data.guthaben, -64.10);
  assert.equal(data.letzterMonatsabzug, '2026-12');
});

test('Vor dem nächsten Stichtag bleibt das Guthaben unverändert', () => {
  const data = { guthaben: 25, letzterMonatsabzug: '2026-09' };
  const ergebnis = verarbeiteFaelligeAbzuege(data, new Date(2026, 9, 7, 12), 54.70, 8);

  assert.deepEqual(ergebnis, { anzahl: 0, initialisiert: false });
  assert.equal(data.guthaben, 25);
});
